import { describe, expect, test } from 'claude-code/testing'

import { checkGitStep, joinDir, parseGitSteps, scanDiff, tokenize, unquote } from './git'
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
  test('flags after a quoted message holding a separator still count', () => {
    expect(parseGitSteps('git commit -m "fix; tidy" -a')).toEqual([{ kind: 'commit', cwd: undefined, all: true }])
    expect(parseGitSteps('git commit -m "say \\"hi\\"" -a')).toEqual([{ kind: 'commit', cwd: undefined, all: true }])
  })
  test('a cd inside a quoted message does not move later steps', () => {
    expect(parseGitSteps('git commit -m "subject\ncd elsewhere" && git add .')).toEqual([
      { kind: 'commit', cwd: undefined, all: false },
      { kind: 'add', cwd: undefined, args: ['.'] },
    ])
  })
  test('a subshell cd applies inside the parentheses only', () => {
    expect(parseGitSteps('(cd sub && git commit -m x) && git add .')).toEqual([
      { kind: 'commit', cwd: 'sub', all: false },
      { kind: 'add', cwd: undefined, args: ['.'] },
    ])
  })
  test('pipes, background &, env prefixes and full paths to git are understood', () => {
    const commit = [{ kind: 'commit', cwd: undefined, all: false }]
    expect(parseGitSteps('echo x | git commit -F -')).toEqual(commit)
    expect(parseGitSteps('npm test & git add .')).toEqual([{ kind: 'add', cwd: undefined, args: ['.'] }])
    expect(parseGitSteps('GIT_AUTHOR_NAME=x git commit -m y')).toEqual(commit)
    expect(parseGitSteps('/usr/bin/git commit -m y')).toEqual(commit)
    expect(parseGitSteps('& "C:\\Program Files\\Git\\bin\\git.exe" commit -m y')).toEqual(commit)
  })
  test('backslash line continuations join the command', () => {
    expect(parseGitSteps('git \\\n  commit -am x')).toEqual([{ kind: 'commit', cwd: undefined, all: true }])
  })
  test('cd flags are skipped before the folder', () => {
    expect(parseGitSteps('Set-Location -Path C:\\repo; git add .')).toEqual([{ kind: 'add', cwd: 'C:\\repo', args: ['.'] }])
    expect(parseGitSteps('cd -- sub && git add .')).toEqual([{ kind: 'add', cwd: 'sub', args: ['.'] }])
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

describe('minor fixes', () => {
  test('an added line whose content starts with "++ " is content, not a file header', () => {
    const diff = ['diff --git a/a.ts b/a.ts', '--- a/a.ts', '+++ b/a.ts', '@@ -1,0 +1,2 @@', `+++ ${fake.github()}`, '+ok'].join('\n')
    const findings = scanDiff(diff, BUILTIN_PATTERNS, () => false)
    expect(findings.map(f => [f.file, f.line])).toEqual([['a.ts', 1]])
  })
  test('a removed line whose content starts with "-- " does not end the hunk', () => {
    const diff = ['diff --git a/a.ts b/a.ts', '--- a/a.ts', '+++ b/a.ts', '@@ -1,1 +1,1 @@', '--- old', `+${fake.aws()}`].join('\n')
    expect(scanDiff(diff, BUILTIN_PATTERNS, () => false).map(f => [f.file, f.line])).toEqual([['a.ts', 1]])
  })
  test('git options that take a separate value are not read as the subcommand', () => {
    expect(parseGitSteps('git --git-dir /r/.git --work-tree /r add .')).toEqual([
      { kind: 'add', cwd: undefined, args: ['.'], globals: ['--git-dir', '/r/.git', '--work-tree', '/r'] },
    ])
    expect(parseGitSteps('git --namespace ns commit -m x')).toEqual([{ kind: 'commit', cwd: undefined, all: false, globals: ['--namespace', 'ns'] }])
  })
  test('C-quoted paths are unquoted, including escaped quotes and UTF-8 octal bytes', () => {
    expect(unquote('"caf\\303\\251.ts"')).toBe('café.ts')
    expect(unquote('"sp\\"ace\\tx/.env"')).toBe('sp"ace\tx/.env')
    expect(unquote('plain/path.ts')).toBe('plain/path.ts')
    const diff = ['diff --git "a/caf\\303\\251.ts" "b/caf\\303\\251.ts"', '--- "a/caf\\303\\251.ts"', '+++ "b/caf\\303\\251.ts"', '@@ -0,0 +1 @@', `+${fake.npm()}`].join('\n')
    expect(scanDiff(diff, BUILTIN_PATTERNS, () => false)[0]?.file).toBe('café.ts')
  })
  test('every git check runs with quotepath off and the step\'s global options', async () => {
    const argvs: string[][] = []
    const run = async (argv: readonly string[]) => {
      argvs.push([...argv])
      return { exitCode: 0, stdout: argv.includes('--name-only') ? '"dir/sp\\"ace/.env"\n' : '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
    }
    const result = await checkGitStep(run, { kind: 'commit', cwd: undefined, all: false, globals: ['--git-dir', '/r/.git'] }, BUILTIN_PATTERNS, () => false)
    expect(argvs.every(argv => argv.slice(0, 5).join(' ') === 'git -c core.quotepath=off --git-dir /r/.git')).toBe(true)
    expect(result.files).toEqual(['dir/sp"ace/.env'])
  })
})
