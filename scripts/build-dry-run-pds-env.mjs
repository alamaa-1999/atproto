#!/usr/bin/env node
/*
 * Builds a throwaway env file for a PDS dry run against a scratch copy of
 * real data. Every field name below is hardcoded by hand from
 * `packages/pds/example.env`, cross-checked against `src/config/env.ts` -
 * deliberately NOT a regex/pattern-based redaction. Three prior incidents in
 * this project all came from exactly that: a denylist or pattern that missed
 * a secret field because its name didn't match the expected shape (see
 * Sunnahsky_Security_Practices.md, "Fail closed"). An allowlist fails
 * closed instead: anything not named here is excluded and reported by name
 * only, never by value.
 *
 * Usage: node build-dry-run-pds-env.mjs <input-env-file> <output-env-file>
 */

import { readFileSync, writeFileSync } from 'node:fs'

// Every field this project's real pds.env is known to contain, derived from
// example.env. PDS_REPO_SIGNING_KEY_K256_PRIVATE_KEY_HEX is deliberately
// excluded - confirmed via full-repo grep it's read nowhere (not env.ts, not
// secrets.ts), a stale leftover in example.env itself.
const ALLOWLIST = [
  'PDS_HOSTNAME',
  'PDS_PORT',
  'PDS_DATA_DIRECTORY',
  'PDS_BLOBSTORE_DISK_LOCATION',
  'PDS_PLC_ROTATION_KEY_K256_PRIVATE_KEY_HEX',
  'PDS_DPOP_SECRET',
  'PDS_JWT_SECRET',
  'PDS_ADMIN_PASSWORD',
  'PDS_DID_PLC_URL',
  'PDS_BSKY_APP_VIEW_URL',
  'PDS_BSKY_APP_VIEW_DID',
  'PDS_CRAWLERS',
  'PDS_SERVICE_NAME',
  'PDS_LOGO_URL',
  'PDS_PRIMARY_COLOR',
  'PDS_ERROR_COLOR',
  'PDS_HOME_URL',
  'PDS_TERMS_OF_SERVICE_URL',
  'PDS_PRIVACY_POLICY_URL',
  'PDS_SUPPORT_URL',
  'PDS_BACKGROUND_LIGHT_URL',
  'PDS_BACKGROUND_DARK_URL',
  'NODE_TLS_REJECT_UNAUTHORIZED',
  'LOG_ENABLED',
  'LOG_LEVEL',
  'PDS_INVITE_REQUIRED',
  'PDS_DISABLE_SSRF_PROTECTION',
  // Found present in the real live file but missing from example.env during
  // manual review - all non-secret, typed fields in env.ts.
  'PDS_BLOB_UPLOAD_LIMIT',
  'PDS_REPORT_SERVICE_URL',
  'PDS_REPORT_SERVICE_DID',
  'PDS_RATE_LIMITS_ENABLED',
  'PDS_ACCEPTING_REPO_IMPORTS',
]

// Fields that get a dummy value instead of the real one, always - never
// written to the output file even when present in the allowlist above.
// Values match the shape each field's own validation expects (secrets.ts /
// env.ts), so the dry-run process actually boots.
const SECRET_DUMMIES = {
  // Exactly 64 hex chars (32 bytes) - a valid secp256k1 private key needs
  // that exact length to decode at all, regardless of the actual value.
  PDS_PLC_ROTATION_KEY_K256_PRIVATE_KEY_HEX: 'a1'.repeat(32),
  PDS_DPOP_SECRET: 'b2'.repeat(32),
  PDS_JWT_SECRET: 'dry-run-throwaway-jwt-secret-not-real',
  PDS_ADMIN_PASSWORD: 'dry-run-throwaway-admin-password-not-real',
}

function parseEnvFile(text) {
  const fields = new Map()
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    fields.set(key, value)
  }
  return fields
}

function main() {
  const [, , inputPath, outputPath] = process.argv
  if (!inputPath || !outputPath) {
    console.error(
      'Usage: node build-dry-run-pds-env.mjs <input-env-file> <output-env-file>',
    )
    process.exit(1)
  }

  const parsed = parseEnvFile(readFileSync(inputPath, 'utf8'))
  const outputLines = []
  const excludedFieldNames = []
  let writtenCount = 0

  for (const [key, value] of parsed) {
    if (!ALLOWLIST.includes(key)) {
      excludedFieldNames.push(key)
      continue
    }
    const outValue = key in SECRET_DUMMIES ? SECRET_DUMMIES[key] : value
    /*
     * No quoting here - unlike a shell or dotenv parser, Docker's own
     * `--env-file` format takes everything after `=` literally, quote
     * characters included. Wrapping in quotes would set the container's
     * env var to the literal string with quotes still in it.
     */
    outputLines.push(`${key}=${outValue}`)
    writtenCount += 1
  }

  writeFileSync(outputPath, outputLines.join('\n') + '\n', 'utf8')

  console.log(`Wrote ${writtenCount} allowlisted field(s) to ${outputPath}`)
  if (excludedFieldNames.length > 0) {
    console.log(
      `Excluded ${excludedFieldNames.length} field(s) not in the allowlist (name only, never value):`,
    )
    for (const name of excludedFieldNames) {
      console.log(`  - ${name}`)
    }
  }
}

main()
