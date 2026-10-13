/** One git command found in a shell command, with the folder it runs in. */
export type GitStep =
  | { kind: 'add'; cwd: string | undefined; args: string[] }
  | { kind: 'commit'; cwd: string | undefined; all: boolean }

const SEPARATORS = /&&|\|\||;|\r?\n/
const TOKEN = /"([^"]*)"|'([^']*)'|(\S+)/g
const CHANGE_DIR = new Set(['cd', 'chdir', 'set-location', 'sl', 'pushd'])

/** Splits a command segment into arguments, keeping quoted ones whole. */
export function tokenize(segment: string): string[] {
  const tokens: string[] = []
  for (const match of segment.matchAll(TOKEN)) tokens.push(match[1] ?? match[2] ?? match[3] ?? '')
  return tokens
}

/** `next` relative to `base`, or `next` alone when it is absolute or there is no base. */
export function joinDir(base: string | undefined, next: string): string {
  if (base === undefined || /^(?:[A-Za-z]:|[\\/]|~)/.test(next)) return next
  return `${base.replace(/[\\/]+$/, '')}/${next}`
}

function isAllFlag(token: string): boolean {
  return token === '--all' || /^-[A-Za-z]*a[A-Za-z]*$/.test(token)
}

/**
 * The git add and git commit steps in a shell command, in order, each with
 * the folder a leading cd, Set-Location or git -C points it at.
 */
export function parseGitSteps(command: string): GitStep[] {
  const steps: GitStep[] = []
  let cwd: string | undefined
  for (const segment of command.split(SEPARATORS)) {
    const tokens = tokenize(segment.trim())
    const head = tokens[0]?.toLowerCase()
    if (head === undefined) continue
    if (CHANGE_DIR.has(head)) {
      const dir = tokens[1]
      if (dir !== undefined) cwd = joinDir(cwd, dir)
      continue
    }
    if (head !== 'git' && head !== 'git.exe') continue
    let stepCwd = cwd
    let i = 1
    while (i < tokens.length && (tokens[i] ?? '').startsWith('-')) {
      const flag = tokens[i]
      if (flag === '-C') {
        const dir = tokens[i + 1]
        if (dir !== undefined) stepCwd = joinDir(stepCwd, dir)
        i += 2
      } else if (flag === '-c') {
        i += 2
      } else {
        i += 1
      }
    }
    const subcommand = tokens[i]
    const rest = tokens.slice(i + 1)
    if (subcommand === 'add') steps.push({ kind: 'add', cwd: stepCwd, args: rest })
    if (subcommand === 'commit') steps.push({ kind: 'commit', cwd: stepCwd, all: rest.some(isAllFlag) })
  }
  return steps
}
