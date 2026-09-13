import type { LexMap } from '@atproto/lex-data'
import type { NsidString } from '@atproto/syntax'
import { InvalidRequestError } from '@atproto/xrpc-server'
import type { ActorAccount } from '../../../../account-manager/helpers/account.js'
import type { ServerConfig } from '../../../../config/config.js'
import { app, com, site } from '../../../../lexicons/index.js'

/**
 * The `/{name}` segment of an account's canonical Sunnahsky URL, leading
 * slash included - `johnsmith.sunnahsky.com` -> `/johnsmith`. Mirrors the
 * app's own `canonicalProfilePath`/`identifierToNameSegment`
 * (`src/lib/strings/profile-path.ts`) but is implemented independently here
 * since this is the server-side enforcement, not a client-trust mirror of
 * it - see "PDS hostname move and public URL scheme".
 *
 * Only ever called on a Striker handle (the write guard below rejects
 * Catchers before reaching any caller of this function), so only the
 * Striker domain is stripped.
 */
const canonicalNameSegment = (
  handle: string,
  strikerHandleDomain: string,
): string => {
  if (!handle.endsWith(strikerHandleDomain)) {
    // Cannot happen for a genuine Striker handle (ensureHandleMatchesRole
    // guarantees the suffix at signup/rename), so this is inconsistent
    // account state - fail closed rather than guess a URL segment from
    // the raw handle (security review, finding 4).
    throw new InvalidRequestError(
      "Cannot compute canonical URL: account's handle does not match the expected Striker domain",
      'InvalidPublicationUrl',
    )
  }
  return `/${handle.slice(0, -strikerHandleDomain.length)}`
}

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
//
// Beyond the role gate, `site.standard.publication`/`document` writes from
// a Striker are further content-checked below - added for "PDS hostname
// move and public URL scheme" (security review, finding 2). Without this,
// `publication.url` is a field any client holding the Striker's own
// credentials can set to anything, and the app's canonical-URL scheme
// (`sunnahsky.com/{name}`) has no server-side backing at all: a Striker
// could point their own share cards at an arbitrary host, or claim another
// Striker's `/{name}` path. The role gate runs first and returns before any
// content check - a Catcher is rejected with `CatcherArticleWriteNotAllowed`
// regardless of what the record contains, never with a publication/document
// validation error (third review, point 5: those two error identities must
// not compete for the same Catcher write).
export const assertCanWriteRecord = (
  account: ActorAccount,
  collection: NsidString,
  record: LexMap,
  cfg: ServerConfig,
): void => {
  if (account.role !== 'striker') {
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
    return
  }

  if (collection === site.standard.publication.$type) {
    if (!account.handle) {
      // An account can transiently have no handle (Actor.handle is
      // HandleString | null); there is no canonical URL to check the
      // record against in that state.
      throw new InvalidRequestError(
        'Cannot write a publication without a registered handle',
        'InvalidPublicationUrl',
      )
    }
    const expectedUrl = `${cfg.service.appUrl}${canonicalNameSegment(
      account.handle,
      cfg.identity.strikerHandleDomain,
    )}`
    if (record.url !== expectedUrl) {
      throw new InvalidRequestError(
        "Publication url must be this account's canonical Sunnahsky URL",
        'InvalidPublicationUrl',
      )
    }
  }

  if (collection === site.standard.document.$type) {
    const expectedSite = `at://${account.did}/site.standard.publication/self`
    if (record.site !== expectedSite) {
      throw new InvalidRequestError(
        "Document site must be this account's own publication",
        'InvalidDocumentSite',
      )
    }
    if (
      typeof record.path !== 'string' ||
      !/^\/article\/[a-z0-9-]+$/.test(record.path)
    ) {
      throw new InvalidRequestError(
        'Document path must match /article/{slug}',
        'InvalidDocumentPath',
      )
    }
  }
}
