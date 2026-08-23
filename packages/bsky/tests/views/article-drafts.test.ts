import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import {
  type AtpAgent,
  ComSunnahskyArticleDraftCreateDraft,
  type ComSunnahskyArticleDraftDefs,
  ComSunnahskyArticleDraftUpdateDraft,
  ids,
} from '@atproto/api'
import { TID } from '@atproto/common'
import { TestNetwork } from '@atproto/dev-env'
import { paginateAll } from '../_util.js'

type Database = TestNetwork['bsky']['db']

const LIMIT = 5

describe('appview article drafts views', () => {
  let network: TestNetwork
  let agent: AtpAgent

  // account dids, for convenience
  let striker: string
  let striker2: string
  let catcher: string

  beforeAll(async () => {
    network = await TestNetwork.create({
      dbPostgresSchema: 'bsky_views_article_drafts',
      bsky: {
        articleDraftsLimit: LIMIT,
      },
    })

    // Account creation goes through the PDS directly - the article-draft
    // endpoints themselves are bsky-hosted, so all actual draft calls below
    // go through a single shared bsky agent (matching drafts.test.ts's
    // pattern), scoped per-actor via `network.serviceHeaders`.
    agent = network.bsky.getAgent()

    const strikerAgent = network.pds.getAgent()
    const striker2Agent = network.pds.getAgent()
    const catcherAgent = network.pds.getAgent()

    await strikerAgent.createAccount(
      {
        email: 'striker-ad@test.com',
        handle: 'striker-ad.test',
        password: 'striker-pass',
        role: 'striker',
      },
      { headers: network.pds.adminAuthHeaders(), encoding: 'application/json' },
    )
    await striker2Agent.createAccount(
      {
        email: 'striker2-ad@test.com',
        handle: 'striker2-ad.test',
        password: 'striker2-pass',
        role: 'striker',
      },
      { headers: network.pds.adminAuthHeaders(), encoding: 'application/json' },
    )
    await catcherAgent.createAccount({
      email: 'catcher-ad@test.com',
      handle: 'catcher-ad.guest.test',
      password: 'catcher-pass',
    })

    striker = strikerAgent.assertDid
    striker2 = striker2Agent.assertDid
    catcher = catcherAgent.assertDid
  })

  beforeEach(async () => network.processAll())
  afterEach(async () => {
    vi.restoreAllMocks()
    // Drain in-flight bsync operations before resetting state directly,
    // otherwise a late-applied op can resurrect state after the reset.
    await network.processAll()
    await clearDrafts(network.bsky.db)
  })
  afterAll(async () => network?.close())

  const makeDraft = (
    title = `Untitled ${Math.random().toString(36).slice(2)}`,
  ): ComSunnahskyArticleDraftDefs.Draft => ({
    title,
    markdown: 'Hello, world!',
  })

  const get = async (actor: string, limit?: number, cursor?: string) =>
    agent.com.sunnahsky.article.draft.getDrafts(
      { limit, cursor },
      {
        headers: await network.serviceHeaders(
          actor,
          ids.ComSunnahskyArticleDraftGetDrafts,
        ),
      },
    )

  const create = async (
    actor: string,
    draft: ComSunnahskyArticleDraftDefs.Draft,
  ) =>
    agent.com.sunnahsky.article.draft.createDraft(
      { draft },
      {
        headers: await network.serviceHeaders(
          actor,
          ids.ComSunnahskyArticleDraftCreateDraft,
        ),
      },
    )

  const update = async (
    actor: string,
    draftWithId: ComSunnahskyArticleDraftDefs.DraftWithId,
  ) =>
    agent.com.sunnahsky.article.draft.updateDraft(
      { draft: draftWithId },
      {
        headers: await network.serviceHeaders(
          actor,
          ids.ComSunnahskyArticleDraftUpdateDraft,
        ),
      },
    )

  const del = async (actor: string, id: string) =>
    agent.com.sunnahsky.article.draft.deleteDraft(
      { id },
      {
        headers: await network.serviceHeaders(
          actor,
          ids.ComSunnahskyArticleDraftDeleteDraft,
        ),
      },
    )

  describe('creation', () => {
    it('creates drafts for a Striker', async () => {
      const res1 = await create(striker, makeDraft())
      const res2 = await create(striker, makeDraft())

      expect(res1.data.id).toBeDefined()
      expect(res2.data.id).toBeDefined()
      expect(res1.data.id).not.toBe(res2.data.id)

      await network.processAll()
      const { data } = await get(striker)
      expect(data.drafts).toHaveLength(2)
    })

    it('rejects creation for a non-Striker (catcher)', async () => {
      await expect(create(catcher, makeDraft())).rejects.toThrow(
        ComSunnahskyArticleDraftCreateDraft.NotAStrikerError,
      )
      await network.processAll()
      const { data } = await get(catcher)
      expect(data.drafts).toHaveLength(0)
    })

    it('limits drafts per Striker', async () => {
      for (let i = 0; i < LIMIT; i++) {
        await create(striker2, makeDraft())
        await network.processAll()
      }
      await expect(create(striker2, makeDraft())).rejects.toThrow(
        ComSunnahskyArticleDraftCreateDraft.ArticleDraftLimitReachedError,
      )
    })
  })

  describe('update as create-via-update', () => {
    it('rejects a fresh id from a non-Striker, and lands no row', async () => {
      const freshId = TID.nextStr()
      await expect(
        update(catcher, { id: freshId, draft: makeDraft() }),
      ).rejects.toThrow(ComSunnahskyArticleDraftUpdateDraft.NotAStrikerError)
      await network.processAll()
      const { data } = await get(catcher)
      expect(data.drafts).toHaveLength(0)
    })

    it('rejects a fresh id from a Striker already at the limit', async () => {
      for (let i = 0; i < LIMIT; i++) {
        await create(striker2, makeDraft())
        await network.processAll()
      }
      const freshId = TID.nextStr()
      await expect(
        update(striker2, { id: freshId, draft: makeDraft() }),
      ).rejects.toThrow(
        ComSunnahskyArticleDraftUpdateDraft.ArticleDraftLimitReachedError,
      )
    })

    it('allows a fresh id from a Striker under the limit (real create-via-update)', async () => {
      const freshId = TID.nextStr()
      await update(striker, { id: freshId, draft: makeDraft('Via update') })
      await network.processAll()
      const { data } = await get(striker)
      const created = data.drafts.find((d) => d.id === freshId)
      expect(created?.draft.title).toBe('Via update')
    })

    it('does not re-check Striker/limit for an existing row', async () => {
      const { data: created } = await create(striker, makeDraft('v1'))
      await network.processAll()
      await update(striker, {
        id: created.id,
        draft: makeDraft('v2'),
      })
      await network.processAll()
      const { data } = await get(striker)
      const found = data.drafts.find((d) => d.id === created.id)
      expect(found?.draft.title).toBe('v2')
    })
  })

  describe('fail-closed Striker check', () => {
    it('rejects creation when the checkStriker callout fails, even for a real Striker', async () => {
      // The createDraft/updateDraft handlers' only outbound `fetch` call is
      // the checkStriker callout to the caller's own PDS - safe to mock
      // globally rather than distinguishing URLs.
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(
        new Error('simulated PDS outage'),
      )

      await expect(create(striker, makeDraft())).rejects.toThrow(
        ComSunnahskyArticleDraftCreateDraft.NotAStrikerError,
      )
    })
  })

  describe('deletion', () => {
    it('removes drafts and is idempotent', async () => {
      const { data: created } = await create(striker, makeDraft())
      await network.processAll()

      await del(striker, created.id)
      await network.processAll()
      let { data } = await get(striker)
      expect(data.drafts.find((d) => d.id === created.id)).toBeUndefined()

      // idempotent - deleting again should not throw
      await del(striker, created.id)
      await network.processAll()
      ;({ data } = await get(striker))
      expect(data.drafts.find((d) => d.id === created.id)).toBeUndefined()
    })
  })

  describe('listing', () => {
    it('drafts are private to each Striker', async () => {
      await create(striker, makeDraft())
      await create(striker2, makeDraft())
      await create(striker2, makeDraft())
      await network.processAll()

      const { data: dataStriker } = await get(striker)
      const { data: dataStriker2 } = await get(striker2)
      expect(
        dataStriker.drafts.every(
          (d) => !dataStriker2.drafts.some((x) => x.id === d.id),
        ),
      ).toBe(true)
    })

    it('paginates drafts', async () => {
      for (let i = 0; i < LIMIT; i++) {
        await create(striker2, makeDraft())
      }
      await network.processAll()

      const paginator = async (cursor?: string) => {
        const res = await get(striker2, 2, cursor)
        return res.data
      }
      const paginatedRes = await paginateAll(paginator)
      const total = paginatedRes.flatMap((r) => r.drafts).length
      expect(total).toBe(LIMIT)
    })
  })
})

const clearDrafts = async (db: Database) => {
  await db.db.deleteFrom('private_data').execute()
}
