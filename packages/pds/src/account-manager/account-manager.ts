import assert from 'node:assert'
import type { KeyObject } from 'node:crypto'
import type { Client as PlcClient } from '@did-plc/lib'
import { isEmailValid } from '@hapi/address'
import { isDisposableEmail } from 'disposable-email-domains-js'
import { HOUR, wait } from '@atproto/common'
import type { Keypair } from '@atproto/crypto'
import type { IdResolver } from '@atproto/identity'
import {
  type AtIdentifierString,
  type DidString,
  type HandleString,
  isAtIdentifierString,
} from '@atproto/lex'
import type { Cid } from '@atproto/lex-data'
import {
  INVALID_HANDLE,
  currentDatetimeString,
  isValidTld,
} from '@atproto/syntax'
import { AuthRequiredError, InvalidRequestError } from '@atproto/xrpc-server'
import type { ActorStore } from '../actor-store/actor-store.js'
import { assertValidDidDocumentForService } from '../api/com/atproto/server/util.js'
import { AuthScope } from '../auth-scope.js'
import type { ServerConfig } from '../config/config.js'
import { softDeleted } from '../db/index.js'
import { TimeDidKeyset, paginate } from '../db/pagination.js'
import { hasExplicitSlur } from '../handle/explicit-slurs.js'
import {
  baseNormalizeAndValidate,
  ensureHandleServiceConstraints,
  isServiceDomain,
} from '../handle/index.js'
import type { com } from '../lexicons/index.js'
import { httpLogger } from '../logger.js'
import type { ServerMailer } from '../mailer/index.js'
import type { Sequencer } from '../sequencer/index.js'
import {
  type AccountDb,
  type AccountType,
  type EmailTokenPurpose,
  type Role,
  getDb,
  getMigrator,
} from './db/index.js'
import * as accountHelpers from './helpers/account.js'
import { AccountStatus, type ActorAccount } from './helpers/account.js'
import * as auth from './helpers/auth.js'
import * as authorizedClientHelper from './helpers/authorized-client.js'
import * as emailToken from './helpers/email-token.js'
import * as invite from './helpers/invite.js'
import * as password from './helpers/password.js'
import * as repo from './helpers/repo.js'
import * as scrypt from './helpers/scrypt.js'
import * as token from './helpers/token.js'

export { AccountStatus, formatAccountStatus } from './helpers/account.js'

/**
 * Thrown by {@link AccountManager.login} when the identifier resolved to a
 * known account but the supplied credentials (account password / app
 * password) did not match. The matched `did` is attached so downstream
 * callers can distinguish "identifier known, credentials wrong" from
 * "identifier unknown" (which continues to throw a plain
 * {@link AuthRequiredError}).
 *
 * Callers should take care that remote clients *cannot* distinguish the above,
 * to prevent enumeration attacks. (Tested for in
 * packages/pds/tests/auth.test.ts)
 */
export class InvalidPasswordError extends AuthRequiredError {
  constructor(
    public readonly did: DidString,
    errorMessage = 'Invalid identifier or password',
  ) {
    super(errorMessage)
  }
}

export type AccountManagerDbConfig = {
  accountDbLoc: string
  disableWalAutoCheckpoint: boolean
}

export class AccountManager {
  readonly db: AccountDb

  constructor(
    readonly cfg: ServerConfig,
    readonly actorStore: ActorStore,
    readonly idResolver: IdResolver,
    readonly jwtKey: KeyObject,
    readonly mailer: ServerMailer,
    readonly sequencer: Sequencer,
    readonly plcClient: PlcClient,
    readonly plcRotationKey: Keypair,
  ) {
    this.db = getDb(cfg.db.accountDbLoc, cfg.db.disableWalAutoCheckpoint)
  }

  get serviceDid(): DidString {
    return this.cfg.service.did
  }

  get serviceHandleDomains(): string[] {
    return this.cfg.identity.serviceHandleDomains
  }

  async migrateOrThrow() {
    await this.db.ensureWal()
    await getMigrator(this.db).migrateToLatestOrThrow()
  }

  close() {
    this.db.close()
  }

  // Account
  // ----------

  async getAccount(
    handleOrDid: AtIdentifierString,
    flags?: accountHelpers.AvailabilityFlags,
  ): Promise<ActorAccount | null> {
    return accountHelpers.getAccount(this.db, handleOrDid, flags)
  }

