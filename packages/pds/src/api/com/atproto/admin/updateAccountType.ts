import { InvalidRequestError, type Server } from '@atproto/xrpc-server'
import type { AccountType } from '../../../../account-manager/db/index.js'
import type { AppContext } from '../../../../context.js'
import { com } from '../../../../lexicons/index.js'

export default function (server: Server, ctx: AppContext) {
  server.add(com.atproto.admin.updateAccountType, {
    auth: ctx.authVerifier.adminToken,
    handler: async ({ input: { body } }) => {
      let accountType: AccountType
      if (body.accountType === 'person') {
        accountType = 'person'
      } else if (body.accountType === 'institution') {
        accountType = 'institution'
      } else {
        throw new InvalidRequestError(
          `Invalid accountType: ${body.accountType}`,
        )
      }

      const account = await ctx.accountManager.getAccount(body.account, {
        includeDeactivated: true,
        includeTakenDown: true,
      })
      if (!account) {
        throw new InvalidRequestError(`Account does not exist: ${body.account}`)
      }

      await ctx.accountManager.updateAccountType(account.did, accountType)
    },
  })
}
