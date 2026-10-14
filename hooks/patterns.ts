/** A named secret shape. Built-in regexes carry no `g` flag; the scanner adds it. */
export type Pattern = { name: string; regex: RegExp }

/** Known secret formats. Each needs a recognisable prefix or structure. */
export const BUILTIN_PATTERNS: readonly Pattern[] = [
  { name: 'GitHub token', regex: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})(?![A-Za-z0-9_])/ },
  // not after a letter, digit, _ or -, where \b alone would let x-sk-... through
  { name: 'Anthropic key', regex: /(?<![A-Za-z0-9_-])sk-ant-[A-Za-z0-9_-]{32,}/ },
  { name: 'OpenAI key', regex: /(?<![A-Za-z0-9_-])sk-(?!ant-)(?:proj-)?[A-Za-z0-9_-]{32,}/ },
  { name: 'AWS access key', regex: /\b(?:AKIA|ASIA)[A-Z0-9]{16}(?![A-Za-z0-9])/ },
  { name: 'Stripe key', regex: /\b(?:sk|rk)_live_[A-Za-z0-9]{24,}/ },
  { name: 'Slack token', regex: /\b(?:xox[bp]|xapp)-[A-Za-z0-9-]{10,}/ },
  { name: 'Google API key', regex: /\bAIza[A-Za-z0-9_-]{35}(?![A-Za-z0-9_-])/ },
  { name: 'npm token', regex: /\bnpm_[A-Za-z0-9]{36}(?![A-Za-z0-9])/ },
  { name: 'Private key', regex: /-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----/ },
]

/**
 * Parses the config menu's `extraPatterns` entries, each `Name=regex`.
 * A bad entry is skipped and described in `errors`; the rest still load.
 */
export function parseUserPatterns(entries: readonly string[]): { patterns: Pattern[]; errors: string[] } {
  const patterns: Pattern[] = []
  const errors: string[] = []
  for (const raw of entries) {
    const entry = raw.trim()
    if (entry === '') continue
    const at = entry.indexOf('=')
    if (at <= 0) {
      errors.push(`"${entry}" needs the form Name=regex`)
      continue
    }
    const name = entry.slice(0, at).trim()
    const source = entry.slice(at + 1)
    try {
      patterns.push({ name, regex: new RegExp(source) })
    } catch {
      errors.push(`"${name}" is not a valid regex`)
    }
  }
  return { patterns, errors }
}
