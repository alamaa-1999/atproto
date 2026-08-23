import { InvalidRequestError } from '@atproto/xrpc-server'
import type { AppContext } from '../../../../../context.js'
import {
  Code,
  getServiceEndpoint,
  isDataplaneError,
  unpackIdentityServices,
} from '../../../../../data-plane/index.js'
import { httpLogger as log } from '../../../../../logger.js'

/**
 * Gates the ability to bring a new article draft row into existence -
 * called from both createDraft and updateDraft's create-branch (when the
 * target id doesn't already exist), so a client can't bypass the Striker
 * gate or the drafts limit just by calling updateDraft with a fresh id
 * instead of createDraft. See the article-drafts plan's 2d section for why
 * this has to be a single shared helper rather than two inlined copies.
 *
 * Fails closed: any error resolving the caller's PDS, or any error/timeout
 * calling back to it, is treated as "not a Striker" - never as "assume
 * allowed and proceed."
 */
export async function assertCanCreateArticleDraft(
  ctx: AppContext,
  actorDid: string,
): Promise<void> {
  const isStriker = await checkIsStriker(ctx, actorDid)
  if (!isStriker) {
    throw new InvalidRequestError(
      'Only Strikers may create article drafts.',
      'NotAStriker',
    )
  }

  const { count } = await ctx.dataplane.getActorArticleDraftsCount({
    actorDid,
  })
  if (count >= ctx.cfg.articleDraftsLimit) {
    throw new InvalidRequestError(
      'Article drafts limit reached.',
      'ArticleDraftLimitReached',
    )
  }
}

async function checkIsStriker(
  ctx: AppContext,
  actorDid: string,
): Promise<boolean> {
  try {
    const identity = await ctx.dataplane
      .getIdentityByDid({ did: actorDid })
      .catch((err) => {
        if (isDataplaneError(err, Code.NotFound)) return undefined
        throw err
      })
    const services = identity && unpackIdentityServices(identity.services)
    const pds =
      services &&
      getServiceEndpoint(services, {
        id: 'atproto_pds',
        type: 'AtprotoPersonalDataServer',
      })
    if (!pds) return false

    const url = new URL('/xrpc/com.atproto.temp.checkStriker', pds)
    url.searchParams.set('did', actorDid)
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
    if (!res.ok) return false

    const body: unknown = await res.json()
    return (
      typeof body === 'object' &&
      body !== null &&
      'isStriker' in body &&
      body.isStriker === true
    )
  } catch (err) {
    // Fail closed - any network error, timeout, or unexpected shape means
    // "couldn't verify," which must never be treated as "verified true."
    log.warn(
      { err, actorDid },
      'failed to check Striker status for article draft creation',
    )
    return false
  }
}
