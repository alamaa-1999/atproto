---
'@atproto/pds': minor
'@atproto/dev-env': patch
---

Server-validate `site.standard.publication`/`document` writes from Strikers: `publication.url` must equal the account's own canonical Sunnahsky URL, `document.site` must point at the account's own publication, and `document.path` must match `/article/{slug}`. Adds `PDS_APP_URL` (required once `PDS_HOSTNAME` is not `localhost`) as the source of the app's public origin. Part of "PDS hostname move and public URL scheme"
