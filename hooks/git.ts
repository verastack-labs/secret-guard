import type { ProcessRunInit, ProcessRunResult } from 'claude-code'

import type { Pattern } from './patterns'
import { basename, isSecretFile } from './paths'
import { scan } from './scan'
import type { Finding } from './scan'

/** One git command found in a shell command, with the folder it runs in. */
export type GitStep =
  | { kind: 'add'; cwd: string | undefined; args: string[] }
  | { kind: 'commit'; cwd: string | undefined; all: boolean }

/** A word of a shell command, or an operator that separates commands. */
type Lexeme = { kind: 'word'; text: string } | { kind: 'separator'; text: string }

const CHANGE_DIR = new Set(['cd', 'chdir', 'set-location', 'sl', 'pushd'])
const SINGLE_OPERATORS = ';|&()\n'
const ESCAPABLE_OUTSIDE_QUOTES = ' \t"\'\\;&|()\n'
const ESCAPABLE_IN_DOUBLE_QUOTES = '"\\$`'
const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/

/**
 * Splits a shell command into words and separators. Quotes group words and
 * hide separators; a backslash before a newline joins lines; a backslash
 * escapes a quote or operator, and is kept as-is elsewhere (Windows paths).
 */
function lex(command: string): Lexeme[] {
  const source = command.replace(/\\\r?\n/g, ' ')
  const lexemes: Lexeme[] = []
  let word = ''
  let hasWord = false
  let quote: '"' | "'" | undefined
  const flush = () => {
    if (hasWord) lexemes.push({ kind: 'word', text: word })
    word = ''
    hasWord = false
  }
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i] ?? ''
    const following = source[i + 1] ?? ''
    if (quote === "'") {
      if (char === "'") quote = undefined
      else word += char
      continue
    }
    if (quote === '"') {
      if (char === '\\' && following !== '' && ESCAPABLE_IN_DOUBLE_QUOTES.includes(following)) {
        word += following
        i += 1
      } else if (char === '"') {
        quote = undefined
      } else {
        word += char
      }
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      hasWord = true
      continue
    }
    if (char === '\\' && following !== '' && ESCAPABLE_OUTSIDE_QUOTES.includes(following)) {
      word += following
      hasWord = true
      i += 1
      continue
    }
    if (char === '\r') continue
    const operator =
      (char === '&' && following === '&') || (char === '|' && following === '|')
        ? char + following
        : SINGLE_OPERATORS.includes(char)
          ? char
          : undefined
    if (operator !== undefined) {
      flush()
      lexemes.push({ kind: 'separator', text: operator })
      i += operator.length - 1
      continue
    }
    if (char === ' ' || char === '\t') {
      flush()
      continue
    }
    word += char
    hasWord = true
  }
  flush()
  return lexemes
}

/** Splits a command segment into arguments, keeping quoted ones whole. */
export function tokenize(segment: string): string[] {
  return lex(segment)
    .filter(lexeme => lexeme.kind === 'word')
    .map(lexeme => lexeme.text)
}

/** `next` relative to `base`, or `next` alone when it is absolute or there is no base. */
export function joinDir(base: string | undefined, next: string): string {
  if (base === undefined || /^(?:[A-Za-z]:|[\\/]|~)/.test(next)) return next
  return `${base.replace(/[\\/]+$/, '')}/${next}`
}

function isAllFlag(token: string): boolean {
  return token === '--all' || /^-[A-Za-z]*a[A-Za-z]*$/.test(token)
}

/** A program name without its folder or `.exe`, lowercased: `C:\Git\bin\git.exe` reads as `git`. */
function commandName(token: string): string {
  return basename(token).toLowerCase().replace(/\.exe$/, '')
}

/** Reads one simple command: records a git step, and returns the folder later commands run in. */
function readCommand(words: readonly string[], cwd: string | undefined, steps: GitStep[]): string | undefined {
  let start = 0
  while (start < words.length && ENV_ASSIGNMENT.test(words[start] ?? '')) start += 1
  const tokens = words.slice(start)
  const head = tokens[0]
  if (head === undefined) return cwd
  const name = commandName(head)
  if (CHANGE_DIR.has(name)) {
    const dir = tokens.slice(1).find(token => !token.startsWith('-'))
    return dir === undefined ? cwd : joinDir(cwd, dir)
  }
  if (name !== 'git') return cwd
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
  return cwd
}

/**
 * The git add and git commit steps in a shell command, in order, each with
 * the folder a cd, Set-Location or git -C points it at. A cd inside
 * parentheses applies until the closing parenthesis.
 */
export function parseGitSteps(command: string): GitStep[] {
  const steps: GitStep[] = []
  const saved: (string | undefined)[] = []
  let cwd: string | undefined
  let words: string[] = []
  for (const lexeme of lex(command)) {
    if (lexeme.kind === 'word') {
      words.push(lexeme.text)
      continue
    }
    cwd = readCommand(words, cwd, steps)
    words = []
    if (lexeme.text === '(') saved.push(cwd)
    if (lexeme.text === ')' && saved.length > 0) cwd = saved.pop()
  }
  readCommand(words, cwd, steps)
  return steps
}

