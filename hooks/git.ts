import type { ProcessRunInit, ProcessRunResult } from 'claude-code'

import type { Pattern } from './patterns'
import { isSecretFile } from './paths'
import { scan } from './scan'
import type { Finding } from './scan'

/** One git command found in a shell command, with the folder it runs in. */
export type GitStep =
  | { kind: 'add'; cwd: string | undefined; args: string[] }
  | { kind: 'commit'; cwd: string | undefined; all: boolean }

const SEPARATORS = /&&|\|\||;|\r?\n/
const TOKEN = /"([^"]*)"|'([^']*)'|(\S+)/g
const CHANGE_DIR = new Set(['cd', 'chdir', 'set-location', 'sl', 'pushd'])

/** Splits a command segment into arguments, keeping quoted ones whole. */
export function tokenize(segment: string): string[] {
  const tokens: string[] = []
  for (const match of segment.matchAll(TOKEN)) tokens.push(match[1] ?? match[2] ?? match[3] ?? '')
  return tokens
}

/** `next` relative to `base`, or `next` alone when it is absolute or there is no base. */
export function joinDir(base: string | undefined, next: string): string {
  if (base === undefined || /^(?:[A-Za-z]:|[\\/]|~)/.test(next)) return next
  return `${base.replace(/[\\/]+$/, '')}/${next}`
}

function isAllFlag(token: string): boolean {
  return token === '--all' || /^-[A-Za-z]*a[A-Za-z]*$/.test(token)
}

/**
 * The git add and git commit steps in a shell command, in order, each with
 * the folder a leading cd, Set-Location or git -C points it at.
 */
export function parseGitSteps(command: string): GitStep[] {
  const steps: GitStep[] = []
  let cwd: string | undefined
  for (const segment of command.split(SEPARATORS)) {
    const tokens = tokenize(segment.trim())
    const head = tokens[0]?.toLowerCase()
    if (head === undefined) continue
    if (CHANGE_DIR.has(head)) {
      const dir = tokens[1]
      if (dir !== undefined) cwd = joinDir(cwd, dir)
      continue
    }
    if (head !== 'git' && head !== 'git.exe') continue
    let stepCwd = cwd
    let i = 1
    while (i < tokens.length && (tokens[i] ?? '').startsWith('-')) {
      const flag = tokens[i]
      if (flag === '-C') {
        const dir = tokens[i + 1]
        if (dir !== undefined) stepCwd = joinDir(stepCwd, dir)
        i += 2
      } else if (flag === '-c') {
        i += 2
      } else {
        i += 1
      }
    }
    const subcommand = tokens[i]
    const rest = tokens.slice(i + 1)
    if (subcommand === 'add') steps.push({ kind: 'add', cwd: stepCwd, args: rest })
    if (subcommand === 'commit') steps.push({ kind: 'commit', cwd: stepCwd, all: rest.some(isAllFlag) })
  }
  return steps
}

/** `$.process.run`, passed in so the checks stay testable. */
export type Run = (argv: readonly string[], init?: ProcessRunInit) => Promise<ProcessRunResult>

/** What one git step would let through: secrets files and secrets in added lines. */
export type GitResult = { files: string[]; findings: Finding[]; isTruncated: boolean }

const INTERACTIVE = new Set(['-p', '--patch', '-i', '--interactive', '-e', '--edit'])
const DIFF_FLAGS = ['--no-color', '--no-ext-diff', '-U0']
const GIT_TIMEOUT_MS = 15000

function nothing(): GitResult {
  return { files: [], findings: [], isTruncated: false }
}

function lines(text: string): string[] {
  return text.split(/\r?\n/)
}

/** Runs git; any failure (non-zero exit, missing git, a deny) reads as no answer. */
async function tryRun(run: Run, argv: readonly string[], init: ProcessRunInit): Promise<ProcessRunResult | undefined> {
  try {
    const result = await run(argv, init)
    return result.exitCode === 0 ? result : undefined
  } catch {
    return undefined
  }
}

/** Secrets on the added lines of a unified diff, each with its file and new line number. */
export function scanDiff(diff: string, patterns: readonly Pattern[], isSkipped: (path: string) => boolean): Finding[] {
  const findings: Finding[] = []
  let file = ''
  let line = 0
  for (const raw of lines(diff)) {
    if (raw.startsWith('+++ ')) {
      file = raw.slice(4).replace(/^b\//, '')
      continue
    }
    if (raw.startsWith('--- ')) continue
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)/.exec(raw)
    if (hunk !== null) {
      line = Number(hunk[1])
      continue
    }
    if (raw.startsWith('+')) {
      if (!isSkipped(file)) {
        for (const finding of scan(raw.slice(1), patterns)) findings.push({ ...finding, line, file })
      }
      line += 1
    } else if (raw.startsWith(' ')) {
      line += 1
    }
  }
  return findings
}

/**
 * Checks one git step. An add is dry-run to list what it would stage; a
 * commit's staged names and added lines are read from git diff, against
 * HEAD for -a and the index otherwise.
 */
export async function checkGitStep(
  run: Run,
  step: GitStep,
  patterns: readonly Pattern[],
  isSkipped: (path: string) => boolean,
): Promise<GitResult> {
  const init: ProcessRunInit = step.cwd === undefined ? { timeoutMs: GIT_TIMEOUT_MS } : { cwd: step.cwd, timeoutMs: GIT_TIMEOUT_MS }
  if (step.kind === 'add') {
    if (step.args.some(arg => INTERACTIVE.has(arg))) return nothing()
    const dryRun = await tryRun(run, ['git', 'add', '--dry-run', ...step.args], init)
    if (dryRun === undefined) return nothing()
    const files = lines(dryRun.stdout)
      .map(entry => /^add '(.*)'$/.exec(entry)?.[1])
      .filter((path): path is string => path !== undefined && isSecretFile(path))
    return { files, findings: [], isTruncated: dryRun.isStdoutTruncated }
  }
  const base = step.all ? ['HEAD'] : ['--cached']
  const names = await tryRun(run, ['git', 'diff', ...base, '--name-only'], init)
  if (names === undefined) return nothing()
  const files = lines(names.stdout)
    .map(entry => entry.trim())
    .filter(path => path !== '' && isSecretFile(path))
  const diff = await tryRun(run, ['git', 'diff', ...base, ...DIFF_FLAGS], init)
  if (diff === undefined) return { files, findings: [], isTruncated: names.isStdoutTruncated }
  return {
    files,
    findings: scanDiff(diff.stdout, patterns, isSkipped),
    isTruncated: names.isStdoutTruncated || diff.isStdoutTruncated,
  }
}
