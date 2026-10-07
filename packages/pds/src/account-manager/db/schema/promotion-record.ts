import type { Generated } from 'kysely'
import type { DatetimeString, DidString } from '@atproto/syntax'

/**
 * Sunnahsky: one row per promotion attempt by an identified caller
 * (account-management-plan.md in the workspace). `actor` is the admin
 * account's DID, or `ADMIN_PASSWORD_ACTOR` for the admin password.
 */
export type PromotionOutcome = 'promoted' | 'rechecked' | 'refused'

export interface PromotionRecord {
  id: Generated<number>
  createdAt: DatetimeString
  actor: string
  subject: string
  subjectDid: DidString | null
  handleBefore: string | null
  handleAfter: string | null
  outcome: PromotionOutcome
  reason: string | null
}

export const tableName = 'promotion_record'

export type PartialDB = { [tableName]: PromotionRecord }
