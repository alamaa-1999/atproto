import { TID } from '@atproto/common'
import type { Server } from '@atproto/xrpc-server'
import type { AppContext } from '../../../../../context.js'
import { com } from '../../../../../lexicons/index.js'
import { Namespaces } from '../../../../../stash.js'
import { assertCanCreateArticleDraft } from './util.js'

export default function (server: Server, ctx: AppContext) {
  server.add(com.sunnahsky.article.draft.createDraft, {
    auth: ctx.authVerifier.standard,
    handler: async ({ input, auth }) => {
      const actorDid = auth.credentials.iss
      const { draft } = input.body

      await assertCanCreateArticleDraft(ctx, actorDid)

      const draftId = TID.nextStr()
      const draftWithId: com.sunnahsky.article.draft.defs.DraftWithId = {
        id: draftId,
        draft,
      }

      await ctx.stashClient.create({
        actorDid,
        namespace: Namespaces.ComSunnahskyArticleDraftDefsDraftWithId,
        payload: draftWithId,
        key: draftId,
      })

      return {
        encoding: 'application/json' as const,
        body: { id: draftId },
      }
    },
  })
}
