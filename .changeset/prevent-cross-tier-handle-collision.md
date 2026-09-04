---
'@atproto/pds': patch
---

Prevent a Catcher and a Striker from sharing the same base name (e.g. `alice.guest.sunnahsky.com` and `alice.sunnahsky.com` both existing at once) — checked symmetrically at signup and rename, in both directions.
