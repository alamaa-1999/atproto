import type { Kysely } from 'kysely'

// Sunnahsky: the record of promotion attempts (account-management-plan.md in
// the workspace). Listed newest first by `id`, the primary key.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('promotion_record')
    .addColumn('id', 'integer', (col) => col.autoIncrement().primaryKey())
    .addColumn('createdAt', 'varchar', (col) => col.notNull())
    .addColumn('actor', 'varchar', (col) => col.notNull())
    .addColumn('subject', 'varchar', (col) => col.notNull())
    .addColumn('subjectDid', 'varchar')
    .addColumn('handleBefore', 'varchar')
    .addColumn('handleAfter', 'varchar')
    .addColumn('outcome', 'varchar', (col) => col.notNull())
    .addColumn('reason', 'varchar')
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('promotion_record').execute()
}
