---
'@atproto/bsky': minor
---

Add `com.sunnahsky.article.draft.{createDraft,updateDraft,deleteDraft,getDrafts}`, a private, Striker-gated draft-storage feature for the article-authoring composer, mirroring the architecture of `app.bsky.draft` (bsync's `PutOperation`/stash mechanism, same privacy/ownership model) but with an article-shaped payload instead of a post-thread one.

Reads out of the existing generic `private_data` table rather than a new dedicated table - no new migration, no new `bsync-subscription.ts` branch. `createDraft` and `updateDraft`'s create-branch (a fresh, self-chosen draft id passed to `updateDraft` is treated as a create, since bsync's `PutOperation` has no built-in existence check for `Method.UPDATE`) are gated behind a new `assertCanCreateArticleDraft` check: Striker role (verified via a live callout to the account's own PDS, fail-closed on any error/timeout) plus a new `articleDraftsLimit` config value (`BSKY_ARTICLE_DRAFTS_LIMIT`, default 50), mirroring `draftsLimit`'s exact shape.
