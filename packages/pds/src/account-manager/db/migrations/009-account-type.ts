import type { Kysely } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('actor')
    .addColumn('accountType', 'varchar', (col) =>
      col.notNull().defaultTo('person'),
    )
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('actor').dropColumn('accountType').execute()
}
