const SAFE_ENV_FILES = new Set(['.env.example', '.env.sample', '.env.template'])
const KEY_FILES = new Set(['id_rsa', 'id_dsa', 'id_ecdsa', 'id_ed25519'])
const KEY_EXTENSIONS = ['.pem', '.key', '.p12', '.pfx']

/** Backslashes to forward slashes, so Windows and POSIX paths match the same globs. */
export function toSlashes(path: string): string {
  return path.replace(/\\/g, '/')
}

/** The last path segment. */
export function basename(path: string): string {
  const slashed = toSlashes(path)
  return slashed.slice(slashed.lastIndexOf('/') + 1)
}

/** A whole-string regex for a glob: `**` crosses folders, `*` and `?` stay inside one. */
export function globToRegExp(glob: string, flags = ''): RegExp {
  let source = ''
  for (let i = 0; i < glob.length; i += 1) {
    const char = glob[i] ?? ''
    if (char === '*' && glob[i + 1] === '*') {
      if (glob[i + 2] === '/') {
        source += '(?:.*/)?'
        i += 2
      } else {
        source += '.*'
        i += 1
      }
    } else if (char === '*') {
      source += '[^/]*'
    } else if (char === '?') {
      source += '[^/]'
    } else {
      source += char.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    }
  }
  return new RegExp(`^${source}$`, flags)
}

/** The path and every tail of it that starts after a `/`: `a/b/c`, `b/c`, `c`. */
function tails(path: string): string[] {
  const found = [path]
  for (let i = path.indexOf('/'); i !== -1; i = path.indexOf('/', i + 1)) found.push(path.slice(i + 1))
  return found
}

/**
 * A test for the skip list. A glob holding a `/` matches the whole path, or any
 * tail of it, so `test/fixtures/**` matches a repo-relative path from a diff and
 * an absolute one from a write alike; one without a `/` matches the file name.
 * Globs may use backslashes, and matching ignores case, as Windows paths do.
 */
export function makeSkipMatcher(globs: readonly string[]): (path: string) => boolean {
  const rules = globs.map(raw => {
    const glob = toSlashes(raw)
    return { regex: globToRegExp(glob, 'i'), isWholePath: glob.includes('/') }
  })
  return path => {
    const slashed = toSlashes(path)
    const name = basename(slashed)
    return rules.some(rule => (rule.isWholePath ? tails(slashed).some(tail => rule.regex.test(tail)) : rule.regex.test(name)))
  }
}

/** True for files whose purpose is holding secrets: env files, private keys, certificates. */
export function isSecretFile(path: string): boolean {
  const name = basename(path).toLowerCase()
  if (SAFE_ENV_FILES.has(name)) return false
  if (name === '.env' || name.startsWith('.env.')) return true
  if (KEY_FILES.has(name)) return true
  return KEY_EXTENSIONS.some(extension => name.endsWith(extension))
}
