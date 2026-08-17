---
'@atproto/pds': patch
---

Add `com.atproto.temp.listStrikers`, an unauthenticated route enumerating DID/handle for every active account with the Striker role — backs the client's synthetic "Discover" feed (all Strikers, chronological), no new indexer. Not a new privacy exposure: `com.atproto.sync.listRepos` already exposes every DID hosted on this server, unauthenticated; this returns a filtered subset (Strikers only) of that same set.
