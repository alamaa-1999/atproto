---
'@atproto/pds': patch
---

Gate writes to `site.standard.document` and `site.standard.publication` records to Striker-role accounts (Catchers are rejected unconditionally, with no reply-style exception), and register both schemas in the write-path's known-schema validation table so `validate: true` now performs real shape validation instead of accepting them as unknown lexicon types.
