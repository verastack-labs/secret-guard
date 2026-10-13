import type { Pattern } from './patterns'

/** One likely secret: which pattern, where, and a masked preview. `file` is set for diff findings. */
export type Finding = { name: string; line: number; preview: string; file?: string }

/** The first and last four characters around an ellipsis; only the first four for a value under 12. */
export function mask(value: string): string {
  return value.length < 12 ? `${value.slice(0, 4)}…` : `${value.slice(0, 4)}…${value.slice(-4)}`
}

/** The 1-based line holding `index`. */
export function lineAt(text: string, index: number): number {
  let line = 1
  for (let i = 0; i < index; i += 1) {
    if (text.charCodeAt(i) === 10) line += 1
  }
  return line
}

function global(regex: RegExp): RegExp {
  return new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : `${regex.flags}g`)
}

/** Every match of every pattern in `text`, in text order. Empty matches are ignored. */
export function scan(text: string, patterns: readonly Pattern[]): Finding[] {
  const hits: { index: number; finding: Finding }[] = []
  for (const pattern of patterns) {
    for (const match of text.matchAll(global(pattern.regex))) {
      if (match[0] === '') continue
      const index = match.index ?? 0
      hits.push({ index, finding: { name: pattern.name, line: lineAt(text, index), preview: mask(match[0]) } })
    }
  }
  return hits.sort((a, b) => a.index - b.index).map(hit => hit.finding)
}
