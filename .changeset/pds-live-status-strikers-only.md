---
'@atproto/pds': patch
---

Reject `app.bsky.actor.status` writes ("Live now") from accounts that are not Strikers, on create, update and batch writes, with `CatcherLiveStatusNotAllowed`. Deletes stay allowed, so a Catcher can still clear a status.
