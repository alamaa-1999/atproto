import type { Server } from '@atproto/xrpc-server'
import type { AppContext } from '../../../../../context.js'
import { com } from '../../../../../lexicons/index.js'
import { Namespaces } from '../../../../../stash.js'

export default function (server: Server, ctx: AppContext) {
  server.add(com.sunnahsky.article.draft.deleteDraft, {
    auth: ctx.authVerifier.standard,
    handler: async ({ input, auth }) => {
      const actorDid = auth.credentials.iss
      const { id } = input.body

      await ctx.stashClient.delete({
        actorDid,
        namespace: Namespaces.ComSunnahskyArticleDraftDefsDraftWithId,
        key: id,
      })
    },
  })
}
