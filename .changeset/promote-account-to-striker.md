---
'@atproto/pds': patch
---

Add `com.atproto.admin.promoteAccountToStriker`, a coupled operation that migrates an existing Catcher account's handle to the Striker domain and flips its `role`, together — the only way `role` can change post-creation. Handle migrates first, then role, with an explicit idempotency branch for a handle-migrated-but-role-not-flipped partial-failure state.
