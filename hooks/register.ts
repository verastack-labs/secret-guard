import { atom, read, update } from 'claude-code'
import type { EngineInterface, PluginOptions, ProcessRunInit, Register } from 'claude-code'

import { failClosed } from './fail'
import { checkGitStep, parseGitSteps } from './git'
import { BUILTIN_PATTERNS, parseUserPatterns } from './patterns'
import type { Pattern } from './patterns'
import { makeSkipMatcher } from './paths'
import { formatDeny, formatToast } from './report'
import type { BlockKind } from './report'
import { scan, scanNew } from './scan'
import type { Finding } from './scan'

const allowNext = atom({ plugin: 'secret-guard', key: 'allowNext' } as const, false)
const blockedCount = atom({ plugin: 'secret-guard', key: 'blockedCount' } as const, 0)

type Dollar = Pick<EngineInterface, 'state' | 'ui' | 'process'>
type Verdict = { deny: string } | undefined

/** The settings every check reads, built once per load from the config menu. */
type Config = {
  patterns: readonly Pattern[]
  isSkipped: (path: string) => boolean
  isGitCheckpointOn: boolean
}

function asList(value: PluginOptions[string] | undefined): readonly string[] {
  return typeof value === 'object' ? value : []
}

/** Blocks unless the one-shot override is set; with nothing found, allows. */
async function gate($: Dollar, kind: BlockKind, findings: readonly Finding[], files: readonly string[]): Promise<Verdict> {
  if (findings.length === 0 && files.length === 0) return undefined
  if (await read($, allowNext)) {
    await update($, allowNext, () => false)
    $.ui.toast('secret-guard: override used, letting this call through once')
    return undefined
  }
  const count = await update($, blockedCount, n => n + 1)
  $.ui.status(`secret-guard: ${count} blocked`)
  $.ui.toast(formatToast(kind, findings, files))
  return { deny: formatDeny(kind, findings, files) }
}

/** Checks written text; `before` is what an Edit replaces, so secrets it already held do not count. */
async function checkWrite($: Dollar, config: Config, path: string, text: string, before = ''): Promise<Verdict> {
  if (config.isSkipped(path)) return undefined
  return gate($, 'write', scanNew(text, before, config.patterns), [])
}

async function checkCommand($: Dollar, config: Config, command: string): Promise<Verdict> {
  const findings = scan(command, config.patterns)
  if (findings.length > 0) return gate($, 'command', findings, [])
  if (!config.isGitCheckpointOn) return undefined
  const run = (argv: readonly string[], init?: ProcessRunInit) => $.process.run(argv, init)
  for (const step of parseGitSteps(command)) {
    const found = await checkGitStep(run, step, config.patterns, config.isSkipped)
    if (found.isTruncated) $.ui.toast('secret-guard: part of the git output was too large to check')
    if (found.findings.length === 0 && found.files.length === 0) continue
    return gate($, step.kind === 'commit' ? 'commit' : 'command', found.findings, found.files)
  }
  return undefined
}

export const register: Register = (on, options) => {
  const user = parseUserPatterns(asList(options.extraPatterns))
  const patterns = [...BUILTIN_PATTERNS, ...user.patterns]
  const config: Config = {
    patterns,
    isSkipped: makeSkipMatcher(asList(options.skipPaths)),
    isGitCheckpointOn: options.gitCheckpoint !== false,
  }

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'allow-secret',
      description: 'Let the next call secret-guard blocks go through once',
    })
    for (const error of user.errors) $.ui.toast(`secret-guard skipped a pattern: ${error}`)
    return next(e)
  })

  on('command.run', { command: 'allow-secret' }, async $ => {
    await update($, allowNext, () => true)
    return { text: 'secret-guard: the next blocked call will go through once.' }
  })

  on('tool.call', { tool: 'Write' }, async ($, e, next) => (await checkWrite($, config, e.file_path, e.content)) ?? next(e)).catch(
    ($, e, next) => failClosed(e, next, patterns),
  )

  on('tool.call', { tool: 'Edit' }, async ($, e, next) => (await checkWrite($, config, e.file_path, e.new_string, e.old_string)) ?? next(e)).catch(
    ($, e, next) => failClosed(e, next, patterns),
  )

  on(
    'tool.call',
    { tool: 'NotebookEdit' },
    async ($, e, next) => (await checkWrite($, config, e.notebook_path, e.new_source)) ?? next(e),
  ).catch(($, e, next) => failClosed(e, next, patterns))

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => (await checkCommand($, config, e.command)) ?? next(e)).catch(
    ($, e, next) => failClosed(e, next, patterns),
  )

  on('tool.call', { tool: 'PowerShell' }, async ($, e, next) => (await checkCommand($, config, e.command)) ?? next(e)).catch(
    ($, e, next) => failClosed(e, next, patterns),
  )
}
