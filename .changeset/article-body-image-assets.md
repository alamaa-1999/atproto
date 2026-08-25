---
'@atproto/pds': patch
---

Add `com.sunnahsky.article.assets`, a companion record holding the blob refs for images embedded in an article body, and extend `com.sunnahsky.article.draft.defs#draft` with `bodyImages`.

Body images previously never displayed. atproto only promotes a blob out of temporary storage when a record field of type `blob` references it, and an article body carries its images as markdown URLs rather than record fields, so those blobs stayed untethered and `com.atproto.sync.getBlob` returned 404 for them permanently. Cover images were unaffected because they genuinely are blob fields. The new record gives body-image blobs a field to be referenced from, written atomically alongside the document it belongs to and sharing its rkey.

The collection is registered in `knownSchemas` (repo writes from the article client pass `validate: true`, which rejects unregistered `$type`s) and added to the Catcher branch of `assertCanWriteRecord` — that function falls through to allow any collection it does not name, so this is required rather than defensive.

`bodyImages` on the draft stores the full `BlobRef`s while an article is unpublished. A ref cannot be reconstructed from the CID in a markdown URL alone, since `mimeType` and `size` are unreadable for an untethered blob, so without it a draft's images would be dropped on publish after the composer was closed. Draft blobs stay untethered and are therefore not enumerable via `com.atproto.sync.listBlobs`; they are tethered only at publish.
