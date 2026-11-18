# Stage 1 Remediation Report

Date: 2026-11-08. Branch: `stage1-remediation` (changes are **uncommitted** for owner review; nothing has been pushed). Plan: [STAGE1_REMEDIATION_PLAN.md](STAGE1_REMEDIATION_PLAN.md). Raw results: [TEST_LOG.md](TEST_LOG.md).

## Bottom line

Stage 1 is now a working, tested software foundation **in an offline test environment**. A clean install builds, type-checks, lints and passes all 76 automated tests. The authentication, permission, database and worker designs are sound and covered by tests.

It is **not yet verified against the real Supabase project or in a real browser.** Those are the remaining gaps (section 5), and each takes the owner roughly 15 minutes once two server-side secrets are added.

**Recommendation: sign off Stage 1 as "verified offline", conditional on the live verification checklist in section 6.** Do not start Stage 2 until that checklist passes. Stage 2 has not been started, per the owner's instruction.

## 1. Codex audit

No Codex audit report (`docs/STAGE1_INDEPENDENT_AUDIT.md` or similar), issue list or earlier remediation plan exists in the repository, so none could be addressed. If one exists elsewhere, please add it and its findings will be checked against this report.

## 2. What was wrong and what is now true

| Finding | Status | Evidence |
|---|---|---|
| C1 Mock auth for every request, role from env var | **Fixed.** Real token verification; role read from the database; mock sign-in refused unless `NODE_ENV` is `development` or `test` | `auth.test.ts` (13), `config.test.ts` (11); compiled API refused `production + mock` and unset `NODE_ENV + mock` |
| C2 No permissions on routes; public publish endpoint; open CORS | **Fixed.** Every route declares a required permission (cannot be omitted); mock publish and AI endpoints removed; CORS restricted | `rbac.test.ts` tests every route against every role; live `curl`: old endpoints return 404 |
| C3 Secrets exposure | **None found, and none introduced** | Credential sweep and history scan in TEST_LOG |
| H1 Could not install | **Fixed.** Web package created, shared source added, real lockfile | `npm ci` exit 0 from a clean tree |
| H2 PowerShell corruption | **Fixed** by rewriting affected files through a tool that cannot mangle them; `create-packages.ps1` deleted | Build and tests; encoding scan found no other damaged file |
| H3 API compile and runtime errors | **Fixed** | `npm run build`, `typecheck`, compiled API started and answered requests |
| H4 Web broken | **Fixed.** Role picker removed; mock sign-in compiled out of production builds | Web build; `check:bundle` finds no mock UI. **Not viewed in a browser** |
| H5 Worker had no queue | **Fixed.** Durable queue, leases, retries, duplicate prevention, history | `jobs.test.ts` (7), `worker.test.ts` (7) |
| H6 Migration design and RLS | **Fixed** (foundation scope). See section 3 | `migrations.test.ts` (10) |
| H7 Wrong permission matrix | **Fixed** to match PRD section 2 | `roles.test.ts` (5) |
| H8 Fake tests | **Replaced** with 76 real tests; a deliberately injected leak proved the bundle scanner works | TEST_LOG |
| M1 Misleading docs | **Fixed.** Originals kept with a "superseded" banner | `docs/*` |
| M2 Env names, migrate script | **Fixed** | `.env.example`, `db:migrate` |
| M3 Mock providers | **Fixed.** Validated input, no payload logging, no HTTP exposure | `providers.test.ts` |
| M4 Dependency advisories | **Mostly fixed.** 0 in production dependencies; 7 moderate remain in a dev-only lint tool | `npm audit` |
| L1, L2 Cleanup | **Fixed** | git status |

## 3. Key design choices (plain English)

