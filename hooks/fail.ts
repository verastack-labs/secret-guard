import type { Caught } from 'claude-code'

import type { Pattern } from './patterns'
import { scan } from './scan'

export const CRASH_DENY =
  'secret-guard failed while checking this call; ask the user to run /allow-secret if it should go through.'

export const REENTRY_DENY =
  'secret-guard could not fully check this call and it contains a likely secret; ask the user to run /allow-secret if it should go through.'

const TEXT_FIELDS = ['content', 'new_string', 'new_source', 'command'] as const

/** The text a guarded tool call would write or run. */
export function textOf(e: object): string {
  const record = e as Record<string, unknown>
  return TEXT_FIELDS.map(key => record[key])
    .filter((value): value is string => typeof value === 'string')
    .join('\n')
}

/** The file a guarded write targets, if any. */
function pathOf(e: object): string | undefined {
  const record = e as Record<string, unknown>
  const path = record.file_path ?? record.notebook_path
  return typeof path === 'string' ? path : undefined
}

/**
 * The `.catch` handler of every guarding hook. A crash before `next` denies;
 * a crash after it replays what `next` settled to. On re-entry, where the hook
 * cannot run and `$` calls reject, it judges `e` with the scanner alone,
 * honouring the skip list.
 */
export async function failClosed<E extends object, R>(
  e: E,
  next: ((e: E) => Promise<R>) & Caught,
  patterns: readonly Pattern[],
  isSkipped: (path: string) => boolean = () => false,
): Promise<R | { deny: string }> {
  if (next.error.kind === 're-entry') {
    const path = pathOf(e)
    if (path !== undefined && isSkipped(path)) return next(e)
    return scan(textOf(e), patterns).length > 0 ? { deny: REENTRY_DENY } : next(e)
  }
  return next.called ? next(e) : { deny: CRASH_DENY }
}
