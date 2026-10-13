import { describe, expect, test } from 'claude-code/testing'

import { joinDir, parseGitSteps, scanDiff, tokenize } from './git'
import { fake } from './helpers'
import { BUILTIN_PATTERNS } from './patterns'

describe('tokenize', () => {
  test('keeps quoted arguments whole', () => {
    expect(tokenize(`git commit -m "fix the thing" --author 'A B'`)).toEqual([
      'git', 'commit', '-m', 'fix the thing', '--author', 'A B',
    ])
  })
})

describe('joinDir', () => {
  test('joins relative folders and replaces on an absolute one', () => {
    expect(joinDir(undefined, 'repo')).toBe('repo')
    expect(joinDir('repo', 'sub')).toBe('repo/sub')
    expect(joinDir('repo', 'C:\\other')).toBe('C:\\other')
    expect(joinDir('repo', '/abs')).toBe('/abs')
  })
})

describe('parseGitSteps', () => {
  test('finds no steps in an unrelated command', () => {
    expect(parseGitSteps('ls -la && npm test')).toEqual([])
  })
  test('finds an add with its arguments', () => {
    expect(parseGitSteps('git add src .env')).toEqual([{ kind: 'add', cwd: undefined, args: ['src', '.env'] }])
  })
  test('finds a chained add and commit', () => {
    expect(parseGitSteps('git add . && git commit -m "x"')).toEqual([
      { kind: 'add', cwd: undefined, args: ['.'] },
      { kind: 'commit', cwd: undefined, all: false },
    ])
  })
  test('spots -a, -am and --all on a commit, not --amend', () => {
    expect(parseGitSteps('git commit -a -m x')).toEqual([{ kind: 'commit', cwd: undefined, all: true }])
    expect(parseGitSteps('git commit -am x')).toEqual([{ kind: 'commit', cwd: undefined, all: true }])
    expect(parseGitSteps('git commit --all -m x')).toEqual([{ kind: 'commit', cwd: undefined, all: true }])
    expect(parseGitSteps('git commit --amend -m x')).toEqual([{ kind: 'commit', cwd: undefined, all: false }])
  })
  test('follows cd and Set-Location, and git -C', () => {
    expect(parseGitSteps('cd ../other && git commit -m x')).toEqual([{ kind: 'commit', cwd: '../other', all: false }])
    expect(parseGitSteps('Set-Location C:\\repo; git add .')).toEqual([{ kind: 'add', cwd: 'C:\\repo', args: ['.'] }])
    expect(parseGitSteps('git -C repo commit -m x')).toEqual([{ kind: 'commit', cwd: 'repo', all: false }])
    expect(parseGitSteps('cd a && git -C b add .')).toEqual([{ kind: 'add', cwd: 'a/b', args: ['.'] }])
  })
  test('skips -c config pairs before the subcommand', () => {
    expect(parseGitSteps('git -c user.name=x commit -m y')).toEqual([{ kind: 'commit', cwd: undefined, all: false }])
  })
  test('a commit message holding ; or && is still a commit', () => {
    expect(parseGitSteps('git commit -m "fix; tidy && more"')).toEqual([{ kind: 'commit', cwd: undefined, all: false }])
  })
})

const noSkip = () => false

const diffOf = (path: string, lines: string[], start = 1) =>
  [
    `diff --git a/${path} b/${path}`,
    'index 1111111..2222222 100644',
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -0,0 +${start},${lines.length} @@`,
    ...lines,
  ].join('\n')

describe('scanDiff', () => {
  test('finds an added secret with its file and new line number', () => {
    const diff = diffOf('src/pay.ts', ['+const a = 1', `+const key = '${fake.stripe()}'`], 10)
    expect(scanDiff(diff, BUILTIN_PATTERNS, noSkip)).toEqual([
      { name: 'Stripe key', line: 11, preview: expect.any(String), file: 'src/pay.ts' },
    ])
  })
  test('ignores removed lines', () => {
    const diff = diffOf('src/pay.ts', [`-const key = '${fake.stripe()}'`, '+const key = process.env.KEY'])
    expect(scanDiff(diff, BUILTIN_PATTERNS, noSkip)).toEqual([])
  })
  test('tracks files and hunks separately', () => {
    const diff = [
      diffOf('a.ts', ['+one'], 5),
      '@@ -20,0 +40,1 @@',
      `+${fake.aws()}`,
      diffOf('b.ts', [`+${fake.npm()}`], 2),
    ].join('\n')
    expect(scanDiff(diff, BUILTIN_PATTERNS, noSkip).map(f => [f.file, f.line, f.name])).toEqual([
      ['a.ts', 40, 'AWS access key'],
      ['b.ts', 2, 'npm token'],
    ])
  })
  test('reads Windows line endings', () => {
    const diff = diffOf('src/pay.ts', ['+const a = 1', `+${fake.stripe()}`]).replace(/\n/g, '\r\n')
    expect(scanDiff(diff, BUILTIN_PATTERNS, noSkip).map(f => [f.file, f.line])).toEqual([['src/pay.ts', 2]])
  })
  test('skips findings in skipped paths', () => {
    const diff = diffOf('fixtures/keys.ts', [`+${fake.stripe()}`])
    expect(scanDiff(diff, BUILTIN_PATTERNS, path => path.startsWith('fixtures/'))).toEqual([])
  })
})
