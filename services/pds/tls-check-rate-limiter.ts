/**
 * Per-domain approval limiter for the on-demand TLS `/tls-check` endpoint.
 *
 * Why per-domain and not global: Caddy consults the `ask` endpoint on every
 * certificate-cache miss, *before* it looks in its own storage (certmagic
 * `getCertDuringHandshake` runs the permission check ahead of
 * `loadCertFromStorage`). So after a Caddy restart, every existing handle
 * host asks again on its first handshake even though its certificate is
 * already issued and on disk. A global cap of N approvals per window turned
 * that ordinary cold-start fan-in into refused TLS handshakes for the
 * (N+1)th host - and a refused handshake on a handle host means
 * `/.well-known/atproto-did` is unreachable, which is exactly how Bluesky's
 * AppView ends up caching `handle.invalid` (see HANDOFF.md's incident
 * record). Caddy's own removed `interval`/`burst` option never had that
 * failure mode because it limited certificate *obtains*, not asks.
 *
 * What this protects instead: a single hostname's issuance retry loop.
 * Let's Encrypt allows 5 failed validations per hostname per hour; a domain
 * whose issuance keeps failing (bad DNS, an ACME outage) would otherwise be
 * re-asked and re-attempted on every handshake until that limit locks the
 * name out. The default window here mirrors that limit exactly. The normal
 * case - one ask, one approval, certificate cached - never comes near it.
 *
 * A burst of *distinct new* handles is not this limiter's job: new handle
 * hosts can only appear through account creation, which is the layer that
 * rate-limits it. In-memory and per-process; a PDS restart forgets history,
 * which fails open (approves), never closed.
 */
export class PerDomainIssuanceRateLimiter {
  private readonly approvals = new Map<string, number[]>()
  private readonly maxPerWindow: number
  private readonly windowMs: number

  // Plain field assignments rather than TS parameter properties: the latter
  // are not erasable syntax, and Node's type-stripping loader refuses them.
  constructor(maxPerWindow: number, windowMs: number) {
    this.maxPerWindow = maxPerWindow
    this.windowMs = windowMs
  }

  tryApprove(domain: string, now = Date.now()): boolean {
    this.prune(now)
    const recent = (this.approvals.get(domain) ?? []).filter(
      (ts) => now - ts < this.windowMs,
    )
    if (recent.length >= this.maxPerWindow) {
      this.approvals.set(domain, recent)
      return false
    }
    recent.push(now)
    this.approvals.set(domain, recent)
    return true
  }

  /** Drops domains with no approvals left inside the window, bounding memory. */
  private prune(now: number): void {
    for (const [domain, timestamps] of this.approvals) {
      if (timestamps.every((ts) => now - ts >= this.windowMs)) {
        this.approvals.delete(domain)
      }
    }
  }
}
