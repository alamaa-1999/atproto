import type { AtIdentifierString } from '@atproto/lex'
import { PDS, httpLogger } from '@atproto/pds'

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
        if (domain === pds.ctx.cfg.service.hostname) {
          return res.json({ success: true })
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
        return res.json({ success: true })
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
