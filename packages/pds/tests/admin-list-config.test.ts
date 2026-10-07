import { envToCfg, readEnv } from '../src/config/index.js'

// Sunnahsky: PDS_SUNNAHSKY_ADMIN_DIDS, the accounts allowed to promote
// Catchers (account-management-plan.md in the workspace).
describe('the admin list setting', () => {
  const env = { blobstoreDiskLocation: '/tmp/admin-list-config-test' }

  it('is empty when unset, so only the admin password can promote', () => {
    expect(envToCfg(env).service.sunnahskyAdminDids).toEqual([])
  })

  it('takes DIDs separated by commas, ignoring spaces around them', () => {
    const cfg = envToCfg({
      ...env,
      sunnahskyAdminDids: ['did:plc:aaa', ' did:web:example.com '],
    })
    expect(cfg.service.sunnahskyAdminDids).toEqual([
      'did:plc:aaa',
      'did:web:example.com',
    ])
  })

  it('stops the PDS from starting on an entry that is not a DID', () => {
    for (const bad of ['alice.sunnahsky.com', '']) {
      expect(() =>
        envToCfg({ ...env, sunnahskyAdminDids: ['did:plc:aaa', bad] }),
      ).toThrow('PDS_SUNNAHSKY_ADMIN_DIDS')
    }
  })

  it('is read from PDS_SUNNAHSKY_ADMIN_DIDS', () => {
    process.env.PDS_SUNNAHSKY_ADMIN_DIDS = 'did:plc:aaa,did:plc:bbb'
    try {
      expect(readEnv().sunnahskyAdminDids).toEqual([
        'did:plc:aaa',
        'did:plc:bbb',
      ])
    } finally {
      delete process.env.PDS_SUNNAHSKY_ADMIN_DIDS
    }
  })
})
