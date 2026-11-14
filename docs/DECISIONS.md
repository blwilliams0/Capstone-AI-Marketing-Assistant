# Decisions Log

Product-owner decisions and technical decisions affecting the project. Newest first.

## 2026-11-08: Stage 1 remediation (owner decisions)

| Decision | Choice | Why |
|---|---|---|
| Database scope | **Foundation tables only** in migration 001: restaurants, profiles, memberships, permission events, audit events, jobs, job events | The original schema had never been applied and had structural problems. Brand, facts, campaign and approval tables are designed properly in Stage 2 when their workflows are built, rather than guessed now. |
| Package manager | **npm workspaces** (not pnpm) | Ships with Node, nothing extra to install, simpler for a future maintainer. |
| Verification approach | **Offline now, live later** | Tests use an in-process Postgres (PGlite) and locally signed tokens. Live checks against the real Supabase project wait for the owner to add `DATABASE_URL` and `SUPABASE_SECRET_KEY`. |
| Git | Work on branch `stage1-remediation`, left uncommitted for owner review, nothing pushed | Owner reviews before anything is saved to history or shared. |
| Stage 2 | **Not started.** Owner instruction on 2026-11-08: "dont do anything for stage 2 yet" | Stage 1 must be signed off first. |

## 2026-11-08: Technical decisions made during remediation

- **Roles are read from the database, never from tokens.** Token `user_metadata` is user-editable.
- **Permissions are named capabilities** defined once in `packages/shared`, matching the architecture's capability list. Approvers can approve posts but not brand rules (PRD section 2); contributors cannot edit brand content.
- **Public mock endpoints removed.** The first draft exposed `POST /api/social/publish` and `/api/qwen/*` to any caller. Mocks are now internal provider interfaces. Publishing will only ever run in the worker after approval re-checks.
- **Mock sign-in fails closed.** Allowed only when `NODE_ENV` is `development` or `test`; an unset `NODE_ENV` counts as production.
- **New `packages/db` workspace** (deviation from the six-folder layout in the Qwen instructions): holds the database wrapper, migration runner and job queue so the API and worker share one tested implementation.
- **Dependency majors:** Express 5, Zod 4, Vitest 5 (Zod 4 and Vitest 5 chosen to clear published security advisories; all tests pass on them).
- **No `pgcrypto` extension:** `gen_random_uuid()` is built into Postgres 13+ and Supabase.

## Open decisions and specification conflicts (for the owner)

1. **Embedding model (conflict).** `The_Pocket_AI_Architecture_v0_3.md` sections 2 and 5 call for a *local, privacy-first* embedding model (for example 384 dimensions, benchmarked first) and say never to guess a dimension. The README, the cost document and the project brief name **AWS Bedrock Titan Text Embeddings V2** (1024 dimensions, hosted). These conflict on privacy and on cost. Stage 1 deliberately creates no vector columns. Decide before Stage 3.
2. **Who may approve their own drafts** (architecture section 12): still open; affects Stage 2 approval rules.
3. **Re-inviting a removed person:** currently refused with a clear message. Decide the desired behaviour for Stage 2.
4. **First administrators:** Chef Mike and GM Elliot are intended administrators. Their accounts are not created; the owner runs `npm run bootstrap-admin` with verified email addresses.
5. **Supabase JWT signing keys:** confirm the project uses asymmetric keys (see `docs/DEPLOYMENT.md`).
