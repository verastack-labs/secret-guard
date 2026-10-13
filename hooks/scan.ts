import type { Pattern } from './patterns'

/** One likely secret: which pattern, where, and a masked preview. `file` is set for diff findings. */
export type Finding = { name: string; line: number; preview: string; file?: string }

/** A raw match. `value` is the secret itself and never leaves this file. */
type Hit = { index: number; name: string; value: string }

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

/** Every non-empty match of every pattern, in text order. */
function hitsIn(text: string, patterns: readonly Pattern[]): Hit[] {
  const hits: Hit[] = []
  for (const pattern of patterns) {
    for (const match of text.matchAll(global(pattern.regex))) {
      if (match[0] === '') continue
      hits.push({ index: match.index ?? 0, name: pattern.name, value: match[0] })
    }
  }
  return hits.sort((a, b) => a.index - b.index)
}

/** Findings for sorted hits, counting newlines once in a single forward pass. */
function toFindings(text: string, hits: readonly Hit[]): Finding[] {
  let line = 1
  let at = 0
  return hits.map(hit => {
    for (; at < hit.index; at += 1) {
      if (text.charCodeAt(at) === 10) line += 1
    }
    return { name: hit.name, line, preview: mask(hit.value) }
  })
}

/** Every match of every pattern in `text`, in text order. Empty matches are ignored. */
export function scan(text: string, patterns: readonly Pattern[]): Finding[] {
  return toFindings(text, hitsIn(text, patterns))
}

/** Matches in `after` whose text does not already appear in `before`: what an edit adds. */
export function scanNew(after: string, before: string, patterns: readonly Pattern[]): Finding[] {
  return toFindings(
    after,
    hitsIn(after, patterns).filter(hit => !before.includes(hit.value)),
  )
}
