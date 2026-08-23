import type { Server } from '@atproto/xrpc-server'
import type { AppContext } from '../../../../context.js'
import { com } from '../../../../lexicons/index.js'

// THIS IS A TEMPORARY UNSPECCED ROUTE, specific to this fork's role model.
export default function (server: Server, ctx: AppContext) {
  server.add(com.atproto.temp.checkStriker, async ({ params }) => {
    const { did } = params
    const account = await ctx.accountManager.getAccount(did)
    return {
      encoding: 'application/json' as const,
      body: { isStriker: account?.role === 'striker' },
    }
  })
}
