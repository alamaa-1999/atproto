import {
  ForbiddenError,
  InvalidRequestError,
  type Server,
} from '@atproto/xrpc-server'
import { ACCESS_FULL } from '../../../../auth-scope.js'
import type { AppContext } from '../../../../context.js'
import { com } from '../../../../lexicons/index.js'

// THIS IS A TEMPORARY UNSPECCED ROUTE, specific to this fork's admin list
// (account-management-plan.md in the workspace).
export default function (server: Server, ctx: AppContext) {
  server.add(com.atproto.temp.listPromotionRecords, {
    auth: ctx.authVerifier.adminTokenOrPasswordSession({
      scopes: ACCESS_FULL,
      checkTakedown: true,
      checkDeactivated: true,
    }),
    handler: async ({ auth, params }) => {
      if (
        auth.credentials.type === 'access' &&
        !ctx.accountManager.isSunnahskyAdmin(auth.credentials.did)
      ) {
        throw new ForbiddenError('This account is not an admin', 'NotAdmin')
      }
      const limit = params.limit ?? 50
      let before: number | undefined
      if (params.cursor !== undefined) {
        before = Number(params.cursor)
        if (!Number.isSafeInteger(before) || before < 1) {
          throw new InvalidRequestError('Malformed cursor')
        }
      }
      const rows = await ctx.accountManager.listPromotionRecords({
        limit,
        before,
      })
      return {
        encoding: 'application/json' as const,
        body: {
          cursor:
            rows.length === limit
              ? String(rows[rows.length - 1].id)
              : undefined,
          records: rows.map((row) => ({
            id: row.id,
            createdAt: row.createdAt,
            actor: row.actor,
            subject: row.subject,
            subjectDid: row.subjectDid ?? undefined,
            handleBefore: row.handleBefore ?? undefined,
            handleAfter: row.handleAfter ?? undefined,
            outcome: row.outcome,
            reason: row.reason ?? undefined,
          })),
        },
      }
    },
  })
}
