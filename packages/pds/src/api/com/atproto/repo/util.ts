import type { LexMap } from '@atproto/lex-data'
import type { NsidString } from '@atproto/syntax'
import { InvalidRequestError } from '@atproto/xrpc-server'
import type { Role } from '../../../../account-manager/db/index.js'
import { app, com, site } from '../../../../lexicons/index.js'

// Catchers may only reply to existing threads, never create or edit a
// top-level post. Catchers may never write articles or publications at
// all — there is no reply-style exception for those collections.
// Applies to every write path that can persist these record types —
// create or update — not just createRecord.
//
// NOTE for anyone adding an article-adjacent collection here: this
// function falls through to *allow* any collection it does not name, so
// a new collection is writable by Catchers until it gains a branch
// below. `com.sunnahsky.article.assets` holds the blob refs that keep a
// published article's body images alive, so it belongs with the two
// site.standard collections rather than being left to the default.
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
    collection === site.standard.publication.$type ||
    collection === com.sunnahsky.article.assets.$type
  ) {
    throw new InvalidRequestError(
      'Catchers cannot create or edit articles or publications.',
      'CatcherArticleWriteNotAllowed',
    )
  }
}
