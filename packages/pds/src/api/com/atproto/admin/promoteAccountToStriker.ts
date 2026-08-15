import { InvalidRequestError, type Server } from '@atproto/xrpc-server'
import type { AppContext } from '../../../../context.js'
import { com } from '../../../../lexicons/index.js'

export default function (server: Server, ctx: AppContext) {
  server.add(com.atproto.admin.promoteAccountToStriker, {
    auth: ctx.authVerifier.adminToken,
    handler: async ({ input: { body } }) => {
      const account = await ctx.accountManager.getAccount(body.account, {
        includeDeactivated: true,
        includeTakenDown: true,
      })
      if (!account) {
        throw new InvalidRequestError(`Account does not exist: ${body.account}`)
      }

      const promoted = await ctx.accountManager.promoteToStriker(account.did)

      return {
        encoding: 'application/json' as const,
        body: { did: promoted.did, handle: promoted.handle },
      }
    },
  })
}
