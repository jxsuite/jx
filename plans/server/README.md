# server.md audit

Audited against 18ca39f6 on 2026-10-18.

## Verified

- The spec was Implemented before this record existed, and every section other than §3.5 keeps that standing: no section marker other than §3.5's is open, and `bun run docs:status` reads none.
- §3 (static lanes) against packages/server/src/server.ts: every static lane reads `activeProjectRoot`, which `POST /__studio/activate` sets for the whole process. That is §3.5's open item, reproduced with two Studio tabs on two projects served by one dev server: the first tab's request for a file only its own project has answers 404 once the second tab activates.
- §4.1 (git routes) against packages/server/src/studio-api.ts and packages/studio/src/platforms/devserver.ts (`gitRoute`): every git call names its project with `?dir=` and is checked with `assertAccessible`, so the git half of the same defect is closed.

## Dispositioned without a plan

- No roadmap, status ledger or stale status cell.

## Spec-wide decisions

- The spec went back to Partial for one item, §3.5, and graduates again in the pull request that closes it.
