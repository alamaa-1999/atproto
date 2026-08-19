---
'@atproto/pds': patch
---

`promoteToStriker()` now revokes the account's refresh tokens and OAuth tokens as part of the promotion, forcing any active Catcher session to re-authenticate instead of continuing to run against a stale cached handle. The role flip and both revocations run inside a single transaction, so a failed revoke can't leave the account promoted with its old tokens still valid.