- **Who you are vs. what you may do are separate.** Supabase proves *who* someone is. This system's own database says *what they may do*. A person could edit their own Supabase profile to say "admin"; the API ignores that and tests prove it.
- **Removing someone works instantly.** The role is looked up on every request, so a removed person is refused on their very next action. The last administrator cannot be removed.
- **Permissions cannot be forgotten.** A new route cannot be written without naming who may call it, and an automatic test tries every route as every role.
- **History cannot be rewritten.** The database itself blocks edits and deletes of audit, permission and job history.
- **The database is closed to the outside.** Row-level security is on for every table with no public access; only the API and worker connect to it. This is also why the browser never needs database credentials.
- **The worker cannot publish anything.** It has one harmless test job. Real publishing handlers come in Stage 4 and must re-check approvals.

## 4. Files changed

Summary (84 changed paths at the time of writing; see `git status`):

- **Removed:** Qwen's broken API files (`middleware/*`, `mocks/*`, `routes.ts`, `server.ts`, `types.ts`, `utils/logger.ts`), the old worker files, `db/migrations/001_initial_schema.sql`, `create-packages.ps1`, root `tsconfig.json`, `vitest.config.ts`, the junk file `h -u origin main`.
- **New code:** `packages/shared/src/*`, `packages/db/src/*` (database wrapper, migration runner, job queue), `db/migrations/001_foundation.sql`, `apps/api/src/*` (config, auth, policy router, routes, audit, providers, scripts, tests), `apps/worker/src/worker.ts` and test, `apps/web/package.json` and `src/auth.tsx`, `scripts/check-bundle.mjs`, `eslint.config.js`, `tsconfig.base.json`.
- **Rewritten:** root `package.json`, `turbo.json`, `.env.example`, `.gitignore`, web `App.tsx`/`main.tsx`/`vite.config.ts`/`index.html`, README and all docs.
- **New docs:** `DECISIONS.md`, `TEST_LOG.md`, `AI_ASSISTANCE.md`, this report and the plan.
- **Deviation from the original layout:** one extra workspace, `packages/db`, so the API and worker share one tested database implementation.

## 5. Remaining limitations and risks

**Unverified (highest priority):**
1. **Real Supabase sign-in.** The API verifies tokens against the project's public signing keys. If the project still uses the legacy shared secret instead of asymmetric keys, sign-in will fail until the verifier is adjusted. *Risk: low-medium; fix is small.*
2. **Migration on real Supabase Postgres.** Tested on an in-process Postgres only.
3. **Real invitation emails** (needs `SUPABASE_SECRET_KEY`).
4. **The web app in a real browser**, including the invitation and set-password flow.

**Known limitations (documented in `STATUS.md`):** no rate limiting; worker jobs must finish inside their 5-minute lease; removed staff cannot yet be re-invited; mock sign-in is read-only; the 7 dev-only advisories.

**Process risks:**
- The codebase was rebuilt substantially rather than patched. That was the right call given its state, but it means the owner should review the diff rather than trust it.
- Dependencies were moved to current major versions (Express 5, Zod 4, Vitest 5). The 76 tests pass on them, but the team has no prior experience with these versions in this project.
- `AI_ASSISTANCE.md` has sections the owner must complete for academic attribution.

## 6. Live verification checklist (owner, about 15 minutes)

1. Add `DATABASE_URL` and `SUPABASE_SECRET_KEY` to `.env.local` (never commit; never paste them into chat).
2. Open `https://<project-ref>.supabase.co/auth/v1/.well-known/jwks.json` in a browser. It should list at least one key. If it lists none, tell Claude.
3. `npm run db:migrate`. Expect "Applied: 001_foundation.sql".
4. `npm run bootstrap-admin -- --email <your email> --name "<your name>"`. Open the email, set a password.
5. `npm run dev:api` and `npm run dev:web`, then sign in at http://localhost:5173. You should see your name and the administrator role.
6. Invite a second test account as a contributor; confirm that account sees the contributor role and that the invitation appears in the activity history.

If all six pass, Stage 1 can be signed off without conditions. Chef Mike's and GM Elliot's administrator accounts should be created the same way, using their verified email addresses, when management is ready.

## 7. Decisions needed from the owner

See `DECISIONS.md`: choose the embedding approach before Stage 3 (local per the architecture, or Bedrock Titan per the brief), and decide whether managers may approve their own drafts before Stage 2. Review and commit the branch when satisfied; I will not push.
