---
'@atproto/pds': patch
---

Add `com.atproto.temp.listStrikers`, an unauthenticated route enumerating DID/handle for every active account with the Striker role — backs the client's synthetic "Discover" feed (all Strikers, chronological), no new indexer.

This is the first unauthenticated route that bulk-enumerates DID→handle→role for the whole Striker membership in a single paginated call. `com.atproto.sync.listRepos` already exposes every DID hosted on this server unauthenticated, but never handle — deriving DID→handle→role for one account was already possible unauthenticated (`resolveHandle`/`getProfile`/`describeRepo`), just one lookup at a time; this collapses that into one bulk call across the whole Striker set. Role itself isn't a new secret category (already correctly boundary-guarded per-account), but the bulk-enumeration shape is new and worth being explicit about, not implied away as equivalent to `listRepos`.
