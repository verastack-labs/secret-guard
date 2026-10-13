import { expect, test } from 'claude-code/testing'

import { fake, harness, slash } from './helpers'

test('a Write containing a GitHub token is denied without echoing it', async ($, on) => {
  const seen = harness(on)
  const ran = await $.tool.call({ tool: 'Write', file_path: 'src/config.ts', content: `const t = '${fake.github()}'\n` })
  expect(ran.deny).toStartWith('secret-guard blocked this write: GitHub token')
  expect(ran.deny).toContain('on line 1')
  expect(ran.deny).not.toContain(fake.github())
  expect(seen.toasts).toHaveLength(1)
  expect(seen.toasts[0]).not.toContain(fake.github())
  expect(seen.statuses).toEqual(['secret-guard: 1 blocked'])
})

test('a clean Write passes with no toast', async ($, on) => {
  const seen = harness(on)
  const ran = await $.tool.call({ tool: 'Write', file_path: 'src/a.ts', content: 'export const a = 1\n' })
  expect(ran.deny).toBeUndefined()
  expect(seen.toasts).toEqual([])
})

test('a Write under fixtures passes', async ($, on) => {
  harness(on)
  const ran = await $.tool.call({ tool: 'Write', file_path: 'C:\\repo\\fixtures\\keys.ts', content: fake.github() })
  expect(ran.deny).toBeUndefined()
})

test('with an empty skip list, a Write under fixtures is denied', { options: { skipPaths: [] } }, async ($, on) => {
  harness(on)
  const ran = await $.tool.call({ tool: 'Write', file_path: 'fixtures/keys.ts', content: fake.github() })
  expect(ran.deny).toBeDefined()
})

test('/allow-secret lets exactly one blocked call through', async ($, on) => {
  const seen = harness(on)
  const reply = await $.command.run(slash('allow-secret'))
  expect(reply.text).toBe('secret-guard: the next blocked call will go through once.')
  const first = await $.tool.call({ tool: 'Write', file_path: 'a.ts', content: fake.aws() })
  expect(first.deny).toBeUndefined()
  expect(seen.toasts).toEqual(['secret-guard: override used, letting this call through once'])
  const second = await $.tool.call({ tool: 'Write', file_path: 'a.ts', content: fake.aws() })
  expect(second.deny).toBeDefined()
})

test('running /allow-secret twice still allows only one call', async ($, on) => {
  harness(on)
  await $.command.run(slash('allow-secret'))
  await $.command.run(slash('allow-secret'))
  expect((await $.tool.call({ tool: 'Write', file_path: 'a.ts', content: fake.aws() })).deny).toBeUndefined()
  expect((await $.tool.call({ tool: 'Write', file_path: 'a.ts', content: fake.aws() })).deny).toBeDefined()
})

test('the block count rises with each block', async ($, on) => {
  const seen = harness(on)
  await $.tool.call({ tool: 'Write', file_path: 'a.ts', content: fake.aws() })
  await $.tool.call({ tool: 'Write', file_path: 'b.ts', content: fake.npm() })
  expect(seen.statuses).toEqual(['secret-guard: 1 blocked', 'secret-guard: 2 blocked'])
})

test('an Edit removing a secret passes', async ($, on) => {
  harness(on)
  const ran = await $.tool.call({ tool: 'Edit', file_path: 'a.ts', old_string: fake.github(), new_string: 'process.env.GH_TOKEN' })
  expect(ran.deny).toBeUndefined()
})

test('an Edit adding a secret is denied', async ($, on) => {
  harness(on)
  const ran = await $.tool.call({ tool: 'Edit', file_path: 'a.ts', old_string: 'TOKEN', new_string: fake.slack() })
  expect(ran.deny).toStartWith('secret-guard blocked this write: Slack token')
})

test('a NotebookEdit adding a secret is denied', async ($, on) => {
  harness(on)
  const ran = await $.tool.call({ tool: 'NotebookEdit', notebook_path: 'a.ipynb', new_source: `key = "${fake.google()}"` })
  expect(ran.deny).toStartWith('secret-guard blocked this write: Google API key')
})

test('a Bash command holding a secret is denied', async ($, on) => {
  harness(on)
  const ran = await $.tool.call({ tool: 'Bash', command: `curl -H "x-api-key: ${fake.anthropic()}" https://api.example.com` })
  expect(ran.deny).toStartWith('secret-guard blocked this command: Anthropic key')
})

test('a PowerShell command holding a secret is denied', async ($, on) => {
  harness(on)
  const ran = await $.tool.call({ tool: 'PowerShell', command: `$env:KEY = "${fake.openai()}"` })
  expect(ran.deny).toStartWith('secret-guard blocked this command: OpenAI key')
})

test(
  'an extra pattern from the config menu is enforced',
  { options: { extraPatterns: ['Mehfil key=mhf_[A-Za-z0-9]{32}'] } },
  async ($, on) => {
    harness(on)
    const ran = await $.tool.call({ tool: 'Write', file_path: 'a.ts', content: 'mhf_' + 'a'.repeat(32) })
    expect(ran.deny).toStartWith('secret-guard blocked this write: Mehfil key')
  },
)
