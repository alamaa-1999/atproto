import { type PlainMessage, Timestamp } from '@bufbuild/protobuf'
import type { ServiceImpl } from '@connectrpc/connect'
import type { Service } from '../../../proto/bsky_connect.js'
import type { ArticleDraftInfo } from '../../../proto/bsky_pb.js'
import { Namespaces } from '../../../stash.js'
import type { Database } from '../db/index.js'
import { IsoUpdatedAtKey } from '../db/pagination.js'
import { countAll } from '../db/util.js'

// Reads directly from the generic `private_data` table (see stash.ts /
// bsync-subscription.ts's handleGenericOperation) rather than a dedicated
// table - see the article-drafts plan's Context section for why no
// dedicated table/migration is needed here, unlike `draft`/`bookmark`.
export default (db: Database): Partial<ServiceImpl<typeof Service>> => ({
  async getActorArticleDrafts(req) {
    const { actorDid, cursor, limit } = req
    const { ref } = db.db.dynamic

    let builder = db.db
      .selectFrom('private_data')
      .where('private_data.actorDid', '=', actorDid)
      .where(
        'private_data.namespace',
        '=',
        Namespaces.ComSunnahskyArticleDraftDefsDraftWithId.$type,
      )
      .selectAll()

    const key = new IsoUpdatedAtKey(ref('private_data.updatedAt'))
    builder = key.paginate(builder, {
      cursor,
      limit,
    })

    const page = key.page(await builder.execute(), limit)
    return {
      drafts: page.items.map((d): PlainMessage<ArticleDraftInfo> => ({
        key: d.key,
        payload: Buffer.from(d.payload),
        createdAt: Timestamp.fromDate(new Date(d.indexedAt)),
        updatedAt: Timestamp.fromDate(new Date(d.updatedAt)),
      })),
      cursor: page.cursor,
    }
  },

  // Single-row existence check for updateDraft's create-via-update gate -
  // see com.sunnahsky.article.draft.updateDraft's API handler.
  async getActorArticleDraft(req) {
    const { actorDid, key } = req
    const row = await db.db
      .selectFrom('private_data')
      .where('private_data.actorDid', '=', actorDid)
      .where(
        'private_data.namespace',
        '=',
        Namespaces.ComSunnahskyArticleDraftDefsDraftWithId.$type,
      )
      .where('private_data.key', '=', key)
      .select('private_data.key')
      .executeTakeFirst()
    return { exists: !!row }
  },

  // Real COUNT(*) for the drafts-limit check - see the doc comment on the
  // proto message this backs.
  async getActorArticleDraftsCount(req) {
    const { actorDid } = req
    const row = await db.db
      .selectFrom('private_data')
      .where('private_data.actorDid', '=', actorDid)
      .where(
        'private_data.namespace',
        '=',
        Namespaces.ComSunnahskyArticleDraftDefsDraftWithId.$type,
      )
      .select(countAll.as('count'))
      .executeTakeFirst()
    return { count: row?.count ?? 0 }
  },
})
