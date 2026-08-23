import { type DatetimeString, lexParse } from '@atproto/lex'
import type { Server } from '@atproto/xrpc-server'
import type { AppContext } from '../../../../../context.js'
import { com } from '../../../../../lexicons/index.js'

export default function (server: Server, ctx: AppContext) {
  server.add(com.sunnahsky.article.draft.getDrafts, {
    auth: ctx.authVerifier.standard,
    handler: async ({ params, auth }) => {
      const viewer = auth.credentials.iss

      const { cursor, drafts } = await ctx.dataplane.getActorArticleDrafts({
        actorDid: viewer,
        limit: params.limit,
        cursor: params.cursor,
      })

      const draftViews = drafts.map(
        (d): com.sunnahsky.article.draft.defs.DraftView => {
          const jsonStr = Buffer.from(d.payload).toString('utf8')
          const draftWithId =
            lexParse<com.sunnahsky.article.draft.defs.DraftWithId>(jsonStr)
          return {
            id: draftWithId.id,
            draft: draftWithId.draft,
            createdAt: (
              d.createdAt?.toDate() ?? new Date(0)
            ).toISOString() as DatetimeString,
            updatedAt: (
              d.updatedAt?.toDate() ?? new Date(0)
            ).toISOString() as DatetimeString,
          }
        },
      )

      return {
        encoding: 'application/json',
        body: {
          cursor,
          drafts: draftViews,
        },
      }
    },
  })
}
