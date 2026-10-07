import { HOUR } from '@atproto/common'
import type { DidString } from '@atproto/syntax'
import {
  ForbiddenError,
  InvalidRequestError,
  type Server,
} from '@atproto/xrpc-server'
import { ADMIN_PASSWORD_ACTOR } from '../../../../account-manager/helpers/promotion-record.js'
import { ACCESS_FULL } from '../../../../auth-scope.js'
import type { AppContext } from '../../../../context.js'
import { com } from '../../../../lexicons/index.js'

export default function (server: Server, ctx: AppContext) {
  server.add(com.atproto.admin.promoteAccountToStriker, {
    // Sunnahsky (account-management-plan.md in the workspace): the admin
    // password, or a full password session of an account that is neither
    // deactivated nor taken down. The handler checks that account against the
    // admin list and its password. App passwords and OAuth are refused here.
    auth: ctx.authVerifier.adminTokenOrPasswordSession({
      scopes: ACCESS_FULL,
      checkTakedown: true,
      checkDeactivated: true,
    }),
    // The handler checks the admin account's password, so it is limited per
    // caller, as sign-in is; otherwise a stolen session could guess the
    // password here.
    rateLimit: [
      {
        durationMs: HOUR,
        points: 30,
        calcKey: ({ auth, req }) =>
          auth.credentials.type === 'access'
            ? auth.credentials.did
            : (req.ip ?? null),
      },
    ],
    handler: async ({ auth, input: { body } }) => {
      const subject = body.account
      const actor =
        auth.credentials.type === 'access' ? auth.credentials.did : null
      const refuse = (reason: string, subjectDid?: DidString) =>
        ctx.accountManager.recordRefusedPromotion({
          actor: actor ?? ADMIN_PASSWORD_ACTOR,
          subject,
          subjectDid,
          reason,
        })

      if (actor) {
        // Checked before the named account is looked up, so a caller who
        // isn't an admin learns nothing about it.
        if (!ctx.accountManager.isSunnahskyAdmin(actor)) {
          await refuse('not-admin')
          throw new ForbiddenError('This account is not an admin', 'NotAdmin')
        }
        if (!body.password) {
          await refuse('password-required')
          throw new ForbiddenError(
            "Enter this account's password to promote",
            'PasswordRequired',
          )
        }
        const correct = await ctx.accountManager.verifyAccountPassword(
          actor,
          body.password,
        )
        if (!correct) {
          await refuse('incorrect-password')
          throw new ForbiddenError('Incorrect password', 'IncorrectPassword')
        }
      }

      const account = await ctx.accountManager.getAccount(subject, {
        includeDeactivated: true,
        includeTakenDown: true,
      })
      if (!account) {
        await refuse('not-found')
        throw new InvalidRequestError(`Account does not exist: ${subject}`)
      }
      if (actor && account.did === actor) {
        await refuse('self', account.did)
        throw new InvalidRequestError(
          'An admin account cannot promote itself',
          'SelfPromotion',
        )
      }

      try {
        const promoted = await ctx.accountManager.promoteToStriker(
          account.did,
          { actor: actor ?? ADMIN_PASSWORD_ACTOR, subject },
        )
        return {
          encoding: 'application/json' as const,
          body: {
            did: promoted.did,
            handle: promoted.handle,
            outcome: promoted.outcome,
            handleConfirmed: promoted.handleConfirmed,
          },
        }
      } catch (err) {
        if (err instanceof InvalidRequestError) {
          await refuse(err.message, account.did)
        }
        throw err
      }
    },
  })
}
