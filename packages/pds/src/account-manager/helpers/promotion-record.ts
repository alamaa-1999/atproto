import { type DidString, currentDatetimeString } from '@atproto/syntax'
import type { AccountDb } from '../db/index.js'
import type { PromotionOutcome } from '../db/schema/promotion-record.js'

/** The `actor` recorded when the admin password made the request. */
export const ADMIN_PASSWORD_ACTOR = 'admin-password'

export type PromotionRecordEntry = {
  actor: string
  subject: string
  subjectDid?: DidString
  handleBefore?: string | null
  handleAfter?: string | null
  outcome: PromotionOutcome
  reason?: string
}

export const insertPromotionRecord = async (
  db: AccountDb,
  entry: PromotionRecordEntry,
): Promise<void> => {
  await db.executeWithRetry(
    db.db.insertInto('promotion_record').values({
      createdAt: currentDatetimeString(),
      actor: entry.actor,
      subject: entry.subject,
      subjectDid: entry.subjectDid ?? null,
      handleBefore: entry.handleBefore ?? null,
      handleAfter: entry.handleAfter ?? null,
      outcome: entry.outcome,
      reason: entry.reason ?? null,
    }),
  )
}

/** Newest first; `before` is the `id` to continue below. */
export const listPromotionRecords = async (
  db: AccountDb,
  opts: { limit: number; before?: number },
) => {
  let builder = db.db
    .selectFrom('promotion_record')
    .selectAll()
    .orderBy('id', 'desc')
    .limit(opts.limit)
  if (opts.before !== undefined) {
    builder = builder.where('id', '<', opts.before)
  }
  return builder.execute()
}
