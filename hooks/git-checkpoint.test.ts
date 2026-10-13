import { expect, test } from 'claude-code/testing'

import { fake, git, harness, slash } from './helpers'

const DIFF = '--no-color --no-ext-diff -U0'

const stagedDiff = (path: string, line: string) =>
  [`diff --git a/${path} b/${path}`, `--- a/${path}`, `+++ b/${path}`, '@@ -0,0 +1,1 @@', line].join('\n')

test('git add .env is denied', async ($, on) => {
  harness(on)
  git(on, { 'git add --dry-run .env': { stdout: "add '.env'\n" } })
  const ran = await $.tool.call({ tool: 'Bash', command: 'git add .env' })
  expect(ran.deny).toStartWith('secret-guard blocked this command: .env looks like a secrets file')
})

test('git add . is denied when the dry run lists a secrets file', async ($, on) => {
  harness(on)
  git(on, { 'git add --dry-run .': { stdout: "add 'src/a.ts'\nadd 'config/.env.local'\n" } })
  const ran = await $.tool.call({ tool: 'Bash', command: 'git add .' })
  expect(ran.deny).toContain('config/.env.local looks like a secrets file')
})

test('git add . passes when the dry run lists only source files', async ($, on) => {
  harness(on)
  git(on, { 'git add --dry-run .': { stdout: "add 'src/a.ts'\nadd '.env.example'\n" } })
  expect((await $.tool.call({ tool: 'Bash', command: 'git add .' })).deny).toBeUndefined()
})

test('git commit is denied when the staged diff adds a secret', async ($, on) => {
  harness(on)
  git(on, {
    'git diff --cached --name-only': { stdout: 'src/pay.ts\n' },
    [`git diff --cached ${DIFF}`]: { stdout: stagedDiff('src/pay.ts', `+const k = '${fake.stripe()}'`) },
  })
  const ran = await $.tool.call({ tool: 'Bash', command: 'git commit -m "add payments"' })
  expect(ran.deny).toStartWith('secret-guard blocked this commit: Stripe key')
  expect(ran.deny).toContain('on line 1 of src/pay.ts')
  expect(ran.deny).not.toContain(fake.stripe())
})

test('git commit passes when the staged diff removes a secret', async ($, on) => {
  harness(on)
  git(on, {
    'git diff --cached --name-only': { stdout: 'src/pay.ts\n' },
    [`git diff --cached ${DIFF}`]: { stdout: stagedDiff('src/pay.ts', `-const k = '${fake.stripe()}'`) },
  })
  expect((await $.tool.call({ tool: 'Bash', command: 'git commit -m x' })).deny).toBeUndefined()
})

test('git commit is denied when a secrets file is staged', async ($, on) => {
  harness(on)
  git(on, { 'git diff --cached --name-only': { stdout: 'src/a.ts\n.env\n' } })
  const ran = await $.tool.call({ tool: 'Bash', command: 'git commit -m x' })
  expect(ran.deny).toStartWith('secret-guard blocked this commit: .env looks like a secrets file')
})

test('git commit -am compares against HEAD', async ($, on) => {
  harness(on)
  const calls = git(on, {})
  await $.tool.call({ tool: 'Bash', command: 'git commit -am x' })
  expect(calls.map(c => c.argv)).toEqual(['git diff HEAD --name-only', `git diff HEAD ${DIFF}`])
})

test('a leading cd points git at that folder', async ($, on) => {
  harness(on)
  const calls = git(on, {})
  await $.tool.call({ tool: 'Bash', command: 'cd ../other && git commit -m x' })
  expect(calls.map(c => c.cwd)).toEqual(['../other', '../other'])
})

test('git -C points git at that folder, in PowerShell too', async ($, on) => {
  harness(on)
  const calls = git(on, {})
  await $.tool.call({ tool: 'PowerShell', command: 'git -C repo commit -m x' })
  expect(calls.map(c => c.cwd)).toEqual(['repo', 'repo'])
})

test('a git error lets the command through', async ($, on) => {
  harness(on)
  git(on, { 'git diff --cached --name-only': { exitCode: 128, stderr: 'fatal: not a git repository' } })
  expect((await $.tool.call({ tool: 'Bash', command: 'git commit -m x' })).deny).toBeUndefined()
})

test('git not being installed lets the command through', async ($, on) => {
  harness(on)
  git(on, { 'git diff --cached --name-only': 'missing', 'git add --dry-run .': 'missing' })
  expect((await $.tool.call({ tool: 'Bash', command: 'git add . && git commit -m x' })).deny).toBeUndefined()
})

test('a truncated diff warns and still scans what came back', async ($, on) => {
  const seen = harness(on)
  git(on, {
    'git diff --cached --name-only': { stdout: 'src/a.ts\n' },
    [`git diff --cached ${DIFF}`]: { stdout: stagedDiff('src/a.ts', '+const a = 1'), isStdoutTruncated: true },
  })
  expect((await $.tool.call({ tool: 'Bash', command: 'git commit -m x' })).deny).toBeUndefined()
  expect(seen.toasts).toEqual(['secret-guard: part of the git output was too large to check'])
})

test('a fixture committed with a fake key passes, a fixtures .env does not', async ($, on) => {
  harness(on)
  git(on, {
    'git diff --cached --name-only': { stdout: 'fixtures/keys.ts\n' },
    [`git diff --cached ${DIFF}`]: { stdout: stagedDiff('fixtures/keys.ts', `+${fake.github()}`) },
    'git add --dry-run fixtures': { stdout: "add 'fixtures/.env'\n" },
  })
  expect((await $.tool.call({ tool: 'Bash', command: 'git commit -m x' })).deny).toBeUndefined()
  expect((await $.tool.call({ tool: 'Bash', command: 'git add fixtures' })).deny).toContain('fixtures/.env')
})

test('/allow-secret lets one blocked commit through', async ($, on) => {
  harness(on)
  git(on, { 'git diff --cached --name-only': { stdout: '.env\n' } })
  await $.command.run(slash('allow-secret'))
  expect((await $.tool.call({ tool: 'Bash', command: 'git commit -m x' })).deny).toBeUndefined()
  expect((await $.tool.call({ tool: 'Bash', command: 'git commit -m x' })).deny).toBeDefined()
})

test('with the git checkpoint off, git is never run', { options: { gitCheckpoint: false } }, async ($, on) => {
  harness(on)
  const calls = git(on, { 'git diff --cached --name-only': { stdout: '.env\n' } })
  expect((await $.tool.call({ tool: 'Bash', command: 'git add .env && git commit -m x' })).deny).toBeUndefined()
  expect(calls).toEqual([])
})

test('an interactive git add is not dry-run', async ($, on) => {
  harness(on)
  const calls = git(on, {})
  await $.tool.call({ tool: 'Bash', command: 'git add -p' })
  expect(calls).toEqual([])
})
