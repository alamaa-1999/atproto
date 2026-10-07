import type { AtpAgent } from '@atproto/api'
import { TestNetworkNoAppView } from '@atproto/dev-env'
import type { AtIdentifierString, DidString } from '@atproto/syntax'
import type { AppContext } from '../src/index.js'

// Sunnahsky: promotion by accounts on the PDS's admin list
// (account-management-plan.md in the workspace).
describe('promotion by admin accounts', () => {
  let network: TestNetworkNoAppView
  let ctx: AppContext

  type Member = { agent: AtpAgent; did: DidString; password: string }
  let keeper: Member // on the admin list, used for most tests
  let outsider: Member // a member, not on the list
  let sleeper: Member // on the list, then deactivated
  let banned: Member // on the list, then taken down

  const json = { encoding: 'application/json' } as const

  const makeCatcher = async (name: string): Promise<Member> => {
    const agent = network.pds.getAgent()
    const password = `${name}-pass`
    await agent.createAccount({
      email: `${name}@test.com`,
      handle: `${name}.guest.test`,
      password,
    })
    return { agent, did: agent.assertDid as DidString, password }
  }

  const promote = (agent: AtpAgent, account: string, password?: string) =>
    agent.com.atproto.admin.promoteAccountToStriker({ account, password }, json)

  const promoteWithAdminPassword = (account: string) =>
    network.pds
      .getAgent()
      .com.atproto.admin.promoteAccountToStriker(
        { account },
        { ...json, headers: network.pds.adminAuthHeaders() },
      )

  const latestRecord = async () => {
    const [row] = await ctx.accountManager.listPromotionRecords({ limit: 1 })
    return row
  }

  const roleOf = async (didOrHandle: AtIdentifierString) =>
    (
      await ctx.accountManager.getAccount(didOrHandle, {
        includeDeactivated: true,
      })
    )?.role

  beforeAll(async () => {
    network = await TestNetworkNoAppView.create({})
    ctx = network.pds.ctx
    keeper = await makeCatcher('keeper')
    outsider = await makeCatcher('outsider')
    sleeper = await makeCatcher('sleeper')
    banned = await makeCatcher('banned')
    // Read on every request, so setting it after start-up takes effect.
    ctx.cfg.service.sunnahskyAdminDids = [keeper.did, sleeper.did, banned.did]
  })

  afterAll(async () => {
    await network.close()
  })

  it('lets a listed admin with a full sign-in and their password promote', async () => {
    const amira = await makeCatcher('amira')
    const res = await promote(keeper.agent, 'amira.guest.test', keeper.password)
    expect(res.data).toMatchObject({
      did: amira.did,
      handle: 'amira.test',
      outcome: 'promoted',
      handleConfirmed: true,
    })
    expect(await roleOf(amira.did)).toBe('striker')
    expect(await latestRecord()).toMatchObject({
      actor: keeper.did,
      subject: 'amira.guest.test',
      subjectDid: amira.did,
      handleBefore: 'amira.guest.test',
      handleAfter: 'amira.test',
      outcome: 'promoted',
      reason: null,
    })
  })

  it('rechecks an account that is already a Striker, and records it', async () => {
    const res = await promote(keeper.agent, 'amira.test', keeper.password)
    expect(res.data).toMatchObject({
      handle: 'amira.test',
      outcome: 'rechecked',
      handleConfirmed: true,
    })
    expect(await latestRecord()).toMatchObject({
      actor: keeper.did,
      outcome: 'rechecked',
    })
  })

  it('refuses a listed admin who sends no password, and records it', async () => {
    await makeCatcher('bilal')
    await expect(
      promote(keeper.agent, 'bilal.guest.test'),
    ).rejects.toMatchObject({
      error: 'PasswordRequired',
    })
    expect(await roleOf('bilal.guest.test')).toBe('catcher')
    expect(await latestRecord()).toMatchObject({
      actor: keeper.did,
      outcome: 'refused',
      reason: 'password-required',
    })
  })

  it('refuses a listed admin who sends the wrong password, and records it', async () => {
    await expect(
      promote(keeper.agent, 'bilal.guest.test', 'not-the-password'),
    ).rejects.toMatchObject({ error: 'IncorrectPassword' })
    expect(await latestRecord()).toMatchObject({
      outcome: 'refused',
      reason: 'incorrect-password',
    })
  })

  it('refuses an account that is not on the list, and records it', async () => {
    await expect(
      promote(outsider.agent, 'bilal.guest.test', outsider.password),
    ).rejects.toMatchObject({ error: 'NotAdmin' })
    expect(await latestRecord()).toMatchObject({
      actor: outsider.did,
      subject: 'bilal.guest.test',
      subjectDid: null,
      outcome: 'refused',
      reason: 'not-admin',
    })
  })

  it('refuses an admin promoting their own account', async () => {
    await expect(
      promote(keeper.agent, 'keeper.guest.test', keeper.password),
    ).rejects.toMatchObject({ error: 'SelfPromotion' })
    expect(await roleOf(keeper.did)).toBe('catcher')
    expect(await latestRecord()).toMatchObject({
      outcome: 'refused',
      reason: 'self',
    })
  })

  it("refuses a listed admin's app-password sign-in", async () => {
    const { data } = await keeper.agent.com.atproto.server.createAppPassword({
      name: 'phone',
    })
    const appAgent = network.pds.getAgent()
    await appAgent.login({
      identifier: 'keeper.guest.test',
      password: data.password,
    })
    const before = await latestRecord()
    await expect(
      promote(appAgent, 'bilal.guest.test', keeper.password),
    ).rejects.toMatchObject({
      error: 'InvalidToken',
      message: 'Bad token scope',
    })
    expect(await roleOf('bilal.guest.test')).toBe('catcher')
    // Refused before the caller is identified, so nothing is recorded.
    expect((await latestRecord()).id).toBe(before.id)
  })

  it('refuses an OAuth sign-in outright, before any token check', async () => {
    await expect(
      network.pds
        .getAgent()
        .com.atproto.admin.promoteAccountToStriker(
          { account: 'bilal.guest.test', password: keeper.password },
          { ...json, headers: { authorization: 'DPoP not-checked' } },
        ),
    ).rejects.toThrow('Unexpected authorization type')
  })

  it('refuses a deactivated admin', async () => {
    await sleeper.agent.com.atproto.server.deactivateAccount({})
    await expect(
      promote(sleeper.agent, 'bilal.guest.test', sleeper.password),
    ).rejects.toMatchObject({ error: 'AccountDeactivated' })
    expect(await roleOf('bilal.guest.test')).toBe('catcher')
  })

  it('refuses a taken-down admin', async () => {
    await network.pds.getAgent().com.atproto.admin.updateSubjectStatus(
      {
        subject: { $type: 'com.atproto.admin.defs#repoRef', did: banned.did },
        takedown: { applied: true, ref: 'test-takedown' },
      },
      { ...json, headers: network.pds.adminAuthHeaders() },
    )
    await expect(
      promote(banned.agent, 'bilal.guest.test', banned.password),
    ).rejects.toMatchObject({ error: 'AccountTakedown' })
    expect(await roleOf('bilal.guest.test')).toBe('catcher')
  })

  it("won't promote a Catcher into a reserved name", async () => {
    const delta = await makeCatcher('delta')
    // An admin can give a Catcher a reserved word, as with any handle.
    await network.pds
      .getAgent()
      .com.atproto.admin.updateAccountHandle(
        { did: delta.did, handle: 'ozone.guest.test' },
        { ...json, headers: network.pds.adminAuthHeaders() },
      )
    await expect(
      promote(keeper.agent, 'ozone.guest.test', keeper.password),
    ).rejects.toThrow('Reserved handle')
    expect(await roleOf(delta.did)).toBe('catcher')
    expect(await latestRecord()).toMatchObject({
      subjectDid: delta.did,
      outcome: 'refused',
      reason: 'Reserved handle',
    })
  })

  it('with the list empty, only the admin password can promote', async () => {
    const saved = ctx.cfg.service.sunnahskyAdminDids
    ctx.cfg.service.sunnahskyAdminDids = []
    try {
      await expect(
        promote(keeper.agent, 'bilal.guest.test', keeper.password),
      ).rejects.toMatchObject({ error: 'NotAdmin' })
      const res = await promoteWithAdminPassword('bilal.guest.test')
      expect(res.data.outcome).toBe('promoted')
      expect(await latestRecord()).toMatchObject({
        actor: 'admin-password',
        outcome: 'promoted',
      })
    } finally {
      ctx.cfg.service.sunnahskyAdminDids = saved
    }
  })

  describe('checkAdmin', () => {
    const check = (agent: AtpAgent) =>
      agent.com.atproto.temp.checkAdmin().then((res) => res.data.isAdmin)

    it('is true for a listed admin with a full sign-in', async () => {
      expect(await check(keeper.agent)).toBe(true)
    })

    it('is false for an account not on the list', async () => {
      expect(await check(outsider.agent)).toBe(false)
    })

    it("is false for a listed admin's app-password sign-in", async () => {
      const { data } = await keeper.agent.com.atproto.server.createAppPassword({
        name: 'tablet',
      })
      const appAgent = network.pds.getAgent()
      await appAgent.login({
        identifier: 'keeper.guest.test',
        password: data.password,
      })
      expect(await check(appAgent)).toBe(false)
    })

    it('refuses an OAuth sign-in, and a request without one', async () => {
      await expect(
        network.pds
          .getAgent()
          .com.atproto.temp.checkAdmin(
            {},
            { headers: { authorization: 'DPoP not-checked' } },
          ),
      ).rejects.toThrow('Unexpected authorization type')
      await expect(
        network.pds.getAgent().com.atproto.temp.checkAdmin(),
      ).rejects.toThrow()
    })
  })

  describe('listPromotionRecords', () => {
    it('lists the record newest first, refusals included', async () => {
      const { data } = await keeper.agent.com.atproto.temp.listPromotionRecords(
        { limit: 100 },
      )
      const ids = data.records.map((r) => r.id)
      expect(ids).toEqual([...ids].sort((a, b) => b - a))
      const outcomes = new Set(data.records.map((r) => r.outcome))
      expect(outcomes).toEqual(new Set(['promoted', 'rechecked', 'refused']))
    })

    it('pages with a cursor', async () => {
      const first = await keeper.agent.com.atproto.temp.listPromotionRecords({
        limit: 2,
      })
      expect(first.data.records).toHaveLength(2)
      const next = await keeper.agent.com.atproto.temp.listPromotionRecords({
        limit: 2,
        cursor: first.data.cursor,
      })
      expect(next.data.records[0].id).toBeLessThan(first.data.records[1].id)
    })

    it('refuses an account not on the list', async () => {
      await expect(
        outsider.agent.com.atproto.temp.listPromotionRecords({}),
      ).rejects.toMatchObject({ error: 'NotAdmin' })
    })

    it('accepts the admin password', async () => {
      const { data } = await network.pds
        .getAgent()
        .com.atproto.temp.listPromotionRecords(
          {},
          { headers: network.pds.adminAuthHeaders() },
        )
      expect(data.records.length).toBeGreaterThan(0)
    })
  })
})