  async getAccounts(
    dids: DidString[],
    flags?: accountHelpers.AvailabilityFlags,
  ): Promise<Map<string, ActorAccount>> {
    return accountHelpers.getAccounts(this.db, dids, flags)
  }

  async listStrikers(opts: { limit: number; cursor?: string }): Promise<{
    strikers: { did: DidString; handle: HandleString }[]
    cursor?: string
  }> {
    const { ref } = this.db.db.dynamic
    const keyset = new TimeDidKeyset(ref('actor.createdAt'), ref('actor.did'))
    const builder = paginate(accountHelpers.selectStrikerActorsQB(this.db), {
      limit: opts.limit,
      cursor: opts.cursor,
      keyset,
      direction: 'asc',
      tryIndex: true,
    })
    const res = await builder.execute()
    return {
      strikers: res.map(({ did, handle }) => ({ did, handle: handle! })),
      cursor: keyset.packFromResult(res),
    }
  }

  async getAccountByEmail(
    email: string,
    flags?: accountHelpers.AvailabilityFlags,
  ): Promise<ActorAccount | null> {
    return accountHelpers.getAccountByEmail(this.db, email, flags)
  }

  async isAccountActivated(did: DidString): Promise<boolean> {
    const account = await this.getAccount(did, { includeDeactivated: true })
    if (!account) return false
    return !account.deactivatedAt
  }

  async getDidForActor(
    handleOrDid: AtIdentifierString,
    flags?: accountHelpers.AvailabilityFlags,
  ): Promise<DidString | null> {
    const got = await this.getAccount(handleOrDid, flags)
    return got?.did ?? null
  }

  async getAccountStatus(handleOrDid: AtIdentifierString) {
    const got = await this.getAccount(handleOrDid, {
      includeDeactivated: true,
      includeTakenDown: true,
    })

    const { active, status = active ? AccountStatus.Active : undefined } =
      accountHelpers.formatAccountStatus(got)
    assert(status != null)
    return { status, account: got } as
      | { status: AccountStatus.Deleted; account: null }
      | { status: AccountStatus.Takendown; account: ActorAccount }
      | { status: AccountStatus.Deactivated; account: ActorAccount }
      | { status: AccountStatus.Active; account: ActorAccount }
  }

  async normalizeAndValidateHandle(
    handle: string,
    {
      role,
      allowAnyValid = false,
    }: {
      role?: Role
      allowAnyValid?: boolean
    } = {},
  ): Promise<HandleString> {
    const normalized = baseNormalizeAndValidate(handle)

    // tld validation
    if (!isValidTld(normalized)) {
      throw new InvalidRequestError(
        'Handle TLD is invalid or disallowed',
        'InvalidHandle',
      )
    }
    // slur check
    if (!allowAnyValid && hasExplicitSlur(normalized)) {
      throw new InvalidRequestError(
        'Inappropriate language in handle',
        'InvalidHandle',
      )
    }
    // No external domains, ever, for anyone — creating an account or
    // updating an existing one. Every handle must live under one of our own
    // service domains; there is no "bring your own domain" on Sunnahsky.
    if (!isServiceDomain(normalized, this.serviceHandleDomains)) {
      throw new InvalidRequestError(
        'Not a supported handle domain',
        'UnsupportedDomain',
      )
    }
    ensureHandleServiceConstraints(
      normalized,
      this.serviceHandleDomains,
      allowAnyValid,
    )
    if (role) {
      this.ensureHandleMatchesRole(normalized, role)
      await this.ensureNoCrossTierNameCollision(normalized)
    }

    return normalized
  }

  // Splits a handle into its tier and base name. Checked catcher-suffix-first
  // since ".guest.sunnahsky.com" itself ends with ".sunnahsky.com" - a handle
  // must never be read as Striker-tier just because it also happens to end
  // in that shorter suffix. `handle` is nullable because `Actor.handle` is:
  // an account can transiently have none.
  private splitHandleTier(handle: string | null): {
    tier: 'catcher' | 'striker' | null
    name: string
  } {
    const { catcherHandleDomain, strikerHandleDomain } = this.cfg.identity
    if (handle?.endsWith(catcherHandleDomain)) {
      return {
        tier: 'catcher',
        name: handle.slice(0, -catcherHandleDomain.length),
      }
    }
    if (handle?.endsWith(strikerHandleDomain)) {
      return {
        tier: 'striker',
        name: handle.slice(0, -strikerHandleDomain.length),
      }
    }
    return { tier: null, name: '' }
  }

