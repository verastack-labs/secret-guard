import type { Finding } from './scan'

/** What was blocked, as the messages name it. */
export type BlockKind = 'write' | 'command' | 'commit'

export const ADVICE =
  'Read the value from an environment variable instead. If this is a placeholder or test value, ask the user to run /allow-secret.'

/** One line per blocked item: secrets files first, then findings. */
export function describeItems(findings: readonly Finding[], files: readonly string[]): string[] {
  return [
    ...files.map(file => `${file} looks like a secrets file`),
    ...findings.map(f => `${f.name} (${f.preview}) on line ${f.line}${f.file === undefined ? '' : ` of ${f.file}`}`),
  ]
}

/** The deny text Claude reads: up to three items, a count of the rest, then the advice. */
export function formatDeny(kind: BlockKind, findings: readonly Finding[], files: readonly string[]): string {
  const items = describeItems(findings, files)
  const shown = items.slice(0, 3).join('; ')
  const more = items.length > 3 ? `; and ${items.length - 3} more` : ''
  return `secret-guard blocked this ${kind}: ${shown}${more}.\n${ADVICE}`
}

/** The one-line toast the user sees. The engine shows it under the mod's name, so the text leaves the name out. */
export function formatToast(kind: BlockKind, findings: readonly Finding[], files: readonly string[]): string {
  const items = describeItems(findings, files)
  const more = items.length > 1 ? ` (+${items.length - 1} more)` : ''
  return `Blocked a ${kind}: ${items[0] ?? 'a likely secret'}${more}`
}
