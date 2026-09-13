import type { AtIdentifierString } from '@atproto/lex'
import { PDS, httpLogger } from '@atproto/pds'
// `.ts`, not `.js`: this directory is executed by Node's own type stripping
// (Dockerfile CMD runs `node index.ts`), which resolves specifiers as
// written and does not rewrite a `.js` suffix to the `.ts` file on disk.
import { PerDomainIssuanceRateLimiter } from './tls-check-rate-limiter.ts'

// Infrastructure subdomains that should get a certificate but aren't and
// never will be account handles - not covered by the account-handle lookup
// below, so listed explicitly rather than bypassing that check.
const ADDITIONAL_APPROVED_DOMAINS = new Set(['app.sunnahsky.com'])

// Caddy 2.9+ removed on_demand_tls's own "interval"/"burst" option, so the
// ask endpoint below carries its own limiter. Per-domain, 5 approvals per
// hostname per hour (Let's Encrypt's failed-validation limit) - see the
// class doc for why a global cap is the wrong shape here.
const issuanceRateLimiter = new PerDomainIssuanceRateLimiter(5, 60 * 60 * 1000)

void PDS.run({
  onCreated: (pds) => {
    // Caddy's on_demand_tls "ask" callback: approves or denies certificate
    // issuance for a hostname before Caddy will obtain one. Ported from
    // bluesky-social/pds's service/index.ts, which layers this route onto
    // @atproto/pds via the same onCreated hook - it isn't part of
    // @atproto/pds itself.
    pds.app.get('/tls-check', async (req, res) => {
      try {
        // Caddy calls this route directly on localhost:3000, never through
        // its own reverse_proxy - so a genuine ask carries no
        // X-Forwarded-For, while every request that arrived via a public
        // site block does (Caddy adds the header on proxying). Refuse the
        // proxied form: this endpoint answers "does this hostname get a
        // certificate", and with a limiter behind it a public caller could
        // otherwise spend a real hostname's approval budget on purpose. The
        // Caddyfile also declines to proxy /tls-check on pds.sunnahsky.com;
        // this is the backstop for the config drifting.
        if (req.headers['x-forwarded-for'] !== undefined) {
          return res.status(404).json({
            error: 'NotFound',
            message: 'Not Found',
          })
        }

        const { domain } = req.query
        if (!domain || typeof domain !== 'string') {
          return res.status(400).json({
            error: 'InvalidRequest',
            message: 'bad or missing domain query param',
          })
        }

        const approve = () => {
          if (!issuanceRateLimiter.tryApprove(domain)) {
            return res.status(429).json({
              error: 'TooManyRequests',
              message:
                'certificate issuance rate limit exceeded for this hostname, try again later',
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
