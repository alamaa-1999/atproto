import type { Server } from '@atproto/xrpc-server'
import type { AppContext } from '../../../../context.js'
import { com } from '../../../../lexicons/index.js'

// THIS IS A TEMPORARY UNSPECCED ROUTE, specific to this fork's role model.
export default function (server: Server, ctx: AppContext) {
  server.add(com.atproto.temp.listStrikers, async ({ params }) => {
    const { limit, cursor } = params
    const { strikers, cursor: nextCursor } =
      await ctx.accountManager.listStrikers({ limit, cursor })
    return {
      encoding: 'application/json' as const,
      body: { strikers, cursor: nextCursor },
    }
  })
}
