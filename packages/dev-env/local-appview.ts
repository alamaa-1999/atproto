// Full local PDS + AppView + bsync + PLC stack, no mock content seeding.
// bin.ts's stock `generateMockSetup()` creates accounts with plain handles,
// which this fork's PDS rejects (catcher-role accounts must use a
// `.guest.test` handle) - so it crashes before the stack finishes booting.
// This mirrors bin.ts's TestNetwork config but skips mock seeding entirely,
// for browser-testing article drafts against a real, locally-anchored
// account whose DID doc resolves to this local AppView (unlike
// local-network.ts's PDS-only stack, which has no AppView to proxy to).
import './dist/env.js'
import { TestNetwork } from './dist/network.js'
import { mockMailer } from './dist/util.js'

const run = async () => {
  const network = await TestNetwork.create({
    pds: {
      port: 2583,
      hostname: 'localhost',
      enableDidDocWithSession: true,
    },
    bsky: {
      dbPostgresSchema: 'bsky',
      port: 2584,
      publicUrl: 'http://localhost:2584',
    },
    plc: { port: 2582 },
    ozone: {
      port: 2587,
      chatUrl: 'http://localhost:2590',
      chatDid: 'did:example:chat',
      dbMaterializedViewRefreshIntervalMs: 30_000,
    },
  })
  mockMailer(network.pds)

  console.log(`👤 DID Placeholder server http://localhost:${network.plc.port}`)
  console.log(`🌞 Main PDS http://localhost:${network.pds.port}`)
  console.log(`🔑 Admin auth header ${network.pds.adminAuth()}`)
  console.log(`🗼 Ozone server http://localhost:${network.ozone.port}`)
  console.log(`🔄 Bsync server http://localhost:${network.bsync.port}`)
  console.log(`🌅 Bsky Appview http://localhost:${network.bsky.port}`)
  console.log(`🌅 Bsky Appview DID ${network.bsky.serverDid}`)
  console.log('READY: local-appview stack up, no mock content seeded')
}

run()
