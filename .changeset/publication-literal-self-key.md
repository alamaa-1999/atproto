---
'@atproto/pds': patch
---

Fix `site.standard.publication`'s record key: was `tid` (inherited from upstream, which models publications as multiple-per-account), but this fork's write guard and canonical-URL scheme (`assertCanWriteRecord`, `site.standard.document.site === at://{did}/site.standard.publication/self`) assume exactly one publication per account, keyed `literal:self` (matching `app.bsky.actor.profile`'s own singleton pattern). Every write of a publication with rkey `'self'` - the shape `publishArticle` actually sends - was being rejected outright, caught by a forward dry run against a real built image before deploy. Adds PDS test coverage: the exact `applyWrites#create` batch `publishArticle` sends for a first publish (publication + document, atomically) now succeeds, and a publication written with a TID-format rkey is now rejected.
