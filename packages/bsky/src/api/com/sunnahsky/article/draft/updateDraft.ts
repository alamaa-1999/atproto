import type { Server } from '@atproto/xrpc-server'
import type { AppContext } from '../../../../../context.js'
import { com } from '../../../../../lexicons/index.js'
import { Namespaces } from '../../../../../stash.js'
import { assertCanCreateArticleDraft } from './util.js'

export default function (server: Server, ctx: AppContext) {
  server.add(com.sunnahsky.article.draft.updateDraft, {
    auth: ctx.authVerifier.standard,
    handler: async ({ input, auth }) => {
      const actorDid = auth.credentials.iss
      const { draft: draftWithId } = input.body

      // A fresh, self-chosen id here is effectively a create-via-update -
      // bsync's PutOperation has no built-in existence check for
      // Method.UPDATE (its own upstream comment on this exact endpoint
      // says so explicitly), and this design's read side (private_data)
      // has no bespoke branch to no-op a missing-row update the way
      // app.bsky.draft's dedicated table does. So the same Striker + limit
      // gate createDraft uses has to re-run here whenever the target
      // doesn't already exist - no exploitable race, since rows are keyed
      // per-actor and a caller can never observe "exists" for a key they
      // didn't already legitimately create themselves.
      const { exists } = await ctx.dataplane.getActorArticleDraft({
        actorDid,
        key: draftWithId.id,
      })
      if (!exists) {
        await assertCanCreateArticleDraft(ctx, actorDid)
      }

      await ctx.stashClient.update({
        actorDid,
        namespace: Namespaces.ComSunnahskyArticleDraftDefsDraftWithId,
        payload: draftWithId,
        key: draftWithId.id,
      })
    },
  })
}
