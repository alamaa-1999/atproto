---
'pds-service': patch
---

Enable `erasableSyntaxOnly` in `services/pds/tsconfig.json`. The service runs under Node's own type stripping (`node index.ts`), which refuses syntax that needs a compile step, such as TypeScript parameter properties. tsc now rejects that syntax too, so the typecheck fails before the container would.
