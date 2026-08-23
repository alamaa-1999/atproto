---
'@atproto/pds': patch
---

Add `com.atproto.temp.checkStriker`, an unauthenticated single-DID Striker-role lookup, alongside the existing `listStrikers`. Role is not newly sensitive - `listStrikers` already publicly enumerates every Striker DID - this just adds a targeted single-account check for the AppView's `com.sunnahsky.article.draft.createDraft`/`updateDraft` handlers to call back to, since the AppView has no hydrated concept of account role today.