  // Catcher handles must live under the "guest" subdomain (visible,
  // intentional labeling — never a bare service-domain handle); Strikers
  // must use the bare service domain, never the "guest" one.
  private ensureHandleMatchesRole(handle: string, role: Role): void {
    const { catcherHandleDomain, strikerHandleDomain } = this.cfg.identity
    const { tier } = this.splitHandleTier(handle)

    if (role === 'catcher' && tier !== 'catcher') {
      throw new InvalidRequestError(
        `Catchers must use a ${catcherHandleDomain} handle`,
        'UnsupportedDomain',
      )
    }
    if (role === 'striker' && tier !== 'striker') {
      throw new InvalidRequestError(
        `Strikers must use a ${strikerHandleDomain} handle`,
        'UnsupportedDomain',
      )
    }
  }

  // A Catcher and a Striker must never share the same base name — e.g.
  // "alice.guest.sunnahsky.com" and "alice.sunnahsky.com" both existing at
  // once implies affiliation/impersonation regardless of which one came
  // first, so this is checked symmetrically in both directions. Only
  // reachable after ensureHandleMatchesRole has already confirmed this
  // handle's own tier, so `tier` here is never null. If a demotion operation
  // is ever built, it must call this with its own DID excluded (the target
  // handle's own current handle is exactly what this would otherwise derive
  // and self-match mid-migration) — not bypass it the way promoteToStriker
  // safely does, since promotion's vacated handle can only ever match self.
  private async ensureNoCrossTierNameCollision(handle: string): Promise<void> {
    const { catcherHandleDomain, strikerHandleDomain } = this.cfg.identity
    const { tier, name } = this.splitHandleTier(handle)
    const otherDomain =
      tier === 'catcher' ? strikerHandleDomain : catcherHandleDomain
    const otherTierHandle = `${name}${otherDomain}` as HandleString

    const existing = await this.getAccount(otherTierHandle, {
      includeDeactivated: true,
      includeTakenDown: true,
    })
    if (existing) {
      const otherRole = tier === 'catcher' ? 'Striker' : 'Catcher'
      throw new InvalidRequestError(
        `Handle already taken by a ${otherRole} account: ${otherTierHandle}`,
        'HandleNotAvailable',
      )
    }
  }

  async createAccount({
    did,
    handle,
    role,
    accountType,
    email,
    password,
    repoCid,
    repoRev,
    inviteCode,
    deactivated,
    refreshJwt,
  }: {
    did: DidString
    handle: HandleString
    role: Role
    accountType?: AccountType
    email?: string
    password?: string
    repoCid: Cid
    repoRev: string
    inviteCode?: string
    deactivated?: boolean
    refreshJwt?: string
  }) {
    if (password && password.length > scrypt.NEW_PASSWORD_MAX_LENGTH) {
      throw new InvalidRequestError('Password too long')
    }

    const passwordScrypt =
      email && password ? await scrypt.genSaltAndHash(password) : undefined

    const now = currentDatetimeString()
    return this.db.transaction(async (dbTxn) => {
      if (inviteCode) {
        await invite.ensureInviteIsAvailable(dbTxn, inviteCode)
      }

      await accountHelpers.registerActor(dbTxn, {
        did,
        handle,
        role,
        accountType,
        deactivated,
      })

      if (email && passwordScrypt) {
        await accountHelpers.registerAccount(dbTxn, {
          did,
          email,
          passwordScrypt,
        })
      }

      await invite.recordInviteUse(dbTxn, {
        did,
        inviteCode,
        now,
      })

      if (refreshJwt) {
        await auth.storeRefreshToken(
          dbTxn,
          auth.decodeRefreshToken(refreshJwt),
          null,
        )
      }

      await repo.updateRoot(dbTxn, did, repoCid, repoRev)
    })
  }

