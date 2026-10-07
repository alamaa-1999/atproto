import type { Server } from '@atproto/xrpc-server'
import { ACCESS_STANDARD, isAccessFull } from '../../../../auth-scope.js'
import type { AppContext } from '../../../../context.js'
import { com } from '../../../../lexicons/index.js'

// THIS IS A TEMPORARY UNSPECCED ROUTE, specific to this fork's admin list
// (account-management-plan.md in the workspace). It answers only about the
// caller, so it can't be used to find out who the admins are.
export default function (server: Server, ctx: AppContext) {
  server.add(com.atproto.temp.checkAdmin, {
    auth: ctx.authVerifier.passwordSession({
      scopes: ACCESS_STANDARD,
      checkTakedown: true,
      checkDeactivated: true,
    }),
    handler: async ({ auth }) => {
      const { did, scope } = auth.credentials
      return {
        encoding: 'application/json' as const,
        body: {
          // An app-password session can't promote, so it isn't an admin here.
          isAdmin:
            isAccessFull(scope) && ctx.accountManager.isSunnahskyAdmin(did),
        },
      }
    },
  })
}
