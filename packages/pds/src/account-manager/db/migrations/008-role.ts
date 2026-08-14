import { type Kysely, sql } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  // SQLite refuses to add a NOT NULL column with no default via a plain
  // ALTER TABLE ADD COLUMN once the table has existing rows (confirmed: it
  // errors immediately, and our tables always have rows by the time this
  // runs). A column-level default would silently apply to every future
  // insert that omits role, forever — which defeats the point of requiring
  // it. So we rebuild the table instead: create the real target shape (role
  // genuinely NOT NULL, no default), copy existing rows across with a
  // one-time 'striker' backfill (grandfathering accounts that predate this
  // concept), then swap it in. Any future insert that omits role now fails
  // loudly with a constraint violation instead of silently picking a value.
  await db.schema
    .createTable('actor_new')
    .addColumn('did', 'varchar', (col) => col.primaryKey())
    .addColumn('handle', 'varchar')
    .addColumn('createdAt', 'varchar', (col) => col.notNull())
    .addColumn('takedownRef', 'varchar')
    .addColumn('deactivatedAt', 'varchar')
    .addColumn('deleteAfter', 'varchar')
    .addColumn('role', 'varchar', (col) => col.notNull())
    .execute()

  await sql`
    insert into actor_new (did, handle, "createdAt", "takedownRef", "deactivatedAt", "deleteAfter", role)
    select did, handle, "createdAt", "takedownRef", "deactivatedAt", "deleteAfter", 'striker'
    from actor
  `.execute(db)

  await db.schema.dropTable('actor').execute()
  await db.schema.alterTable('actor_new').renameTo('actor').execute()

  await db.schema
    .createIndex('actor_handle_lower_idx')
    .unique()
    .on('actor')
    .expression(sql`lower("handle")`)
    .execute()
  await db.schema
    .createIndex('actor_cursor_idx')
    .on('actor')
    .columns(['createdAt', 'did'])
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('actor').dropColumn('role').execute()
}
