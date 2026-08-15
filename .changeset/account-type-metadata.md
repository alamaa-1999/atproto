---
'@atproto/pds': patch
---

Add `accountType: 'person' | 'institution'` metadata to accounts, mirroring the existing `role` column. Admin-gated on `com.atproto.server.createAccount` (defaults to `'person'` for non-admin callers), plus a new `com.atproto.admin.updateAccountType` route for promoting an existing account to institution status later.
