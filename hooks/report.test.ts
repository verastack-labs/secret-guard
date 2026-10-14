import { describe, expect, test } from 'claude-code/testing'

import { CRASH_DENY, REENTRY_DENY, failClosed, textOf } from './fail'
import { fake } from './helpers'
import { BUILTIN_PATTERNS } from './patterns'
import { ADVICE, formatDeny, formatToast } from './report'
import type { Finding } from './scan'

const finding = (line: number, file?: string): Finding => ({ name: 'GitHub token', line, preview: 'ghp_…XyZ9', file })

describe('formatDeny', () => {
  test('names the pattern, preview and line, then the advice', () => {
    expect(formatDeny('write', [finding(12)], [])).toBe(
      `secret-guard blocked this write: GitHub token (ghp_…XyZ9) on line 12.\n${ADVICE}`,
    )
  })
  test('names the file for a diff finding and lists secrets files first', () => {
    expect(formatDeny('commit', [finding(3, 'src/a.ts')], ['.env'])).toBe(
      `secret-guard blocked this commit: .env looks like a secrets file; GitHub token (ghp_…XyZ9) on line 3 of src/a.ts.\n${ADVICE}`,
    )
  })
  test('lists three items and counts the rest', () => {
    const message = formatDeny('write', [finding(1), finding(2), finding(3), finding(4), finding(5)], [])
    expect(message).toContain('on line 3; and 2 more.')
    expect(message).not.toContain('on line 4')
  })
})

describe('formatToast', () => {
  test('shows the first item and a count of the rest', () => {
    expect(formatToast('command', [finding(1), finding(2)], [])).toBe(
      'Blocked a command: GitHub token (ghp_…XyZ9) on line 1 (+1 more)',
    )
  })
})

describe('textOf', () => {
  test('collects the text fields a guarded tool carries', () => {
    expect(textOf({ tool: 'Write', file_path: 'a', content: 'x' })).toBe('x')
    expect(textOf({ tool: 'Edit', old_string: 'o', new_string: 'n' })).toBe('n')
    expect(textOf({ tool: 'Bash', command: 'ls' })).toBe('ls')
    expect(textOf({ tool: 'Read' })).toBe('')
  })
})

describe('failClosed', () => {
  const nextWith = (called: boolean, kind: 'throw' | 'timeout' | 're-entry') =>
    Object.assign(async (_e: object) => ({ result: 'ran' }), { called, error: { kind } }) as never

  test('denies when the hook crashed before calling next', async () => {
    expect(await failClosed({ content: 'x' }, nextWith(false, 'throw'), BUILTIN_PATTERNS)).toEqual({ deny: CRASH_DENY })
  })
  test('replays next when the hook crashed after calling it', async () => {
    expect(await failClosed({ content: 'x' }, nextWith(true, 'timeout'), BUILTIN_PATTERNS)).toEqual({ result: 'ran' })
  })
  test('on re-entry, denies text holding a secret', async () => {
    expect(await failClosed({ content: fake.github() }, nextWith(false, 're-entry'), BUILTIN_PATTERNS)).toEqual({
      deny: REENTRY_DENY,
    })
  })
  test('on re-entry, lets clean text through', async () => {
    expect(await failClosed({ content: 'clean' }, nextWith(false, 're-entry'), BUILTIN_PATTERNS)).toEqual({
      result: 'ran',
    })
  })
})

describe('failClosed on re-entry, minor fix', () => {
  const reentry = Object.assign(async (_e: object) => ({ result: 'ran' }), { called: false, error: { kind: 're-entry' } }) as never
  test('honours the skip list for a write', async () => {
    const e = { file_path: 'C:/repo/fixtures/keys.ts', content: fake.github() }
    expect(await failClosed(e, reentry, BUILTIN_PATTERNS, path => path.includes('fixtures'))).toEqual({ result: 'ran' })
  })
  test('still denies a secret outside the skip list', async () => {
    const e = { file_path: 'src/keys.ts', content: fake.github() }
    expect(await failClosed(e, reentry, BUILTIN_PATTERNS, path => path.includes('fixtures'))).toEqual({ deny: REENTRY_DENY })
  })
})
