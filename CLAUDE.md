# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

The Pocket AI Marketing Assistant: a browser app for one restaurant (The Pocket, Carmel-by-the-Sea). Management controls the brand; an AI assistant helps staff draft and plan marketing; nothing is published without an exact, recorded human approval, and a person always does the final post (assisted manual posting, no social-media API). It is a CSUMB capstone project for a real client.

The specification is `The_Pocket_AI_Marketing_Assistant_PRD_v0_4.md` and `The_Pocket_AI_Architecture_Addendum_v0_4.md` (the v0.3 files are history). `docs/STATUS.md` is the current state, and `docs/TEST_LOG.md` records real verification output, including live AI token counts and costs. Update both, plus `docs/API.md` for new routes, at the end of each milestone.

## Commands

npm workspaces + Turborepo, TypeScript strict ESM (NodeNext), Node 24+.

```bash
npm run build          # all packages (apps import packages/* from dist)
npm run typecheck
npm run lint
npm test               # turbo, serialized (--concurrency=1)
npm run check:bundle   # after build: fails if the web bundle contains server secrets or names
npm run dev:api        # API on :3000 (tsx watch; restart it after changing .env.local)
npm run dev:web        # Vite on :5173
npm run dev:worker     # optional; the API also runs reminder scans
npm run db:migrate     # apply new SQL migrations to DATABASE_URL
```

Single test file or test name (run from the package directory):

```bash
cd apps/api && npx vitest run src/content.test.ts -t "self-approval"
```

After changing `packages/shared` or `packages/db`, rebuild them (`npm run build -w @the-pocket/shared`, `-w @the-pocket/db`) before typechecking or testing apps. Apps resolve those packages from `dist`, so stale builds show up as missing exports.

API scripts (`npm run <name> -w @the-pocket/api`, all read `../../.env.local`):
- `bootstrap-admin` and `load-knowledge` (loads a document as a knowledge proposal)
- `ai-live-check "question"`: one real Claude call, a few cents
- `create-media-bucket`: idempotent; private Supabase Storage bucket `post-media`

### Windows notes

- Tests use PGlite (in-process Postgres, WASM). More than 2 vitest workers, or packages tested in parallel, crash with exit code 0xC0000409. Keep `maxWorkers: 2` and turbo `--concurrency=1`. The crash can still happen intermittently; re-run before assuming a bug.
- Shell heredocs and one-liners have mangled content containing `$`, backticks or regex escapes. Write or modify such content with the file-editing tools, not the shell.
- Python is not installed; use Node for scripting.

## Architecture

```
apps/api      Express 5 REST API: all business rules
apps/web      React 19 + Vite + Tailwind v4 + React Router 7
apps/worker   job queue runner (reminder scans; deliberately no publishing handler)
packages/shared  roles/capabilities, zod schemas, view types shared by API and web
packages/db      Db interface, pg + PGlite adapters, migration runner, job queue, reminder scan
db/migrations    numbered SQL migrations
```

### Authorization (deny by default)

- Supabase Auth issues ES256 JWTs, verified with `jose` against the project JWKS. **Roles come from the `memberships` table, never from token claims.** `req.auth` is an `AuthContext` with capabilities.
- `packages/shared/src/roles.ts` is the single source of truth for capabilities. New capabilities also need a label in `apps/web/src/pages/Home.tsx` (`CAPABILITY_LABELS`) and a row in `docs/API.md`.
- Every route is added through `PolicyRouter` (`apps/api/src/policy.ts`), which requires a capability or `'member'`. `rbac.test.ts` calls every registered route as every role with an empty body and `not-a-uuid` params. Handlers must therefore validate params and body before doing anything with side effects.
- The web hides buttons by capability for convenience only; the server enforces everything.

### Database: integrity lives in Postgres

- The API connects as the database owner. Every table has RLS enabled with **no policies**, and all privileges are revoked from Supabase's `anon` and `authenticated` roles (tables, functions and sequences).
- Each new migration must:
  - enable RLS on its tables
  - revoke table, function **and** sequence access from `anon` and `authenticated`, and `REVOKE EXECUTE ON ALL FUNCTIONS ... FROM PUBLIC`
  - `ALTER FUNCTION ... SET search_path = public, pg_temp` on new functions

  `packages/db/src/testing.ts` reproduces Supabase's default grants, and `migrations.test.ts` fails if anything is left open.
