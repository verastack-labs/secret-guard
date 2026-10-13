import { describe, expect, test } from 'claude-code/testing'

import { joinDir, parseGitSteps, tokenize } from './git'

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
