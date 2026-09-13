import type { AtIdentifierString } from '@atproto/lex'
import { PDS, httpLogger } from '@atproto/pds'

// Infrastructure subdomains that should get a certificate but aren't and
// never will be account handles - not covered by the account-handle lookup
// below, so listed explicitly rather than bypassing that check.
const ADDITIONAL_APPROVED_DOMAINS = new Set(['app.sunnahsky.com'])

/**
 * Caddy's own on_demand_tls "interval"/"burst" rate limiter was removed in
 * Caddy 2.9+ in favour of a "permission" module - this ask endpoint already
 * functions as one, so the same throttle (5 issuances per 2 minutes) is
 * reimplemented here rather than left dropped entirely ("PDS hostname move
 * and public URL scheme", Caddyfile validation). Global, not per-domain: a
 * burst of asks for many distinct *valid* handles is exactly the case the
 * per-domain check below cannot catch on its own, and every approval here
 * triggers a real Let's Encrypt issuance - the actual resource this paces
 * out. In-memory and per-process, matching Caddy's own former behaviour
 * (also in-memory, also reset on restart).
 */
class IssuanceRateLimiter {
  private approvalTimestamps: number[] = []

  constructor(
    private readonly burst: number,
    private readonly intervalMs: number,
  ) {}

  tryApprove(now = Date.now()): boolean {
    this.approvalTimestamps = this.approvalTimestamps.filter(
      (ts) => now - ts < this.intervalMs,
    )
    if (this.approvalTimestamps.length >= this.burst) {
      return false
    }
    this.approvalTimestamps.push(now)
    return true
  }
}

const issuanceRateLimiter = new IssuanceRateLimiter(5, 2 * 60 * 1000)

void PDS.run({
  onCreated: (pds) => {
    // Caddy's on_demand_tls "ask" callback: approves or denies certificate
    // issuance for a hostname before Caddy will obtain one. Ported from
    // bluesky-social/pds's service/index.ts, which layers this route onto
    // @atproto/pds via the same onCreated hook - it isn't part of
    // @atproto/pds itself.
    pds.app.get('/tls-check', async (req, res) => {
      try {
        const { domain } = req.query
        if (!domain || typeof domain !== 'string') {
          return res.status(400).json({
            error: 'InvalidRequest',
            message: 'bad or missing domain query param',
          })
        }

        const approve = () => {
          if (!issuanceRateLimiter.tryApprove()) {
            return res.status(429).json({
              error: 'TooManyRequests',
              message:
                'certificate issuance rate limit exceeded, try again shortly',
            })
          }
          return res.json({ success: true })
        }

        if (
          domain === pds.ctx.cfg.service.hostname ||
          ADDITIONAL_APPROVED_DOMAINS.has(domain)
        ) {
          return approve()
        }
        const isHostedHandle = pds.ctx.cfg.identity.serviceHandleDomains.find(
          (avail) => domain.endsWith(avail),
        )
        if (!isHostedHandle) {
          return res.status(400).json({
            error: 'InvalidRequest',
            message: 'handles are not provided on this domain',
          })
        }
        const account = await pds.ctx.accountManager.getAccount(
          domain as AtIdentifierString,
        )
        if (!account) {
          return res.status(404).json({
            error: 'NotFound',
            message: 'handle not found for this domain',
          })
        }
        return approve()
      } catch (err) {
        httpLogger.error({ err }, 'tls-check failed')
        return res.status(500).json({
          error: 'InternalServerError',
          message: 'Internal Server Error',
        })
      }
    })
  },
}).catch((err) => {
  // @NOTE we don't want to let the error propagate to the UnhandledRejection
  // handler, because that would cause Node to exit, which won't allow telemetry
  // to flush. Instead, we log the error and set the exit code.
  console.error('PDS failed to start:', err)
  process.exitCode = 1

  // In case the some resource were not properly cleaned up, we force exit after
  // a short delay. This is a last resort, and should not be necessary if the
  // PDS is implemented correctly. The delay is to give the telemetry a chance
  // to flush.
  setTimeout(() => process.exit(process.exitCode || 1), 5000).unref()
})