  async createAccountAndSession(opts: {
    did: DidString
    handle: HandleString
    role: Role
    accountType?: AccountType
    email?: string
    password?: string
    repoCid: Cid
    repoRev: string
    inviteCode?: string
    deactivated?: boolean
  }) {
    const { accessJwt, refreshJwt } = await auth.createTokens({
      did: opts.did,
      jwtKey: this.jwtKey,
      serviceDid: this.serviceDid,
      scope: AuthScope.Access,
    })

    await this.createAccount({ ...opts, refreshJwt })

    return { accessJwt, refreshJwt }
  }

  /**
   * Validates the requested handle, updates the PLC document if needed, persists
   * the new handle locally, and emits an identity event.
   *
   * @throws {InvalidRequestError} when the handle is invalid, taken by another
   * account, or cannot be resolved for non-service domains.
   *
   * @see {@link AccountManager.updateAccountHandle} for behavior when the PLC update fails.
   */
  async updateHandle(
    did: DidString,
    newHandle: string,
    options?: { allowAnyValid?: boolean },
  ): Promise<ActorAccount & { handle: HandleString }> {
    const { account, handle } = await this.validateHandleUpdate(
      did,
      newHandle,
      options,
    )

    if (did.startsWith('did:plc:')) {
      // @TODO We should verify the status before issuing a PLC update.
      await this.plcClient.updateHandle(did, this.plcRotationKey, handle)
    } else {
      const resolved = await this.idResolver.did.resolveAtprotoData(did, true)
      if (resolved.handle !== handle) {
        throw new InvalidRequestError(
          'DID is not properly configured for handle',
        )
      }
    }

    // @NOTE If the next line fails (for any reason), we don't "rollback" the
    // PLC update above. The caller can just call this method again.
    await this.updateAccountHandle(did, handle)

    return { ...account, handle }
  }

  async validateHandleUpdate(
    did: DidString,
    newHandle: string,
    options?: { allowAnyValid?: boolean },
  ): Promise<{
    did: DidString
    handle: HandleString
    // Returned for convenience
    account: ActorAccount
  }> {
    const account = await this.getAccount(did, { includeDeactivated: true })
    if (!account) {
      throw new InvalidRequestError('Account not found')
    }

    const handle = await this.normalizeAndValidateHandle(newHandle, {
      allowAnyValid: options?.allowAnyValid,
      role: account.role,
    })

    // Pessimistic check to handle spam: also enforced by updateAccountHandle() and the db.
    const existing = await this.getAccount(handle, {
      includeDeactivated: true,
      includeTakenDown: true,
    })

    if (existing && existing.did !== did) {
      throw new InvalidRequestError(
        `Handle already taken: ${handle}`,
        'HandleNotAvailable',
      )
    }

    return { did, handle, account }
  }

  /**
   * @note Failure to emit the identity event will silently be ignored. Users
   * can emit the event again by updating their handle to the same value.
   */
  async updateAccountHandle(
    did: DidString,
    handle: HandleString,
  ): Promise<void> {
    await accountHelpers.updateHandle(this.db, did, handle)

    try {
      await this.sequencer.sequenceIdentity(did, handle)
    } catch (err) {
      httpLogger.error({ err, did, handle }, 'failed to sequence handle update')
    }
  }

