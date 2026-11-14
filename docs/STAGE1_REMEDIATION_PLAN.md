# Stage 1 Remediation Plan

Prepared 2026-11-08 after inspecting commit `9267e45`. Outcomes are in [STAGE1_REMEDIATION_REPORT.md](STAGE1_REMEDIATION_REPORT.md).

## 1. Initial implementation status

Qwen reported Stage 1 as complete. Inspection showed the repository **could not install, compile, build, test or run**. Roughly 50 files existed, but file creation was not correctness:

- Nothing had ever been installed. `apps/web/package.json` did not exist, `packages/shared` had no source, and `pnpm-lock.yaml` was an empty placeholder.
- Much of the code was damaged because Qwen wrote files through PowerShell, which stripped `$`, backticks and template literals.
- Authentication treated every request as one mock user whose role came from an environment variable, with no production guard.
- No route enforced any permission, and publishing was a public HTTP endpoint.
- The two test files asserted nothing real.
- The database migration could not parse and had never been applied.

Stage 1 was therefore evaluated as a *software foundation*. Mock AI, mock social and mock-only auth were acceptable per the Stage 1 instructions; what was not acceptable was mock auth with no production guard and no real enforcement.

## 2. Prioritized findings

### Critical

| # | Finding | Affected files |
|---|---|---|
| C1 | Every request authenticated as a mock user; role chosen by `MOCK_USER_ROLE`; no production guard. Setting it to `admin` grants full access. | `apps/api/src/middleware/auth.ts` |
| C2 | No permission check on any route. `POST /api/social/publish` and `/api/qwen/*` open to any caller; publishing needs an approval (FR-07). CORS allowed every origin. | `routes.ts`, `server.ts`, `mocks/*` |
| C3 | Secret exposure check: **no real secrets found** in files or git history; `.env.local` correctly ignored. (Recorded so it is known to have been checked.) | whole repo |

### High

| # | Finding | Affected files |
|---|---|---|
| H1 | Cannot install: missing web `package.json`, no shared source, fake lockfile, lockfile ignored by `.gitignore`. | root, `apps/web`, `packages/shared` |
| H2 | PowerShell corruption: template literals, SQL `$$` delimiters, `$schema` key, broken doc code fences, unusable `create-packages.ps1`. | `server.ts`, `logger.ts`, `api.ts`, migration, `turbo.json`, docs |
| H3 | API compile and runtime errors: self-import, `listen()` on import, invalid audit action, `express@4` with `@types/express@5`, ESM output not runnable by Node. | `apps/api/**` |
| H4 | Web: non-existent `createApi`, missing re-exports, possible null user, Tailwind never imported, role picker lets anyone choose admin. | `apps/web/**` |
| H5 | Worker: duplicate exports, no run loop, no job table, no leasing or duplicate prevention. | `apps/worker/**` |
| H6 | Migration design: no link to Supabase Auth users; `restaurant_id` on one table only; approvals as editable status columns; audit table editable; cascading deletes into audited content; no row-level security (tables would be reachable through Supabase's public data API). | `001_initial_schema.sql` |
| H7 | Wrong permission matrix: approvers could approve brand rules; contributors could edit brand content. Contradicts PRD section 2. | `middleware/auth.ts` |
| H8 | Tests fake or broken; vitest config needed an uninstalled plugin; ESLint 9 had no config. | tests, configs |

### Medium

| # | Finding |
|---|---|
| M1 | Docs claimed "Stage 1 complete", "RBAC working", "React Query set up" falsely; broken formatting; `db/migrations/README.md` stored as UTF-16. |
| M2 | Environment names did not match the current Supabase key model (publishable and secret keys). `db:migrate` pointed the Supabase CLI at the wrong folder. |
| M3 | Mock providers crashed on missing input and logged full payloads (captions, prompts). Mock embedding named a different model from the docs. |
| M4 | Production dependency advisory (`zod`); dev-tool advisories. |

### Low

| # | Finding |
|---|---|
| L1 | Stray untracked file `h -u origin main` (a saved terminal help screen). |
| L2 | `?` placeholder characters in UI status text. |

### Specification conflict (recorded, not resolved)

The architecture specification (sections 2 and 5) requires a *local, privacy-first embedding model* with a pinned dimension; the README, cost document and project brief name AWS Bedrock Titan V2 (1024-dimension, hosted). This is a Stage 3 decision. Stage 1 creates no vector columns. See `DECISIONS.md`.

## 3. Required corrections (and approach)

1. **Housekeeping.** New branch `stage1-remediation`; delete junk files.
2. **Toolchain.** npm workspaces, strict shared TypeScript base, modern ESM (NodeNext), flat ESLint config, Turborepo tasks, real lockfile.
3. **Shared permissions.** One role-to-permission matrix in `packages/shared`, matching PRD section 2.
4. **Database.** Replace 001 with a foundation-only schema (see decision below): restaurants, profiles tied to Supabase Auth, memberships, permission events, audit events, jobs, job events. Append-only history by trigger, restrictive deletes, RLS on every table, a migration runner.
5. **API.** Verify Supabase JWTs (issuer, audience, expiry, signing key); read the role from the database; per-route permission policy that cannot be omitted; invitations, access removal with last-administrator protection, audit trail; restricted CORS; central error handling; fail-closed configuration; remove the open mock endpoints.
6. **Worker.** Durable queue with leases, retries, duplicate prevention and history; only a harmless no-op handler.
7. **Web.** Real Supabase sign-in, invitation and set-password flow, role display; mock sign-in only in development builds; explicit allowlist of values exposed to the browser.
8. **Tests.** Replace fake tests with real ones (migration, authentication, permission matrix, invitation and removal, configuration safety, queue, worker).
9. **Docs.** Rewrite README, status, API, deployment and migration docs to match reality; banner on the superseded reports; add decisions, test log and AI-assistance records.

## 4. Deferred (not Stage 1)

- Stage 2: employee marketing interface; brand, fact, strategy, campaign, content-version and approval-snapshot tables and workflows.
- Stage 3: real Qwen calls, embeddings and vector search, knowledge ingestion, spending controls.
- Stage 4: Meta authorization and publishing, CSV imports, KPIs.
- Stage 5: browser end-to-end tests, deployment, monitoring, backup and restore, training.

## 5. Decisions requiring the owner's approval

| Decision | Options | Owner's answer (2026-11-08) |
|---|---|---|
| Database scope | Foundation-only, or repair all of Qwen's tables now | **Foundation-only** |
| Package manager | npm workspaces, or pnpm | **npm** |
| Verification | Offline now with live checks later; also apply to the Supabase project; or offline only | **Offline now, live later** |
| Git handling | Branch uncommitted; branch with commits; work on main | **Branch, uncommitted, no push** |
| Stage 2 | Start after Stage 1? | **Not yet** ("dont do anything for stage 2 yet") |

Still open (see `DECISIONS.md`): embedding model; whether managers may approve their own drafts; re-inviting removed staff; who maintains production hosting.
