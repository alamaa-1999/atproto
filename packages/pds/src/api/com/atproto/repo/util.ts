import type { LexMap } from '@atproto/lex-data'
import type { NsidString } from '@atproto/syntax'
import { InvalidRequestError } from '@atproto/xrpc-server'
import type { Role } from '../../../../account-manager/db/index.js'
import { app, site } from '../../../../lexicons/index.js'

// Catchers may only reply to existing threads, never create or edit a
// top-level post. Catchers may never write articles or publications at
// all — there is no reply-style exception for those collections.
// Applies to every write path that can persist these record types —
// create or update — not just createRecord.
export const assertCanWriteRecord = (
  role: Role,
  collection: NsidString,
  record: LexMap,
): void => {
  if (role === 'striker') return

  if (collection === app.bsky.feed.post.$type) {
    if (record.reply != null) return
    throw new InvalidRequestError(
      'Catchers can only reply to existing threads, not create or edit top-level posts.',
      'CatcherTopLevelPostNotAllowed',
    )
  }

  if (
    collection === site.standard.document.$type ||
    collection === site.standard.publication.$type
  ) {
    throw new InvalidRequestError(
      'Catchers cannot create or edit articles or publications.',
      'CatcherArticleWriteNotAllowed',
    )
  }
}