  /**
   * Promotes an existing Catcher to Striker. Handle migrates first, then role
   * flips — never the reverse (see `role upgrade plan.md` for why the
   * ordering matters). The only public entry point that can change `role`
   * post-creation; there is deliberately no standalone "set role" method, so
   * this coupling can't be bypassed by a future call site.
   */
  async promoteToStriker(
    did: DidString,
  ): Promise<ActorAccount & { handle: HandleString }> {
    const account = await this.getAccount(did, { includeDeactivated: true })
    if (!account) {
      throw new InvalidRequestError('Account not found')
    }
    if (account.role === 'striker') {
      throw new InvalidRequestError('Account is already a Striker')
    }

    const { catcherHandleDomain, strikerHandleDomain } = this.cfg.identity
    const { tier, name } = this.splitHandleTier(account.handle)

    // Idempotent: if a prior attempt already migrated the handle but failed
    // before the role flip, don't try to re-derive/re-migrate — just proceed
    // to the role flip below.
    let handle: HandleString
    if (tier === 'striker') {
      handle = account.handle as HandleString
    } else {
      if (tier !== 'catcher') {
        // Defensive: should be unreachable given `ensureHandleMatchesRole` is
        // enforced everywhere a Catcher's handle can be set, but don't derive
        // a nonsense handle from an assumption that's suddenly false.
        throw new InvalidRequestError(
          `Account's current handle (${account.handle}) does not match the expected Catcher domain (${catcherHandleDomain}) — refusing to guess a new handle`,
        )
      }
      const newHandle = `${name}${strikerHandleDomain}` as HandleString

      this.ensureHandleMatchesRole(newHandle, 'striker')

      // Same collision check validateHandleUpdate does before any real handle
      // change — the derived handle is deterministic, but not guaranteed
      // unclaimed (an unrelated account could already hold it).
      const existing = await this.getAccount(newHandle, {
        includeDeactivated: true,
        includeTakenDown: true,
      })
      if (existing) {
        throw new InvalidRequestError(
          `Derived handle ${newHandle} is already in use by a different account`,
        )
      }

      if (did.startsWith('did:plc:')) {
        await this.plcClient.updateHandle(did, this.plcRotationKey, newHandle)
      } else {
        const resolved = await this.idResolver.did.resolveAtprotoData(did, true)
        if (resolved.handle !== newHandle) {
          throw new InvalidRequestError(
            'DID is not properly configured for handle',
          )
        }
      }

      // @NOTE Same caveat as updateHandle(): if the next line fails, we don't
      // roll back the PLC update above. Calling promoteToStriker() again is
      // safe — see the idempotency branch above.
      await this.updateAccountHandle(did, newHandle)
      handle = newHandle
    }

    // Force any active Catcher session to end: the client cached the old
    // (now-stale) handle in its account list, and a promoted Striker should
    // explicitly re-authenticate rather than keep running against stale
    // client-side state. Transactional with the role flip (matching
    // takedownAccount()/deactivateAccount()/updateAccountPassword() below) so
    // a failed revoke can't leave the account promoted with its old Catcher
    // tokens still valid - if this throws, the role flip rolls back too, and
    // a plain retry of promoteToStriker() reaches this step fresh rather than
    // being turned away by the "already a Striker" guard above.
    await this.db.transaction(async (dbTxn) => {
      await accountHelpers.setRole(dbTxn, did, 'striker')
      await auth.revokeRefreshTokensByDid(dbTxn, did)
      await token.removeByDid(dbTxn, did)
    })

    return { ...account, role: 'striker', handle }
  }

  async deleteAccount(did: DidString) {
    return accountHelpers.deleteAccount(this.db, did)
  }

  async takedownAccount(
    did: DidString,
    takedown: com.atproto.admin.defs.StatusAttr,
  ) {
    await this.db.transaction(async (dbTxn) => {
      await accountHelpers.updateAccountTakedownStatus(dbTxn, did, takedown)
      await auth.revokeRefreshTokensByDid(dbTxn, did)
      await token.removeByDid(dbTxn, did)
    })

    await this.sequenceAccountStatus(did)
  }

  async getAccountAdminStatus(did: DidString) {
    return accountHelpers.getAccountAdminStatus(this.db, did)
  }

  async updateRepoRoot(did: DidString, cid: Cid, rev: string) {
    return repo.updateRoot(this.db, did, cid, rev)
  }

  async deactivateAccount(
    did: DidString,
    options?: {
      deleteCredentials?: boolean
      deleteAfter?: string | null
    },
  ) {
    const wasUpdated = await this.db.transaction(async (dbTxn) => {
      if (options?.deleteCredentials) {
        await token.removeByDid(dbTxn, did)
        await authorizedClientHelper.deleteAllAuthorizedClients(dbTxn, did)
        await password.deleteAllAppPasswords(dbTxn, did)
      }

      return accountHelpers.deactivateAccount(
        dbTxn,
        did,
        options?.deleteAfter ?? null,
      )
    })

    if (!wasUpdated) {
      throw new InvalidRequestError('Account not found')
    }

    const accountStatus = await this.getAccountStatus(did)

    // Account is likely soft-deleted (takendown)
    if (accountStatus.status === AccountStatus.Deleted) {
      throw new InvalidRequestError('Account not found')
    }

    await this.sequencer.sequenceAccount(did, accountStatus.status)

    return accountStatus
  }

