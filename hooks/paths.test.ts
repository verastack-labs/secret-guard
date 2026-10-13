import { describe, expect, test } from 'claude-code/testing'

import { basename, globToRegExp, isSecretFile, makeSkipMatcher } from './paths'

const DEFAULTS = ['**/fixtures/**', '**/__snapshots__/**', '*.test.*', '*.spec.*']

describe('basename', () => {
  test('handles both slash styles', () => {
    expect(basename('C:\\repo\\src\\a.ts')).toBe('a.ts')
    expect(basename('/repo/src/a.ts')).toBe('a.ts')
    expect(basename('a.ts')).toBe('a.ts')
  })
})

describe('globToRegExp', () => {
  test('** crosses folders, * stays inside one', () => {
    expect(globToRegExp('**/fixtures/**').test('C:/repo/fixtures/deep/a.ts')).toBe(true)
    expect(globToRegExp('src/*.ts').test('src/a.ts')).toBe(true)
    expect(globToRegExp('src/*.ts').test('src/deep/a.ts')).toBe(false)
  })
  test('escapes regex characters in the glob', () => {
    expect(globToRegExp('a+b.ts').test('a+b.ts')).toBe(true)
    expect(globToRegExp('a+b.ts').test('aab.ts')).toBe(false)
  })
})

describe('makeSkipMatcher', () => {
  const isSkipped = makeSkipMatcher(DEFAULTS)
  test('matches Windows and POSIX fixture paths', () => {
    expect(isSkipped('C:\\repo\\fixtures\\a.ts')).toBe(true)
    expect(isSkipped('/repo/fixtures/a.ts')).toBe(true)
    expect(isSkipped('fixtures/a.ts')).toBe(true)
  })
  test('a glob with no slash matches the file name anywhere', () => {
    expect(isSkipped('C:\\repo\\src\\scan.test.ts')).toBe(true)
    expect(isSkipped('src/scan.spec.js')).toBe(true)
  })
  test('ordinary source files are not skipped', () => {
    expect(isSkipped('C:\\repo\\src\\config.ts')).toBe(false)
  })
  test('an empty list skips nothing', () => {
    expect(makeSkipMatcher([])('fixtures/a.ts')).toBe(false)
  })
})

describe('isSecretFile', () => {
  test('.env and its variants are secrets files', () => {
    expect(isSecretFile('.env')).toBe(true)
    expect(isSecretFile('C:\\repo\\.env.local')).toBe(true)
    expect(isSecretFile('apps/web/.env.production')).toBe(true)
  })
  test('example env files are not', () => {
    expect(isSecretFile('.env.example')).toBe(false)
    expect(isSecretFile('.env.sample')).toBe(false)
    expect(isSecretFile('.env.template')).toBe(false)
  })
  test('keys and certificates are secrets files', () => {
    for (const name of ['server.pem', 'tls.key', 'cert.p12', 'cert.pfx', 'id_rsa', 'id_ed25519']) {
      expect(isSecretFile(`keys/${name}`)).toBe(true)
    }
  })
  test('.npmrc, public keys and ordinary files are not', () => {
    expect(isSecretFile('.npmrc')).toBe(false)
    expect(isSecretFile('id_rsa.pub')).toBe(false)
    expect(isSecretFile('src/env.ts')).toBe(false)
  })
})
