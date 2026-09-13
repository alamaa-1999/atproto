---
'pds-service': patch
---

Carry the on-demand TLS issuance rate limit inside `/tls-check` (Caddy 2.9+ removed `on_demand_tls`'s built-in `interval`/`burst`, confirmed by running `caddy validate` against the droplet's actual Caddy 2.11.4 image). Per hostname, not global: Caddy asks on every certificate-cache miss before consulting its own storage, so a global cap refused TLS handshakes for existing handle hosts after a Caddy restart. Also refuse `/tls-check` when it arrives via a reverse proxy (`X-Forwarded-For` present) - the endpoint is only ever called directly by Caddy, and a public caller could otherwise spend a hostname's approval budget on purpose.