  async activateAccount(did: DidString) {
    await assertValidDidDocumentForService(this, did)

    const found = await accountHelpers.activateAccount(this.db, did, {
      // We cannot activate a takendown account
      includeTakenDown: false,
      includeDeactivated: true,
    })
    if (!found) {
      throw new InvalidRequestError('user not found', 'AccountNotFound')
    }

    const accountStatus = await this.getAccountStatus(did)

    const { account, status } = accountStatus

    if (status === AccountStatus.Deleted) {
      // A concurrent operation deleted the account
      throw new InvalidRequestError('user not found', 'AccountNotFound')
    }

    const syncData = await this.actorStore.read(did, (store) => {
      return store.repo.getSyncEventData()
    })

    await this.sequencer.sequenceAccountActivation(
      did,
      account.handle ?? INVALID_HANDLE,
      status,
      syncData,
    )

    return accountStatus
  }

  async sequenceAccountStatus(did: DidString) {
    const { status } = await this.getAccountStatus(did)
    await this.sequencer.sequenceAccount(did, status)
  }

  // Auth
  // ----------

  async createSession(
    did: DidString,
    appPassword: password.AppPassDescript | null,
    isSoftDeleted = false,
  ) {
    const { accessJwt, refreshJwt } = await auth.createTokens({
      did,
      jwtKey: this.jwtKey,
      serviceDid: this.serviceDid,
      scope: auth.formatScope(appPassword, isSoftDeleted),
    })
    // For soft deleted accounts don't store refresh token so that it can't be rotated.
    if (!isSoftDeleted) {
      const refreshPayload = auth.decodeRefreshToken(refreshJwt)
      await auth.storeRefreshToken(this.db, refreshPayload, appPassword)
    }
    return { accessJwt, refreshJwt }
  }

  async rotateRefreshToken(id: string) {
    const token = await auth.getRefreshToken(this.db, id)
    if (!token) return null

    const now = new Date()

    // take the chance to tidy all of a user's expired tokens
    // does not need to be transactional since this is just best-effort
    await auth.deleteExpiredRefreshTokens(this.db, token.did, now.toISOString())

    // Shorten the refresh token lifespan down from its
    // original expiration time to its revocation grace period.
    const prevExpiresAt = new Date(token.expiresAt)
    const REFRESH_GRACE_MS = 2 * HOUR
    const graceExpiresAt = new Date(now.getTime() + REFRESH_GRACE_MS)

    const expiresAt =
      graceExpiresAt < prevExpiresAt ? graceExpiresAt : prevExpiresAt

    if (expiresAt <= now) {
      return null
    }

    // Determine the next refresh token id: upon refresh token
    // reuse you always receive a refresh token with the same id.
    const nextId = token.nextId ?? auth.getRefreshTokenId()

    const { accessJwt, refreshJwt } = await auth.createTokens({
      did: token.did,
      jwtKey: this.jwtKey,
      serviceDid: this.serviceDid,
      scope: auth.formatScope(token.appPassword),
      jti: nextId,
    })

    const refreshPayload = auth.decodeRefreshToken(refreshJwt)
    try {
      await this.db.transaction((dbTxn) =>
        Promise.all([
          auth.addRefreshGracePeriod(dbTxn, {
            id,
            expiresAt: expiresAt.toISOString(),
            nextId,
          }),
          auth.storeRefreshToken(dbTxn, refreshPayload, token.appPassword),
        ]),
      )
    } catch (err) {
      if (err instanceof auth.ConcurrentRefreshError) {
        return this.rotateRefreshToken(id)
      }
      throw err
    }
    return { accessJwt, refreshJwt }
  }

  async revokeRefreshToken(id: string) {
    return auth.revokeRefreshToken(this.db, id)
  }

  // Login
  // ----------

  async login({
    identifier,
    password,
  }: {
    identifier: string
    password: string
  }): Promise<{
    // @TODO we should rename this "account" for consistency
    user: ActorAccount
    appPassword: password.AppPassDescript | null
    isSoftDeleted: boolean
  }> {
    const start = Date.now()
    try {
      const identifierNormalized = identifier.toLowerCase()

      const user = identifierNormalized.includes('@')
        ? await this.getAccountByEmail(identifierNormalized, {
            includeDeactivated: true,
            includeTakenDown: true,
          })
        : isAtIdentifierString(identifierNormalized)
          ? await this.getAccount(identifierNormalized, {
              includeDeactivated: true,
              includeTakenDown: true,
            })
          : null

      if (!user) {
        throw new AuthRequiredError('Invalid identifier or password')
      }
      const isSoftDeleted = softDeleted(user)

      let appPassword: password.AppPassDescript | null = null
      const validAccountPass = await this.verifyAccountPassword(
        user.did,
        password,
      )
      if (!validAccountPass) {
        // takendown/suspended accounts cannot login with app password
        if (isSoftDeleted) {
          throw new InvalidPasswordError(user.did)
        }
        appPassword = await this.verifyAppPassword(user.did, password)
        if (appPassword === null) {
          throw new InvalidPasswordError(user.did)
        }
      }

      return { user, appPassword, isSoftDeleted }
    } finally {
      // Mitigate timing attacks
      await wait(350 - (Date.now() - start))
    }
  }

