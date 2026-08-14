import type { LexMap } from '@atproto/lex-data'
import type { NsidString } from '@atproto/syntax'
import { InvalidRequestError } from '@atproto/xrpc-server'
import type { Role } from '../../../../account-manager/db/index.js'
import { app } from '../../../../lexicons/index.js'

// Catchers may only reply to existing threads, never create or edit a
// top-level post. Applies to every write path that can persist an
// app.bsky.feed.post record — create or update — not just createRecord.
export const assertCanWriteRecord = (
  role: Role,
  collection: NsidString,
  record: LexMap,
): void => {
  if (role === 'striker') return
  if (collection !== app.bsky.feed.post.$type) return
  if (record.reply != null) return
  throw new InvalidRequestError(
    'Catchers can only reply to existing threads, not create or edit top-level posts.',
    'CatcherTopLevelPostNotAllowed',
  )
}