/** `$.process.run`, passed in so the checks stay testable. */
export type Run = (argv: readonly string[], init?: ProcessRunInit) => Promise<ProcessRunResult>

/** What one git step would let through: secrets files and secrets in added lines. */
export type GitResult = { files: string[]; findings: Finding[]; isTruncated: boolean }

const INTERACTIVE = new Set(['-p', '--patch', '-i', '--interactive', '-e', '--edit'])
const UPDATE_ONLY = new Set(['-u', '--update'])
const DIFF_FLAGS = ['--no-color', '--no-ext-diff', '-U0']
const NEW_FILE_DIFF = ['git', 'diff', '--no-index', ...DIFF_FLAGS, '--', '/dev/null']
const MAX_NEW_FILES = 200
const GIT_TIMEOUT_MS = 15000

function nothing(): GitResult {
  return { files: [], findings: [], isTruncated: false }
}

function lines(text: string): string[] {
  return text.split(/\r?\n/)
}

/**
 * Runs git; any failure (an exit code outside `okCodes`, missing git, a deny)
 * reads as no answer. `git diff --no-index` exits 1 when it found changes.
 */
async function tryRun(
  run: Run,
  argv: readonly string[],
  init: ProcessRunInit,
  okCodes: readonly number[] = [0],
): Promise<ProcessRunResult | undefined> {
  try {
    const result = await run(argv, init)
    return okCodes.includes(result.exitCode) ? result : undefined
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
 * Checks what a git add would stage: secrets files by name, then the content
 * of changed tracked files and of new untracked ones. This also covers
 * `git add -A && git commit`, where the commit check runs before the add has.
 */
async function checkAdd(
  run: Run,
  args: readonly string[],
  init: ProcessRunInit,
  patterns: readonly Pattern[],
  isSkipped: (path: string) => boolean,
): Promise<GitResult> {
  if (args.some(arg => INTERACTIVE.has(arg))) return nothing()
  const dryRun = await tryRun(run, ['git', 'add', '--dry-run', ...args], init)
  if (dryRun === undefined) return nothing()
  const staged = lines(dryRun.stdout)
    .map(entry => /^add '(.*)'$/.exec(entry)?.[1])
    .filter((path): path is string => path !== undefined)
  const files = staged.filter(isSecretFile)
  let isTruncated = dryRun.isStdoutTruncated
  if (staged.length === 0) return { files, findings: [], isTruncated }
  const pathspec = args.filter(arg => !arg.startsWith('-'))
  const findings: Finding[] = []
  const changed = await tryRun(run, ['git', 'diff', ...DIFF_FLAGS, '--', ...pathspec], init)
  if (changed !== undefined) {
    findings.push(...scanDiff(changed.stdout, patterns, isSkipped))
    isTruncated = isTruncated || changed.isStdoutTruncated
  }
  if (!args.some(arg => UPDATE_ONLY.has(arg))) {
    const listed = await tryRun(run, ['git', 'ls-files', '--others', '--exclude-standard', '--', ...pathspec], init)
    if (listed !== undefined) {
      const untracked = lines(listed.stdout)
        .map(entry => entry.trim())
        .filter(path => path !== '' && !isSecretFile(path))
      if (listed.isStdoutTruncated || untracked.length > MAX_NEW_FILES) isTruncated = true
      for (const path of untracked.slice(0, MAX_NEW_FILES)) {
        const added = await tryRun(run, [...NEW_FILE_DIFF, path], init, [0, 1])
        if (added === undefined) continue
        findings.push(...scanDiff(added.stdout, patterns, isSkipped))
        isTruncated = isTruncated || added.isStdoutTruncated
      }
    }
  }
  return { files, findings, isTruncated }
}

/** A commit's staged names and added lines, against HEAD for -a and the index otherwise. */
async function checkCommit(
  run: Run,
  all: boolean,
  init: ProcessRunInit,
  patterns: readonly Pattern[],
  isSkipped: (path: string) => boolean,
): Promise<GitResult> {
  const base = all ? ['HEAD'] : ['--cached']
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

/** Checks one git step in the folder it runs in. */
export async function checkGitStep(
  run: Run,
  step: GitStep,
  patterns: readonly Pattern[],
  isSkipped: (path: string) => boolean,
): Promise<GitResult> {
  const init: ProcessRunInit = step.cwd === undefined ? { timeoutMs: GIT_TIMEOUT_MS } : { cwd: step.cwd, timeoutMs: GIT_TIMEOUT_MS }
  return step.kind === 'add'
    ? checkAdd(run, step.args, init, patterns, isSkipped)
    : checkCommit(run, step.all, init, patterns, isSkipped)
}
