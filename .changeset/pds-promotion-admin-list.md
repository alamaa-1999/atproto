---
'@atproto/pds': patch
---

Let accounts on `PDS_SUNNAHSKY_ADMIN_DIDS` promote Catchers with a full password session and their own password; OAuth, app-password, deactivated and taken-down sessions are refused, as is self-promotion. Promotion now applies the reserved-name check to the new handle, re-checks an account that is already a Striker instead of refusing it, and finishes by refreshing the account's DID document, sending its identity event again and confirming the handle both ways (`handleConfirmed`). Every attempt by an identified caller is recorded in a new `promotion_record` table (migration 010), in the same transaction as the role change. Adds `com.atproto.temp.checkAdmin` and `com.atproto.temp.listPromotionRecords`