- **Never edit an applied migration** (001–008 are live on the dev project); add a new one. History tables are append-only through the `forbid_change()` trigger; foreign keys are restrictive (no CASCADE).
- Rules are enforced twice, by API checks for friendly errors and by triggers as the real guarantee:
  - **Knowledge:** immutable versions, always inserted as `proposed`; only `brand.approve` (admins) approves; one approved version per item.
  - **Posts:** `content_versions` are immutable, and the database computes a canonical snapshot and SHA-256 digest. An approval request copies that digest. Any new version (text, date or photo) automatically supersedes pending or approved requests. Deciding requires an active approver or admin.
  - **Self-approval:** the decider is the requester or any author of the post. Only admins may do it, with `confirmSelfApproval`, and it is flagged and audited.
  - **Posting:** a post record needs a current approval, and the client must send back the digest it displayed. Approval and posting are blocked if cited knowledge was superseded, retired or expired. Posted items are locked.
- Business events go to `audit_events` through `recordAudit`, passing the transaction handle so it is atomic with the change.

### AI (Claude, server-side only)

- `AiProvider` interface (`apps/api/src/ai/provider.ts`) with a Claude implementation (`ai/claude.ts`: `@anthropic-ai/sdk` beta messages, US inference, citations or zod structured output; the model gets **no tools**) and a labelled mock.
- `config.ts` sets `aiMode`: `claude` when `ANTHROPIC_API_KEY` is set; `mock` only when `NODE_ENV` is `development` or `test`; otherwise `disabled` (AI routes return 503). An unset `NODE_ENV` counts as production. The same rule applies to `AUTH_MODE=mock`.
- **Context** (`ai/context.ts`), no embeddings:
  - the cached "brand core" (approved brand rules and facts, capped at 4,000 words)
  - plus approved strategy and reference sections chosen by Postgres full-text search under a token budget

  Documents are keyed `D1..Dn`. These keys must never reach staff, which `scrubDocumentKeys` (`ai/history.ts`) enforces.
- Untrusted text placed in prompts (answers, names, past posts) is wrapped in tags and stripped of characters that could close the tags or forge lines. System prompts (`ai/prompts.ts`) stay byte-stable for caching.
- Every call goes through `guard` and `callProvider` (`ai/assistant.ts`), which enforce the monthly budget and log usage and estimated cost to `ai_usage_events`.
- Drafting includes a summary of recent posts (6 months) and draft ideas (30 days) to avoid repetition.
- **Interviews** (`apps/api/src/interview/`):
  - AI use requires the session's `ai_consent`, which can be withdrawn but never added afterwards
  - drafted rules keep only quotes found verbatim (normalised) in the answers, and quotes are re-checked on save
  - results are saved only as knowledge proposals
- Automated tests never call the real API; they use the mock or a spy provider. Live checks are manual, small, and logged in `TEST_LOG.md`.

### Other pieces

- **Reminders:** `runReminderScan` (`packages/db/src/reminders.ts`) is idempotent through per-recipient dedupe keys. The worker schedules it every 15 minutes, and `GET /api/notifications` also triggers it in the background (at most every 10 minutes per restaurant). Notifications are in-app only.
- **Photos:** `MediaStore` (`apps/api/src/media/store.ts`).
  - The browser gets a one-time signed upload link for a fresh server-chosen path, then the server downloads the file, checks its real type and size, fingerprints it, and saves a new post version.
  - Viewing uses 5-minute signed links issued after a permission check.
  - Tests use an in-memory store.
- **Web:** `apps/web/src/auth.tsx` owns the Supabase client and `apiFetch`. Only an explicit allowlist of public values reaches the bundle (`vite.config.ts` `define`), and `check:bundle` verifies it.

### Testing

- `createTestDb()` (`@the-pocket/db/testing`) gives a fresh PGlite with all migrations applied.
- `createHarness()` (`apps/api/src/testing/harness.ts`) builds the real app with real ES256-signed tokens. `addUser(role)` and `addRestaurant()` are used for permission and tenant-isolation tests.
- Options for AI providers, media store, budget and rate limits are injected through `createHarness` options.

## Working rules for this project

- Commit locally per milestone on a feature branch. **Never push without the owner's explicit permission.**
- Never print or echo credentials. Verification scripts against the live database or Supabase print only counts and statuses. `.env.local` holds real secrets and is git-ignored.
- No new paid services, and no live AI spending beyond small approved checks.
- Don't modify Supabase auth users, invitations or the admin membership unless asked.
- The owner is a business student, not a developer. Explain steps in plain language and say which terminal or screen to use.
