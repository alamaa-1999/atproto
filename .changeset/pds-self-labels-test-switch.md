---
'@atproto/pds': patch
'@atproto/dev-env': patch
---

Let code that builds the PDS environment switch off Sunnahsky's self-label rule (`allowAnySelfLabel`), which no environment variable can set; dev-env does so by default, because upstream's test seeds write made-up self-labels
