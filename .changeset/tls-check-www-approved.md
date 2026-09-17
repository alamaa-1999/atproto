---
'pds-service': patch
---

Add www.sunnahsky.com to /tls-check's ADDITIONAL_APPROVED_DOMAINS. Missing since the original hostname-move build (only app.sunnahsky.com was added), caught only once Caddy's Stage 1 actually tried to certify it under on_demand_tls and /tls-check rejected it outright, leaving the block permanently uncertified.
