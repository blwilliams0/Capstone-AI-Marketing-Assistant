# Deployment Notes

Status: **no production deployment exists and none has been tested.** This page records what is known today. Full deployment, monitoring and backup procedures are Stage 5 work. Nothing here authorizes spending money: choosing and paying for hosting is the owner's decision.

## What must run

| Piece | How it runs | Needs |
|---|---|---|
| API | Always-on Node 24 process: `node apps/api/dist/index.js` after `npm run build` | `NODE_ENV=production`, `AUTH_MODE=supabase`, `SUPABASE_URL`, `DATABASE_URL`, `WEB_ORIGIN`, optionally `SUPABASE_SECRET_KEY` for invitations |
| Worker | Always-on Node 24 process: `node apps/worker/dist/index.js` | `DATABASE_URL` |
| Web app | Static files in `apps/web/dist` served by any static host | `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `VITE_API_URL` at build time |
| Database and sign-in | Supabase (already created for development) | `npm run db:migrate` once, then after each new migration |

The web app is built with the public values compiled in. Server secrets are never sent to the browser; `npm run check:bundle` verifies that after every build.

## Safety guards built in

- The API **refuses to start** if `AUTH_MODE=mock` unless `NODE_ENV` is `development` or `test`. An unset `NODE_ENV` counts as production.
- The API refuses to start in real mode without `SUPABASE_URL` and `DATABASE_URL`.
- CORS allows only `WEB_ORIGIN`.

## Supabase requirement to confirm

The API verifies sign-in tokens using the Supabase project's public signing keys, published at `https://<project-ref>.supabase.co/auth/v1/.well-known/jwks.json`. This requires the project to use **asymmetric JWT signing keys** (ES256/RS256). If that address lists no keys, the project still uses the legacy shared secret and the verifier must be changed before sign-in will work. This has **not** been checked against the real project yet.

## Hosting

The architecture calls for an always-on U.S.-region Node host for the API and worker (Render and Railway were named for evaluation) and a static host for the web app. No provider has been selected, priced or tested. Do not enable paid services without the owner's approval.

## Before real client data or live accounts

Follow the pre-handoff checklist in `The_Pocket_Client_Cost_Security_and_Maintenance_v0_1.md`. In particular: vendor account ownership, spending limits, backup and restore test, access review. None of these are done yet.