  // Passwords
  // ----------

  async createAppPassword(did: DidString, name: string, privileged: boolean) {
    return password.createAppPassword(this.db, did, name, privileged)
  }

  async listAppPasswords(did: DidString) {
    return password.listAppPasswords(this.db, did)
  }

  async verifyAccountPassword(
    did: DidString,
    passwordStr: string,
  ): Promise<boolean> {
    if (passwordStr.length > scrypt.OLD_PASSWORD_MAX_LENGTH) {
      // @NOTE Avoid throwing from here to avoid leaking account email validity
      // through error messages.
      return false
    }

    return password.verifyAccountPassword(this.db, did, passwordStr)
  }

  async verifyAppPassword(
    did: DidString,
    passwordStr: string,
  ): Promise<password.AppPassDescript | null> {
    return password.verifyAppPassword(this.db, did, passwordStr)
  }

  async revokeAppPassword(did: DidString, name: string) {
    await this.db.transaction(async (dbTxn) =>
      Promise.all([
        password.deleteAppPassword(dbTxn, did, name),
        auth.revokeAppPasswordRefreshToken(dbTxn, did, name),
      ]),
    )
  }

  // Invites
  // ----------

  async ensureInviteIsAvailable(code: string) {
    return invite.ensureInviteIsAvailable(this.db, code)
  }

  async createInviteCodes(
    toCreate: { account: string; codes: string[] }[],
    useCount: number,
  ) {
    return invite.createInviteCodes(this.db, toCreate, useCount)
  }

  async createAccountInviteCodes(
    forAccount: string,
    codes: string[],
    expectedTotal: number,
    disabled: 0 | 1,
  ) {
    return invite.createAccountInviteCodes(
      this.db,
      forAccount,
      codes,
      expectedTotal,
      disabled,
    )
  }

  async getAccountInvitesCodes(did: DidString) {
    const inviteCodes = await invite.getAccountsInviteCodes(this.db, [did])
    return inviteCodes.get(did) ?? []
  }

  async getAccountsInvitesCodes(dids: DidString[]) {
    return invite.getAccountsInviteCodes(this.db, dids)
  }

  async getInvitedByForAccounts(dids: DidString[]) {
    return invite.getInvitedByForAccounts(this.db, dids)
  }

  async getInviteCodesUses(codes: string[]) {
    return invite.getInviteCodesUses(this.db, codes)
  }

  async setAccountInvitesDisabled(did: DidString, disabled: boolean) {
    return invite.setAccountInvitesDisabled(this.db, did, disabled)
  }

  async disableInviteCodes(opts: { codes: string[]; accounts: string[] }) {
    return invite.disableInviteCodes(this.db, opts)
  }

  // Email Tokens
  // ----------

  async createEmailToken(did: DidString, purpose: EmailTokenPurpose) {
    return emailToken.createEmailToken(this.db, did, purpose)
  }

  async assertValidEmailToken(
    did: DidString,
    purpose: EmailTokenPurpose,
    token: string,
  ) {
    return emailToken.assertValidToken(this.db, did, purpose, token)
  }

  async assertValidEmailTokenAndCleanup(
    did: DidString,
    purpose: EmailTokenPurpose,
    token: string,
  ) {
    await emailToken.assertValidToken(this.db, did, purpose, token)
    await emailToken.deleteEmailToken(this.db, did, purpose)
  }

  async requestEmailConfirmation(did: DidString, opts?: { locale?: string }) {
    const account = await this.getAccount(did, {
      includeDeactivated: true,
      includeTakenDown: true,
    })

    if (!account) {
      throw new InvalidRequestError('account not found')
    }

    if (!account.email) {
      throw new InvalidRequestError('account does not have an email address')
    }

    const locale = opts?.locale
    const token = await this.createEmailToken(did, 'confirm_email')

    await this.mailer.sendConfirmEmail({ token, locale }, { to: account.email })
  }

