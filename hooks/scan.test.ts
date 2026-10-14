import { describe, expect, test } from 'claude-code/testing'

import { fake } from './helpers'
import { BUILTIN_PATTERNS, parseUserPatterns } from './patterns'
import { lineAt, mask, scan, scanNew } from './scan'

const names = (text: string) => scan(text, BUILTIN_PATTERNS).map(f => f.name)

describe('built-in patterns', () => {
  const cases: readonly [string, string, string][] = [
    ['GitHub token', fake.github(), 'gh' + 'p_' + 'short'],
    ['Anthropic key', fake.anthropic(), 'sk-' + 'ant-' + 'abc'],
    ['OpenAI key', fake.openai(), 'ta' + 'sk-' + 'A1b2C3d4'.repeat(5)],
    ['AWS access key', fake.aws(), 'AK' + 'IA' + 'abcdefgh23456789'],
    ['Stripe key', fake.stripe(), 'sk' + '_test_' + 'A1b2C3d4'.repeat(3)],
    ['Slack token', fake.slack(), 'xo' + 'xa-' + '1234567890-abcdefghij'],
    ['Google API key', fake.google(), 'AI' + 'za' + 'short'],
    ['npm token', fake.npm(), 'np' + 'm_' + 'short'],
    ['Private key', fake.privateKey(), '-----BEGIN ' + 'PUBLIC' + ' KEY-----'],
  ]

  for (const [name, hit, miss] of cases) {
    test(`${name} matches a correctly shaped value`, () => {
      expect(names(`value = "${hit}"\n`)).toEqual([name])
    })
    test(`${name} ignores a near miss`, () => {
      expect(names(`value = "${miss}"\n`)).toEqual([])
    })
  }

  test('an Anthropic key is not also reported as an OpenAI key', () => {
    expect(names(fake.anthropic())).toEqual(['Anthropic key'])
  })
})

describe('mask', () => {
  test('keeps the first and last four characters of a long value', () => {
    expect(mask('ABCDEFGHIJKLMNOP')).toBe('ABCD…MNOP')
  })
  test('keeps only the first four characters of a short value', () => {
    expect(mask('ABCDEFGHIJK')).toBe('ABCD…')
  })
  test('a finding never carries the full secret', () => {
    const [finding] = scan(fake.github(), BUILTIN_PATTERNS)
    expect(finding?.preview).not.toContain(fake.github())
  })
})

describe('line numbers', () => {
  test('lineAt counts newlines before the index', () => {
    expect(lineAt('a\nb\nc', 4)).toBe(3)
  })
  test('findings are reported in text order with their lines', () => {
    const text = `one\n${fake.aws()}\nthree\n${fake.github()}\n`
    expect(scan(text, BUILTIN_PATTERNS).map(f => [f.name, f.line])).toEqual([
      ['AWS access key', 2],
      ['GitHub token', 4],
    ])
  })
  test('a 2 MB write is scanned with the right line number', () => {
    const filler = 'x'.repeat(99) + '\n'
    const text = filler.repeat(20000) + fake.stripe() + '\n'
    const started = Date.now()
    const found = scan(text, BUILTIN_PATTERNS)
    expect(found.map(f => [f.name, f.line])).toEqual([['Stripe key', 20001]])
    expect(Date.now() - started).toBeLessThan(2000)
  })
  test('2,000 keys in a 2 MB write are found inside the time budget', () => {
    const line = `k = '${fake.stripe()}'` + 'x'.repeat(960) + '\n'
    const text = line.repeat(2000)
    const started = Date.now()
    const found = scan(text, BUILTIN_PATTERNS)
    expect(found).toHaveLength(2000)
    expect(found[1999]?.line).toBe(2000)
    expect(Date.now() - started).toBeLessThan(2000)
  })
})

describe('scanNew', () => {
  test('drops secrets the old text already held', () => {
    const before = `const k = '${fake.github()}'\nconst a = 1`
    const after = `const k = '${fake.github()}'\nconst a = 2`
    expect(scanNew(after, before, BUILTIN_PATTERNS)).toEqual([])
  })
  test('keeps a new secret beside an existing one', () => {
    const before = `const k = '${fake.github()}'`
    const after = `const k = '${fake.github()}'\nconst j = '${fake.aws()}'`
    expect(scanNew(after, before, BUILTIN_PATTERNS).map(f => [f.name, f.line])).toEqual([['AWS access key', 2]])
  })
})

describe('user patterns', () => {
  test('parses Name=regex entries', () => {
    const { patterns, errors } = parseUserPatterns(['Mehfil key=mhf_[A-Za-z0-9]{32}'])
    expect(errors).toEqual([])
    expect(scan('mhf_' + 'a'.repeat(32), patterns).map(f => f.name)).toEqual(['Mehfil key'])
  })
  test('reports an entry with no = and an invalid regex, and keeps the rest', () => {
    const { patterns, errors } = parseUserPatterns(['nothing here', 'Broken=([', 'Good=good_[0-9]{4}'])
    expect(patterns.map(p => p.name)).toEqual(['Good'])
    expect(errors).toEqual(['"nothing here" needs the form Name=regex', '"Broken" is not a valid regex'])
  })
  test('ignores blank entries', () => {
    expect(parseUserPatterns(['', '   '])).toEqual({ patterns: [], errors: [] })
  })
  test('a pattern that matches the empty string does not flag every write', () => {
    const { patterns } = parseUserPatterns(['Loose=x*'])
    expect(scan('const a = 1\n', patterns)).toEqual([])
  })
})

describe('OpenAI and Anthropic patterns, minor fix', () => {
  test('do not fire inside a longer dashed word', () => {
    expect(scan('x-' + fake.openai(), BUILTIN_PATTERNS)).toEqual([])
    expect(scan('x-' + fake.anthropic(), BUILTIN_PATTERNS)).toEqual([])
  })
  test('still fire after punctuation, quotes and equals signs', () => {
    expect(scan('KEY=' + fake.openai(), BUILTIN_PATTERNS).map(f => f.name)).toEqual(['OpenAI key'])
    expect(scan('"' + fake.anthropic() + '"', BUILTIN_PATTERNS).map(f => f.name)).toEqual(['Anthropic key'])
  })
})
