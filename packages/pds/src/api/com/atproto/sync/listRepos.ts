import type { Server } from '@atproto/xrpc-server'
import { formatAccountStatus } from '../../../../account-manager/account-manager.js'
import type { AppContext } from '../../../../context.js'
import { TimeDidKeyset, paginate } from '../../../../db/pagination.js'
import { com } from '../../../../lexicons/index.js'

export default function (server: Server, ctx: AppContext) {
  server.add(com.atproto.sync.listRepos, async ({ params }) => {
    const { limit, cursor } = params
    const db = ctx.accountManager.db
    const { ref } = db.db.dynamic
    let builder = db.db
      .selectFrom('actor')
      .innerJoin('repo_root', 'repo_root.did', 'actor.did')
      .select([
        'actor.did as did',
        'repo_root.cid as head',
        'repo_root.rev as rev',
        'actor.createdAt as createdAt',
        'actor.deactivatedAt as deactivatedAt',
        'actor.takedownRef as takedownRef',
      ])
    const keyset = new TimeDidKeyset(ref('actor.createdAt'), ref('actor.did'))
    builder = paginate(builder, {
      limit,
      cursor,
      keyset,
      direction: 'asc',
      tryIndex: true,
    })
    const res = await builder.execute()
    const repos = res.map((row): com.atproto.sync.listRepos.Repo => {
      const { active, status } = formatAccountStatus(row)
      return {
        did: row.did,
        head: row.head,
        rev: row.rev ?? '',
        active,
        status,
      }
    })
    return {
      encoding: 'application/json' as const,
      body: {
        cursor: keyset.packFromResult(res),
        repos,
      },
    }
  })
}