  async confirmEmail(did: DidString, email: string, token: string) {
    const user = await this.getAccount(did, {
      includeDeactivated: true,
      includeTakenDown: true,
    })

    if (!user) {
      throw new InvalidRequestError('user not found', 'AccountNotFound')
    }

    if (user.email !== email.toLowerCase()) {
      throw new InvalidRequestError('invalid email', 'InvalidEmail')
    }

    await emailToken.assertValidToken(this.db, did, 'confirm_email', token)
    const now = currentDatetimeString()
    await this.db.transaction(async (dbTxn) => {
      await emailToken.deleteEmailToken(dbTxn, did, 'confirm_email')
      await accountHelpers.setEmailConfirmedAt(dbTxn, did, now)
    })

    user.emailConfirmedAt = now

    return user
  }

  async requestEmailUpdate(
    did: DidString,
    opts?: { locale?: string },
  ): Promise<{ tokenRequired: boolean }> {
    const account = await this.getAccount(did, {
      includeDeactivated: true,
      includeTakenDown: true,
    })

    if (!account) {
      throw new InvalidRequestError('account not found')
    }

    if (!account.email) {
      throw new InvalidRequestError('account does not have an email address')
    }

    const token = account.emailConfirmedAt
      ? await this.createEmailToken(did, 'update_email')
      : null

    if (token) {
      await this.mailer.sendUpdateEmail(
        { token, locale: opts?.locale },
        { to: account.email },
      )
    }

    return { tokenRequired: !!token }
  }

  /**
   * @throws UserAlreadyExistsError if the new email is already in use by another account
   */
  async updateEmail(
    did: DidString,
    email: string,
    token?: string,
    opts?: { locale?: string; sendConfirmationEmail?: boolean },
  ): Promise<ActorAccount> {
    if (!isEmailValid(email) || isDisposableEmail(email)) {
      throw new InvalidRequestError(
        'This email address is not supported, please use a different email.',
      )
    }

    const account = await this.getAccount(did, {
      includeDeactivated: true,
      includeTakenDown: true,
    })

    if (!account) {
      throw new InvalidRequestError('account not found')
    }

    const tokenRequired = !!account.emailConfirmedAt

    // require a token if account email is confirmed
    if (!token && tokenRequired) {
      throw new InvalidRequestError(
        'confirmation token required',
        'TokenRequired',
      )
    }

    if (token) {
      await this.assertValidEmailToken(did, 'update_email', token)
    }

    await this.updateAccountEmail({ did, email })

    account.email = email
    account.emailConfirmedAt = null

    // Proactively send a confirmation email so that the user can confirm the
    // new email immediately.
    if (opts?.sendConfirmationEmail) {
      const token = await this.createEmailToken(did, 'confirm_email')
      const locale = opts.locale
      await this.mailer.sendConfirmEmail({ token, locale }, { to: email })
    }

    return account
  }

  async updateAccountEmail(opts: { did: DidString; email: string }) {
    const { did, email } = opts
    await this.db.transaction(async (dbTxn) => {
      await accountHelpers.updateEmail(dbTxn, did, email)
      await emailToken.deleteAllEmailTokens(dbTxn, did)
    })
  }

  async updateAccountType(did: DidString, accountType: AccountType) {
    await accountHelpers.updateAccountType(this.db, did, accountType)
  }

  async resetPassword(opts: { password: string; token: string }) {
    const did = await emailToken.assertValidTokenAndFindDid(
      this.db,
      'reset_password',
      opts.token,
    )
    await this.updateAccountPassword({ did, password: opts.password })

    return did
  }

  async updateAccountPassword(opts: { did: DidString; password: string }) {
    const { did } = opts
    const passwordScrypt = await scrypt.genSaltAndHash(opts.password)
    await this.db.transaction(async (dbTxn) =>
      Promise.all([
        password.updateUserPassword(dbTxn, { did, passwordScrypt }),
        emailToken.deleteEmailToken(dbTxn, did, 'reset_password'),
        auth.revokeRefreshTokensByDid(dbTxn, did),
      ]),
    )
  }
}
