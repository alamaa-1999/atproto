---
'@atproto/pds': patch
---

`promoteToStriker()` now revokes the account's refresh tokens and OAuth tokens as part of the promotion, forcing any active Catcher session to re-authenticate instead of continuing to run against a stale cached handle.
