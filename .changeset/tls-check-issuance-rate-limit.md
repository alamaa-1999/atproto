---
'pds-service': patch
---

Reimplement the on-demand TLS issuance rate limit (5 per 2 minutes) inside /tls-check, since Caddy 2.9+ removed on_demand_tls's built-in interval/burst directives - confirmed by running `caddy validate` against the droplet's actual Caddy 2.11.4 image, which rejects them outright
