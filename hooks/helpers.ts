import type { On, ProcessRunResult } from 'claude-code'

/** Answers every tool call beneath the plugin, standing in for the real tool. */
export const OK = { result: { ok: true } } as never

const BODY = 'A1b2C3d4'

/** Fake secrets, assembled at runtime so no literal secret sits in any file. */
export const fake = {
  github: () => 'gh' + 'p_' + BODY.repeat(4) + 'XyZ9',
  anthropic: () => 'sk-' + 'ant-' + 'api03-' + BODY.repeat(5),
  openai: () => 'sk-' + 'proj-' + BODY.repeat(5),
  aws: () => 'AK' + 'IA' + 'ABCDEFGH23456789',
  stripe: () => 'sk' + '_live_' + BODY.repeat(3),
  slack: () => 'xo' + 'xb-' + '1234567890-' + BODY.repeat(2),
  google: () => 'AI' + 'za' + BODY.repeat(4) + 'XyZ',
  npm: () => 'np' + 'm_' + BODY.repeat(4) + 'XyZ9',
  privateKey: () => '-----BEGIN ' + 'RSA PRIVATE' + ' KEY-----',
}

/** The arguments `$.command.run` needs for a slash command typed at the prompt. */
export function slash(command: string) {
  return {
    command,
    args: '',
    origin: { kind: 'composer' } as const,
    presentation: { isFullscreen: false, columns: 80 },
  }
}

/** Stands in for tools, toasts and the status line, and records what the plugin showed. */
export function harness(on: On) {
  const toasts: string[] = []
  const statuses: (string | undefined)[] = []
  on('tool.call', () => OK)
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.status', ($, e) => {
    statuses.push(e.text)
    return { value: undefined }
  })
  return { toasts, statuses }
}

/** A canned git answer, or 'missing' for git not being installed. */
export type GitAnswer = Partial<ProcessRunResult> | 'missing'

/** Stands in for $.process.run: answers by argv joined with spaces, and records each call. */
export function git(on: On, answers: Readonly<Record<string, GitAnswer>>) {
  const calls: { argv: string; cwd: string | undefined }[] = []
  on('process.run', ($, e) => {
    const argv = e.argv.join(' ')
    calls.push({ argv, cwd: e.init?.cwd })
    const answer = answers[argv]
    if (answer === 'missing') return { deny: 'git is not installed' }
    return {
      value: {
        exitCode: 0,
        stdout: '',
        stderr: '',
        isStdoutTruncated: false,
        isStderrTruncated: false,
        ...answer,
      },
    }
  })
  return calls
}
