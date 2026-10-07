import { envToCfg, readEnv } from '../src/config/index.js'

// Sunnahsky: the self-label rule in api/com/atproto/repo/util.ts can be
// switched off only by code that builds the environment itself (dev-env),
// never by production configuration.
describe('the switch for the self-label rule', () => {
  const env = { blobstoreDiskLocation: '/tmp/self-label-switch-test' }

  it('keeps the rule on unless code building the environment sets it', () => {
    expect(envToCfg(env).service.allowAnySelfLabel).toBe(false)
    expect(
      envToCfg({ ...env, allowAnySelfLabel: true }).service.allowAnySelfLabel,
    ).toBe(true)
  })

  it('is read from no environment variable', () => {
    expect(readEnv()).not.toHaveProperty('allowAnySelfLabel')
  })
})
