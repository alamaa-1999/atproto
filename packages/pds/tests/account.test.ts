import assert from 'node:assert'
import { jest } from '@jest/globals'
import { type AtpAgent, ComAtprotoServerResetPassword } from '@atproto/api'
import * as crypto from '@atproto/crypto'
import { TestNetworkNoAppView } from '@atproto/dev-env'
import type { IdResolver } from '@atproto/identity'
import { isDidString } from '@atproto/lex'
import type { DidString } from '@atproto/syntax'
import type { AppContext } from '../src/index.js'

const email = 'alice@test.com'
// None of these tests request role: 'striker', so every account created
// here defaults to 'catcher' and must use the .guest. handle domain.
const handle = 'alice.guest.test'
const password = 'test123'
const passwordAlt = 'test456'
const minsToMs = 60 * 1000

describe('account', () => {
  let network: TestNetworkNoAppView
  let ctx: AppContext
  let agent: AtpAgent
  let idResolver: IdResolver

  const tryHandle = async (handle: string) => {
    await agent.api.com.atproto.server.createAccount({
      email: 'john@test.com',
      handle,
      password: 'test123',
    })
  }

  let sendMailMock: jest.SpiedFunction<
    AppContext['mailer']['transporter']['sendMail']
  >

  beforeAll(async () => {
    network = await TestNetworkNoAppView.create({
      dbPostgresSchema: 'account',
      pds: {
        contactEmailAddress: 'abuse@example.com',
        termsOfServiceUrl: 'https://example.com/tos',
        privacyPolicyUrl: 'https://example.com/privacy-policy',
        blobUploadLimit: 123_456,
      },
    })
    ctx = network.pds.ctx
    idResolver = network.pds.ctx.idResolver
    agent = network.pds.getAgent()

    sendMailMock = jest
      .spyOn(ctx.mailer.transporter, 'sendMail')
      .mockImplementation(async () => {})
  })

  beforeEach(async () => {
    // Catch-all: never actually send, but keep recording calls for assertions.
    sendMailMock.mockClear()
  })

  afterAll(async () => {
    await network?.close()
  })

  it('serves the accounts system config', async () => {
    const res = await agent.api.com.atproto.server.describeServer({})
    expect(res.data.inviteCodeRequired).toBe(false)
    // The guest (Catcher) domain is listed first — deliberate, since
    // ensureHandleServiceConstraints/isServiceDomain match via .find(),
    // which returns the first suffix match. See the Week 1 engineering
    // notes for the .find()-returns-first-match bug this ordering fixes.
    expect(res.data.availableUserDomains[0]).toBe('.guest.test')
    expect(typeof res.data.inviteCodeRequired).toBe('boolean')
    expect(res.data.blobUploadLimit).toBe(123_456)
    expect(res.data.links?.privacyPolicy).toBe(
      'https://example.com/privacy-policy',
    )
    expect(res.data.links?.termsOfService).toBe('https://example.com/tos')
    expect(res.data.contact?.email).toBe('abuse@example.com')
  })

  it('fails on invalid handles', async () => {
    const promise = agent.api.com.atproto.server.createAccount({
      email: 'bad-handle@test.com',
      handle: 'did:bad-handle.test',
      password: 'asdf',
    })
    await expect(promise).rejects.toMatchObject({
      error: 'InvalidRequest',
      message: expect.stringContaining('handle'),
      // - Input/handle must be a valid handle
    })
  })

  describe('email validation', () => {
    it('succeeds on allowed emails', async () => {
      const promise = agent.api.com.atproto.server.createAccount({
        email: 'ok-email@gmail.com',
        handle: 'ok-email.guest.test',
        password: 'asdf',
      })
      await expect(promise).resolves.toBeTruthy()
    })

    it('fails on disallowed emails', async () => {
      const promise = agent.api.com.atproto.server.createAccount({
        email: 'bad-email@disposeamail.com',
        handle: 'bad-email.test',
        password: 'asdf',
      })
      await expect(promise).rejects.toMatchObject({
        error: 'InvalidRequest',
        message: expect.stringContaining('email'),
        // - This email address is not supported, please use a different email.
      })
    })
  })

  let did: DidString
  let jwt: string

  it('creates an account', async () => {
    const res = await agent.api.com.atproto.server.createAccount({
      email,
      handle,
      password,
    })

    expect(typeof res.data.accessJwt).toBe('string')
    assert(isDidString(res.data.did), 'Did is not a valid DidString')
    expect(res.data.handle).toEqual(handle)

    did = res.data.did
    jwt = res.data.accessJwt
  })

  it('generates a properly formatted PLC DID', async () => {
    const didData = await idResolver.did.resolveAtprotoData(did)
    const signingKey = await network.pds.ctx.actorStore.keypair(did)

    expect(didData.did).toBe(did)
    expect(didData.handle).toBe(handle)
    expect(didData.signingKey).toBe(signingKey.did())
    expect(didData.pds).toBe(network.pds.url)
  })

  it('allows a custom set recovery key', async () => {
    const recoveryKey = (await crypto.P256Keypair.create()).did()
    const res = await agent.api.com.atproto.server.createAccount({
      email: 'custom-recovery@test.com',
      handle: 'custom-recovery.guest.test',
      password: 'custom-recovery',
      recoveryKey,
    })

    const didData = await ctx.plcClient.getDocumentData(res.data.did)

    expect(didData.rotationKeys).toEqual([
      recoveryKey,
      ctx.cfg.identity.recoveryDidKey,
      ctx.plcRotationKey.did(),
    ])
  })

  // @NOTE currently disabled until we allow a user to resver a keypair before migration
  // it('allows a user to bring their own DID', async () => {
  //   const userKey = await crypto.Secp256k1Keypair.create()
  //   const handle = 'byo-did.test'
  //   const did = await ctx.plcClient.createDid({
  //     signingKey: ctx.repoSigningKey.did(),
  //     handle,
  //     rotationKeys: [
  //       userKey.did(),
  //       ctx.cfg.identity.recoveryDidKey ?? '',
  //       ctx.plcRotationKey.did(),
  //     ],
  //     pds: network.pds.url,
  //     signer: userKey,
  //   })

  //   const res = await agent.api.com.atproto.server.createAccount({
  //     email: 'byo-did@test.com',
  //     handle,
  //     did,
  //     password: 'byo-did-pass',
  //   })

  //   expect(res.data.handle).toEqual(handle)
  //   expect(res.data.did).toEqual(did)
  // })

  // it('requires that the did a user brought be correctly set up for the server', async () => {
  //   const userKey = await crypto.Secp256k1Keypair.create()
  //   const baseDidInfo = {
  //     signingKey: ctx.repoSigningKey.did(),
  //     handle: 'byo-did.test',
  //     rotationKeys: [
  //       userKey.did(),
  //       ctx.cfg.identity.recoveryDidKey ?? '',
  //       ctx.plcRotationKey.did(),
  //     ],
  //     pds: ctx.cfg.service.publicUrl,
  //     signer: userKey,
  //   }
  //   const baseAccntInfo = {
  //     email: 'byo-did@test.com',
  //     handle: 'byo-did.test',
  //     password: 'byo-did-pass',
  //   }

  //   const did1 = await ctx.plcClient.createDid({
  //     ...baseDidInfo,
  //     handle: 'different-handle.test',
  //   })
  //   const attempt1 = agent.api.com.atproto.server.createAccount({
  //     ...baseAccntInfo,
  //     did: did1,
  //   })
  //   await expect(attempt1).rejects.toThrow(
  //     'provided handle does not match DID document handle',
  //   )

  //   const did2 = await ctx.plcClient.createDid({
  //     ...baseDidInfo,
  //     pds: 'https://other-pds.com',
  //   })
  //   const attempt2 = agent.api.com.atproto.server.createAccount({
  //     ...baseAccntInfo,
  //     did: did2,
  //   })
  //   await expect(attempt2).rejects.toThrow(
  //     'DID document pds endpoint does not match service endpoint',
  //   )

  //   const did3 = await ctx.plcClient.createDid({
  //     ...baseDidInfo,
  //     rotationKeys: [userKey.did()],
  //   })
  //   const attempt3 = agent.api.com.atproto.server.createAccount({
  //     ...baseAccntInfo,
  //     did: did3,
  //   })
  //   await expect(attempt3).rejects.toThrow(
  //     'PLC DID does not include service rotation key',
  //   )

  //   const did4 = await ctx.plcClient.createDid({
  //     ...baseDidInfo,
  //     signingKey: userKey.did(),
  //   })
  //   const attempt4 = agent.api.com.atproto.server.createAccount({
  //     ...baseAccntInfo,
  //     did: did4,
  //   })
  //   await expect(attempt4).rejects.toThrow(
  //     'DID document signing key does not match service signing key',
  //   )
  // })

  it('allows administrative email updates', async () => {
    await agent.api.com.atproto.admin.updateAccountEmail(
      {
        account: handle,
        email: 'alIce-NEw@teST.com',
      },
      {
        encoding: 'application/json',
        headers: network.pds.adminAuthHeaders(),
      },
    )

    const accnt = await ctx.accountManager.getAccount(handle)
    expect(accnt?.email).toBe('alice-new@test.com')

    await agent.api.com.atproto.admin.updateAccountEmail(
      {
        account: did,
        email,
      },
      {
        encoding: 'application/json',
        headers: network.pds.adminAuthHeaders(),
      },
    )

    const accnt2 = await ctx.accountManager.getAccount(handle)
    expect(accnt2?.email).toBe(email)
  })

  it('disallows duplicate email addresses and handles', async () => {
    const email = 'bob@test.com'
    const handle = 'bob.guest.test'
    const password = 'test123'
    await agent.api.com.atproto.server.createAccount({
      email,
      handle,
      password,
    })

    await expect(
      agent.api.com.atproto.server.createAccount({
        email: email.toUpperCase(),
        handle: 'carol.guest.test',
        password,
      }),
    ).rejects.toThrow('Email already taken: BOB@TEST.COM')

    await expect(
      agent.api.com.atproto.server.createAccount({
        email: 'carol@test.com',
        handle: handle.toUpperCase(),
        password,
      }),
    ).rejects.toThrow('Handle already taken: bob.guest.test')
  })

  it('validates input through lexicon schema', async () => {
    for (const invalidHandle of [
      'did:john',
      'jo_hn.test',
      'jo!hn.test',
      'jo%hn.test',
      'jo&hn.test',
      'jo*hn.test',
      'jo|hn.test',
      'jo:hn.test',
      'jo/hn.test',
    ]) {
      await expect(tryHandle(invalidHandle)).rejects.toMatchObject({
        error: 'InvalidRequest',
        message: expect.stringContaining('handle'),
      })
    }
  })

  it('disallows improperly formatted handles', async () => {
    await expect(tryHandle('j.test')).rejects.toMatchObject({
      error: 'InvalidHandle',
      message: 'Handle too short',
    })
    await expect(
      tryHandle('jayromy-johnber12345678910.test'),
    ).rejects.toMatchObject({
      error: 'InvalidHandle',
      message: 'Handle too long',
    })
  })

  it('disallows reserved handles', async () => {
    await expect(tryHandle('john.bsky.io')).rejects.toMatchObject({
      error: 'UnsupportedDomain',
      message: 'Not a supported handle domain',
    })
  })

  it('disallows reserved handles', async () => {
    await expect(tryHandle('about.test')).rejects.toMatchObject({
      error: 'HandleNotAvailable',
      message: 'Reserved handle',
    })
    await expect(tryHandle('atp.test')).rejects.toMatchObject({
      error: 'HandleNotAvailable',
      message: 'Reserved handle',
    })
  })

  it('handles racing signups for same handle', async () => {
    const COUNT = 10

    let successes = 0
    let failures = 0
    const promises: Promise<unknown>[] = []
    for (let i = 0; i < COUNT; i++) {
      const attempt = async () => {
        try {
          await agent.api.com.atproto.server.createAccount({
            email: `matching@test.com`,
            handle: `matching.guest.test`,
            password: `password`,
          })
          successes++
        } catch (err) {
          failures++
        }
      }
      promises.push(attempt())
    }
    await Promise.all(promises)
    expect(successes).toBe(1)
    expect(failures).toBe(9)
  })

  it('fails on unauthenticated requests', async () => {
    await expect(agent.api.com.atproto.server.getSession({})).rejects.toThrow()
  })

  it('logs in', async () => {
    const res = await agent.api.com.atproto.server.createSession({
      identifier: handle,
      password,
    })
    jwt = res.data.accessJwt
    expect(typeof jwt).toBe('string')
    expect(res.data.handle).toBe('alice.guest.test')
    expect(res.data.did).toBe(did)
    expect(res.data.email).toBe(email)
  })

  it('can perform authenticated requests', async () => {
    // @TODO each test should be able to run independently & concurrently
    agent.api.setHeader('authorization', `Bearer ${jwt}`)
    const res = await agent.api.com.atproto.server.getSession({})
    expect(res.data.did).toBe(did)
    expect(res.data.handle).toBe(handle)
    expect(res.data.email).toBe(email)
  })

  it('can reset account password', async () => {
    using sendResetPasswordMock = jest.spyOn(ctx.mailer, 'sendResetPassword')
    await agent.api.com.atproto.server.requestPasswordReset({ email })

    expect(sendResetPasswordMock).toHaveBeenCalledTimes(1)
    expect(sendMailMock).toHaveBeenCalledTimes(1)

    const [params] = sendResetPasswordMock.mock.lastCall!
    expect(params).toEqual({
      handle: 'alice.guest.test',
      token: expect.any(String),
    })

    const [mail] = sendMailMock.mock.lastCall!
    expect(mail.to).toEqual(email)
    expect(mail.subject).toBe('Password Reset Requested')
    expect(mail.html).toContain('Reset password')
    expect(mail.html).toContain('alice.guest.test')

    await agent.api.com.atproto.server.resetPassword({
      token: params.token,
      password: passwordAlt,
    })

    // Logs in with new password and not previous password
    await expect(
      agent.api.com.atproto.server.createSession({
        identifier: handle,
        password,
      }),
    ).rejects.toThrow('Invalid identifier or password')

    await expect(
      agent.api.com.atproto.server.createSession({
        identifier: handle,
        password: passwordAlt,
      }),
    ).resolves.toBeDefined()
  })

  it('allows only single-use of password reset token', async () => {
    using sendResetPasswordMock = jest.spyOn(ctx.mailer, 'sendResetPassword')

    await agent.api.com.atproto.server.requestPasswordReset({ email })
    expect(sendResetPasswordMock).toHaveBeenCalledTimes(1)
    const [params] = sendResetPasswordMock.mock.lastCall!
    expect(params.token).toBeDefined()

    // Reset back from passwordAlt to password
    await agent.api.com.atproto.server.resetPassword({
      token: params.token,
      password,
    })

    // Reuse of token fails
    await expect(
      agent.api.com.atproto.server.resetPassword({
        token: params.token,
        password,
      }),
    ).rejects.toThrow(ComAtprotoServerResetPassword.InvalidTokenError)

    // Logs in with new password and not previous password
    await expect(
      agent.api.com.atproto.server.createSession({
        identifier: handle,
        password: passwordAlt,
      }),
    ).rejects.toThrow('Invalid identifier or password')

    await expect(
      agent.api.com.atproto.server.createSession({
        identifier: handle,
        password,
      }),
    ).resolves.toBeDefined()
  })

  it('changing password invalidates past refresh tokens', async () => {
    using sendResetPasswordMock = jest.spyOn(ctx.mailer, 'sendResetPassword')

    await agent.api.com.atproto.server.requestPasswordReset({ email })

    expect(sendResetPasswordMock).toHaveBeenCalledTimes(1)
    const [params] = sendResetPasswordMock.mock.lastCall!
    expect(params.token).toBeDefined()

    const session = await agent.api.com.atproto.server.createSession({
      identifier: handle,
      password,
    })

    await agent.api.com.atproto.server.resetPassword({
      token: params.token.toLowerCase(), // Reset should work case-insensitively
      password,
    })

    await expect(
      agent.api.com.atproto.server.refreshSession(undefined, {
        headers: { authorization: `Bearer ${session.data.refreshJwt}` },
      }),
    ).rejects.toThrow('Token has been revoked')
  })

  it('allows only unexpired password reset tokens', async () => {
    await agent.api.com.atproto.server.requestPasswordReset({ email })

    const res = await ctx.accountManager.db.db
      .updateTable('email_token')
      .where('purpose', '=', 'reset_password')
      .where('did', '=', did)
      .set({
        requestedAt: new Date(Date.now() - 16 * minsToMs).toISOString(),
      })
      .returning(['token'])
      .executeTakeFirst()
    if (!res?.token) {
      throw new Error('Missing reset token')
    }

    // Use of expired token fails
    await expect(
      agent.api.com.atproto.server.resetPassword({
        token: res.token,
        password: passwordAlt,
      }),
    ).rejects.toThrow(ComAtprotoServerResetPassword.ExpiredTokenError)

    // Still logs in with previous password
    await expect(
      agent.api.com.atproto.server.createSession({
        identifier: handle,
        password: passwordAlt,
      }),
    ).rejects.toThrow('Invalid identifier or password')

    await expect(
      agent.api.com.atproto.server.createSession({
        identifier: handle,
        password,
      }),
    ).resolves.toBeDefined()
  })

  describe('accountType', () => {
    // Fresh, header-free agent: the shared `agent` above accumulates a
    // stale authorization header from earlier tests in this suite (see
    // 'can perform authenticated requests'), which trips the optional auth
    // verifier on createAccount if reused here. None of these accounts
    // request role: 'striker', so they default to 'catcher' and must use
    // the .guest. handle domain, same as any other Catcher signup.
    let freshAgent: AtpAgent

    beforeAll(() => {
      freshAgent = network.pds.getAgent()
    })

    it('defaults to person and ignores a non-admin accountType request', async () => {
      await freshAgent.api.com.atproto.server.createAccount({
        email: 'inst-attempt@test.com',
        handle: 'inst-attempt.guest.test',
        password: 'test123',
        accountType: 'institution',
      })

      const accnt = await ctx.accountManager.getAccount(
        'inst-attempt.guest.test',
      )
      expect(accnt?.accountType).toBe('person')
    })

    it('honors accountType on admin-authenticated createAccount', async () => {
      await freshAgent.api.com.atproto.server.createAccount(
        {
          email: 'inst-admin@test.com',
          handle: 'inst-admin.guest.test',
          password: 'test123',
          accountType: 'institution',
        },
        {
          headers: network.pds.adminAuthHeaders(),
          encoding: 'application/json',
        },
      )

      const accnt = await ctx.accountManager.getAccount('inst-admin.guest.test')
      expect(accnt?.accountType).toBe('institution')
    })

    it('defaults to person when accountType is not specified', async () => {
      await freshAgent.api.com.atproto.server.createAccount({
        email: 'plain-signup@test.com',
        handle: 'plain-signup.guest.test',
        password: 'test123',
      })

      const accnt = await ctx.accountManager.getAccount(
        'plain-signup.guest.test',
      )
      expect(accnt?.accountType).toBe('person')
    })

    it('rejects unauthenticated updateAccountType requests', async () => {
      const tryUnauthed = freshAgent.api.com.atproto.admin.updateAccountType({
        account: 'plain-signup.guest.test',
        accountType: 'institution',
      })
      await expect(tryUnauthed).rejects.toThrow('Authentication Required')

      const accnt = await ctx.accountManager.getAccount(
        'plain-signup.guest.test',
      )
      expect(accnt?.accountType).toBe('person')
    })

    it('allows an admin to promote an existing account to institution', async () => {
      await freshAgent.api.com.atproto.admin.updateAccountType(
        {
          account: 'plain-signup.guest.test',
          accountType: 'institution',
        },
        {
          headers: network.pds.adminAuthHeaders(),
          encoding: 'application/json',
        },
      )

      const accnt = await ctx.accountManager.getAccount(
        'plain-signup.guest.test',
      )
      expect(accnt?.accountType).toBe('institution')

      // and back, confirming the route isn't a one-way promotion
      await freshAgent.api.com.atproto.admin.updateAccountType(
        {
          account: 'plain-signup.guest.test',
          accountType: 'person',
        },
        {
          headers: network.pds.adminAuthHeaders(),
          encoding: 'application/json',
        },
      )

      const accntAfter = await ctx.accountManager.getAccount(
        'plain-signup.guest.test',
      )
      expect(accntAfter?.accountType).toBe('person')
    })

    it('is idempotent when the admin re-requests the value an account already has', async () => {
      await freshAgent.api.com.atproto.admin.updateAccountType(
        {
          account: 'inst-admin.guest.test',
          accountType: 'institution',
        },
        {
          headers: network.pds.adminAuthHeaders(),
          encoding: 'application/json',
        },
      )

      // already 'institution' from the earlier admin-authenticated
      // createAccount test — re-requesting the same value should succeed
      // as a no-op, not throw.
      await expect(
        freshAgent.api.com.atproto.admin.updateAccountType(
          {
            account: 'inst-admin.guest.test',
            accountType: 'institution',
          },
          {
            headers: network.pds.adminAuthHeaders(),
            encoding: 'application/json',
          },
        ),
      ).resolves.toBeDefined()

      const accnt = await ctx.accountManager.getAccount('inst-admin.guest.test')
      expect(accnt?.accountType).toBe('institution')
    })

    it('still enforces handle uniqueness with accountType in the insert', async () => {
      await freshAgent.api.com.atproto.server.createAccount(
        {
          email: 'handle-dupe@test.com',
          handle: 'handle-dupe.guest.test',
          password: 'test123',
          accountType: 'institution',
        },
        {
          headers: network.pds.adminAuthHeaders(),
          encoding: 'application/json',
        },
      )

      await expect(
        freshAgent.api.com.atproto.server.createAccount({
          email: 'handle-dupe-2@test.com',
          handle: 'handle-dupe.guest.test',
          password: 'test123',
        }),
      ).rejects.toThrow('Handle already taken: handle-dupe.guest.test')
    })
  })

  describe('promoteToStriker', () => {
    let freshAgent: AtpAgent

    beforeAll(() => {
      freshAgent = network.pds.getAgent()
    })

    it('promotes a real Catcher account: handle migrates and role flips', async () => {
      await freshAgent.api.com.atproto.server.createAccount({
        email: 'promote-me@test.com',
        handle: 'promote-me.guest.test',
        password: 'test123',
      })

      const res =
        await freshAgent.api.com.atproto.admin.promoteAccountToStriker(
          { account: 'promote-me.guest.test' },
          {
            headers: network.pds.adminAuthHeaders(),
            encoding: 'application/json',
          },
        )

      expect(res.data.handle).toBe('promote-me.test')

      const accnt = await ctx.accountManager.getAccount('promote-me.test')
      expect(accnt?.role).toBe('striker')
      expect(accnt?.handle).toBe('promote-me.test')
    })

    it('rejects promoting an account that is already a Striker', async () => {
      await freshAgent.api.com.atproto.server.createAccount(
        {
          email: 'already-striker@test.com',
          handle: 'already-striker.test',
          password: 'test123',
          role: 'striker',
        },
        {
          headers: network.pds.adminAuthHeaders(),
          encoding: 'application/json',
        },
      )

      await expect(
        freshAgent.api.com.atproto.admin.promoteAccountToStriker(
          { account: 'already-striker.test' },
          {
            headers: network.pds.adminAuthHeaders(),
            encoding: 'application/json',
          },
        ),
      ).rejects.toThrow('Account is already a Striker')
    })

    it('rejects promoting a nonexistent account', async () => {
      await expect(
        freshAgent.api.com.atproto.admin.promoteAccountToStriker(
          { account: 'nonexistent-account.guest.test' },
          {
            headers: network.pds.adminAuthHeaders(),
            encoding: 'application/json',
          },
        ),
      ).rejects.toThrow('Account does not exist')
    })

    it('rejects unauthenticated requests', async () => {
      await freshAgent.api.com.atproto.server.createAccount({
        email: 'unauthed-promote@test.com',
        handle: 'unauthed-promote.guest.test',
        password: 'test123',
      })

      await expect(
        freshAgent.api.com.atproto.admin.promoteAccountToStriker({
          account: 'unauthed-promote.guest.test',
        }),
      ).rejects.toThrow('Authentication Required')

      const accnt = await ctx.accountManager.getAccount(
        'unauthed-promote.guest.test',
      )
      expect(accnt?.role).toBe('catcher')
    })

    it('is idempotent when the handle already migrated but the role flip did not complete', async () => {
      await freshAgent.api.com.atproto.server.createAccount({
        email: 'partial-promote@test.com',
        handle: 'partial-promote.guest.test',
        password: 'test123',
      })
      const created = await ctx.accountManager.getAccount(
        'partial-promote.guest.test',
      )
      if (!created) throw new Error('Account not found')

      // Simulate a promoteToStriker() call that migrated the handle via PLC
      // + updateAccountHandle but crashed before the role flip — write the
      // target handle directly, leave role untouched.
      await ctx.accountManager.db.db
        .updateTable('actor')
        .set({ handle: 'partial-promote.test' })
        .where('did', '=', created.did)
        .execute()

      const promoted =
        await freshAgent.api.com.atproto.admin.promoteAccountToStriker(
          { account: created.did },
          {
            headers: network.pds.adminAuthHeaders(),
            encoding: 'application/json',
          },
        )

      expect(promoted.data.handle).toBe('partial-promote.test')
      const accnt = await ctx.accountManager.getAccount('partial-promote.test')
      expect(accnt?.role).toBe('striker')
    })

    it('rejects when the derived Striker handle is already taken by a different account', async () => {
      // An unrelated account already sits at the bare-domain handle a
      // Catcher named "collide-name" would derive to.
      await freshAgent.api.com.atproto.server.createAccount(
        {
          email: 'collide-owner@test.com',
          handle: 'collide-name.test',
          password: 'test123',
          role: 'striker',
        },
        {
          headers: network.pds.adminAuthHeaders(),
          encoding: 'application/json',
        },
      )

      const catcher = await freshAgent.api.com.atproto.server.createAccount({
        email: 'collide-catcher@test.com',
        handle: 'collide-name.guest.test',
        password: 'test123',
      })

      await expect(
        freshAgent.api.com.atproto.admin.promoteAccountToStriker(
          { account: catcher.data.did },
          {
            headers: network.pds.adminAuthHeaders(),
            encoding: 'application/json',
          },
        ),
      ).rejects.toThrow('already in use by a different account')

      const catcherAccnt = await ctx.accountManager.getAccount(
        'collide-name.guest.test',
      )
      expect(catcherAccnt?.role).toBe('catcher')
      const strikerAccnt =
        await ctx.accountManager.getAccount('collide-name.test')
      expect(strikerAccnt?.handle).toBe('collide-name.test')
    })

    it('a promoted account can create a top-level post afterward, where it was previously rejected', async () => {
      const created = await freshAgent.api.com.atproto.server.createAccount({
        email: 'writer@test.com',
        handle: 'writer.guest.test',
        password: 'test123',
      })

      const session = await freshAgent.api.com.atproto.server.createSession({
        identifier: 'writer.guest.test',
        password: 'test123',
      })

      const postAgent = network.pds.getAgent()
      postAgent.api.setHeader(
        'authorization',
        `Bearer ${session.data.accessJwt}`,
      )

      // Before promotion: rejected as a Catcher top-level post.
      await expect(
        postAgent.api.com.atproto.repo.createRecord({
          repo: created.data.did,
          collection: 'app.bsky.feed.post',
          record: { text: 'hello', createdAt: new Date().toISOString() },
        }),
      ).rejects.toThrow(
        'Catchers can only reply to existing threads, not create or edit top-level posts.',
      )

      await freshAgent.api.com.atproto.admin.promoteAccountToStriker(
        { account: created.data.did },
        {
          headers: network.pds.adminAuthHeaders(),
          encoding: 'application/json',
        },
      )

      // After promotion: the same account, same session, can now post.
      await expect(
        postAgent.api.com.atproto.repo.createRecord({
          repo: created.data.did,
          collection: 'app.bsky.feed.post',
          record: { text: 'hello', createdAt: new Date().toISOString() },
        }),
      ).resolves.toBeDefined()
    })

    it('revokes the promoted account refresh token, forcing re-login', async () => {
      await freshAgent.api.com.atproto.server.createAccount({
        email: 'logout-me@test.com',
        handle: 'logout-me.guest.test',
        password: 'test123',
      })

      const session = await freshAgent.api.com.atproto.server.createSession({
        identifier: 'logout-me.guest.test',
        password: 'test123',
      })

      await freshAgent.api.com.atproto.admin.promoteAccountToStriker(
        { account: 'logout-me.guest.test' },
        {
          headers: network.pds.adminAuthHeaders(),
          encoding: 'application/json',
        },
      )

      // The pre-promotion refresh token no longer works: the Catcher session
      // is forced to end, so the client re-authenticates and picks up the
      // migrated Striker handle instead of running on stale cached state.
      await expect(
        freshAgent.api.com.atproto.server.refreshSession(undefined, {
          headers: { authorization: `Bearer ${session.data.refreshJwt}` },
        }),
      ).rejects.toThrow('Token has been revoked')

      // A fresh login under the new handle works normally.
      await expect(
        freshAgent.api.com.atproto.server.createSession({
          identifier: 'logout-me.test',
          password: 'test123',
        }),
      ).resolves.toBeDefined()
    })
  })

  describe('listStrikers', () => {
    let freshAgent: AtpAgent

    beforeAll(() => {
      freshAgent = network.pds.getAgent()
    })

    it('lists active Strikers, DID + handle, excluding Catchers', async () => {
      const striker1 = await freshAgent.api.com.atproto.server.createAccount(
        {
          email: 'liststrk1@test.com',
          handle: 'liststrk1.test',
          password: 'test123',
          role: 'striker',
        },
        {
          headers: network.pds.adminAuthHeaders(),
          encoding: 'application/json',
        },
      )
      const striker2 = await freshAgent.api.com.atproto.server.createAccount(
        {
          email: 'liststrk2@test.com',
          handle: 'liststrk2.test',
          password: 'test123',
          role: 'striker',
        },
        {
          headers: network.pds.adminAuthHeaders(),
          encoding: 'application/json',
        },
      )
      await freshAgent.api.com.atproto.server.createAccount({
        email: 'liststrkcat@test.com',
        handle: 'liststrkcat.guest.test',
        password: 'test123',
      })

      const res = await freshAgent.api.com.atproto.temp.listStrikers({})
      const dids = res.data.strikers.map((s) => s.did)

      expect(dids).toContain(striker1.data.did)
      expect(dids).toContain(striker2.data.did)

      const catcher = await ctx.accountManager.getAccount(
        'liststrkcat.guest.test',
      )
      expect(dids).not.toContain(catcher?.did)

      const found1 = res.data.strikers.find((s) => s.did === striker1.data.did)
      expect(found1?.handle).toBe('liststrk1.test')
    })

    it('excludes a takendown Striker', async () => {
      const created = await freshAgent.api.com.atproto.server.createAccount(
        {
          email: 'liststrktd@test.com',
          handle: 'liststrktd.test',
          password: 'test123',
          role: 'striker',
        },
        {
          headers: network.pds.adminAuthHeaders(),
          encoding: 'application/json',
        },
      )

      await ctx.accountManager.takedownAccount(created.data.did, {
        applied: true,
      })

      const res = await freshAgent.api.com.atproto.temp.listStrikers({})
      const dids = res.data.strikers.map((s) => s.did)
      expect(dids).not.toContain(created.data.did)
    })

    it('succeeds with no auth headers at all', async () => {
      await expect(
        freshAgent.api.com.atproto.temp.listStrikers({}),
      ).resolves.toBeDefined()
    })
  })

  it('allows an admin to update password', async () => {
    const tryUnauthed = agent.api.com.atproto.admin.updateAccountPassword({
      did,
      password: 'new-admin-pass',
    })
    await expect(tryUnauthed).rejects.toThrow('Authentication Required')

    await agent.api.com.atproto.admin.updateAccountPassword(
      { did, password: 'new-admin-password' },
      {
        headers: network.pds.adminAuthHeaders(),
        encoding: 'application/json',
      },
    )

    // old password fails
    await expect(
      agent.api.com.atproto.server.createSession({
        identifier: did,
        password,
      }),
    ).rejects.toThrow('Invalid identifier or password')

    await expect(
      agent.api.com.atproto.server.createSession({
        identifier: did,
        password: 'new-admin-password',
      }),
    ).resolves.toBeDefined()
  })
})
