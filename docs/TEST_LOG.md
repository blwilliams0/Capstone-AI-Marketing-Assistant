# Test Log

Real results from commands run on the developer's Windows machine (Node 24.15.0, npm 11.12.1). Sections 1 to 4 are the offline verification of 2026-11-08 (76 tests at that time). **Section 5 is the live Supabase verification of 2026-11-09**, after which the suite stands at 78 tests. No real browser, real AI services or real social accounts have been used.

## 1. Baseline: Qwen's committed code (commit 9267e45)

Inspected before any changes. Not run because it could not be: no dependencies had ever been installed, `apps/web/package.json` did not exist, `pnpm-lock.yaml` was an empty placeholder, and pnpm is not installed on this machine. Reading the code found these blocking defects:

- Template literals destroyed by PowerShell in `server.ts`, `logger.ts` and the web `api.ts`; `$$` delimiters destroyed in the SQL trigger function; `$schema` key empty in `turbo.json`.
- `routes.ts` imported itself; `server.ts` called `listen()` on import; the audit middleware used an action not in its type; `@types/express@5` with `express@4`.
- The web app imported `createApi` from React Query, which does not exist, and re-exported files that did not exist.
- Both "tests" were fake: `auth.test.ts` asserted `expect(true).toBe(true)`; `server.test.ts` imported a name that was never exported.
- Authentication treated every request as a mock user whose role came from an environment variable.

## 2. Clean-room verification of the repaired code

Procedure: deleted `node_modules` and all build output, then ran each command in order. Full output was captured to a log; key lines below.

| Command | Result |
|---|---|
| `npm ci` | exit 0. "added 344 packages, and audited 356 packages in 25s" |
| `npm run build` | exit 0. "Tasks: 5 successful, 5 total" (shared, db, api, worker, web) |
| `npm run typecheck` | exit 0. "Tasks: 7 successful, 7 total" (includes test files) |
| `npm run lint` | exit 0, no errors or warnings |
| `npm test` | exit 0. "Tasks: 6 successful, 6 total" |
| `npm run check:bundle` | exit 0. "OK: 3 bundle files checked, no server secrets or mock sign-in found." |

### Automated tests: 76 passed, 0 failed (at 2026-11-08; 78 after section 5 fixes)

| Package | File | Tests | What it proves |
|---|---|--:|---|
| shared | `roles.test.ts` | 5 | Permission matrix matches PRD section 2 (approver cannot approve brand rules; contributor cannot approve or publish; viewer read-only) |
| db | `migrations.test.ts` | 10 (now 12, see section 5) | Migration applies and is idempotent; RLS on every table; audit, permission and job history cannot be updated or deleted; role and status checks; one membership per user per restaurant; revoked memberships need a revoker; job idempotency keys; restrictive deletes |
| db | `jobs.test.ts` | 7 | Duplicate enqueue creates one job; a job is claimed by one worker only; only the lease holder can complete; retry with backoff then permanent failure; future jobs wait; crashed-worker jobs are re-claimed but never past max attempts |
| api | `auth.test.ts` | 13 | 401 for missing, malformed, expired, wrong-issuer, wrong-audience and wrong-key tokens; 403 for no membership and for revoked members; forged `user_metadata`/`app_metadata` role ignored; invited member activated on first sign-in; CORS restricted to the web origin; 404s leak nothing |
| api | `rbac.test.ts` | 4 | **Every registered route is tested against every role** and must return 403 exactly when the role lacks the permission; contributor/viewer/approver cannot invite or read the audit trail; a contributor cannot create an admin |
| api | `members.test.ts` | 13 | Invitation writes membership, permission event and audit event; input validation; duplicate refused; 503 when not configured; removal blocks the very next request; reason required; double removal refused; last administrator protected; another restaurant's members untouchable; audit output contains no secrets |
| api | `config.test.ts` | 11 | Mock auth refused in production, in unset `NODE_ENV` and in staging; allowed only in development and test; real auth is the default; missing Supabase settings refused; errors never echo secrets; mock tokens still hit the permission checks |
| api | `providers.test.ts` | 6 | Model routing (Plus vs Flash); AI output always a labelled draft; invalid input rejected; mock publisher requires approval digest and media checksum; audit redaction |
| worker | `worker.test.ts` | 7 | Idle when empty; no-op job completes; unknown job type fails immediately and is never retried; no publishing handler registered; inherited keys such as `toString` are not handlers; throwing handler retried and worker survives; two workers never run the same job |

### Runtime checks of the compiled API (plain `node apps/api/dist/index.js`)

| Check | Result |
|---|---|
| `NODE_ENV=production AUTH_MODE=mock` | Refused to start, exit 1 |
| `NODE_ENV` unset, `AUTH_MODE=mock` | Refused to start, exit 1 |
| Production without Supabase settings | Refused to start |
| Dev mock mode: `GET /health` | 200 |
| `GET /api/me`, no token | 401 |
| `GET /api/me` as mock contributor | 200 |
| `POST /api/admin/invitations` as mock contributor | 403 |
| `GET /api/audit-events` as mock viewer | 403 |
| `POST /api/social/publish`, `POST /api/qwen/chat` (formerly open endpoints) | 404 |
| `npm run dev` script loads root `.env.local` | Confirmed: only the missing `DATABASE_URL` was reported, so `SUPABASE_URL` was read |

### Web bundle secret scan

- Searched the production bundle for `SUPABASE_SECRET_KEY`, `DATABASE_URL`, `postgres://`, `service_role`, secret-key material and the mock sign-in: none found.
- One raw `sb_secret` string exists in the bundle. Inspected: it is supabase-js's own key-format check (`startsWith("sb_secret_")`), with no key material. `check-bundle.mjs` therefore looks for key *material* and server variable names, not the bare prefix.
- The scanner was proven to detect a deliberately injected fake key (FAIL), then pass again after removal.

### Credential sweep

- The real publishable key and project URL from `.env.local` were searched for (without printing them) in all project files except `.env.local` and build output: 0 matches.
- Key-shaped string scan: only fake test fixtures.
- `.env.local` is git-ignored and was never tracked. No real secrets were found in git history (the single prior commit contains placeholders only).

### Dependency audit (`npm audit`)

- Before: 14 vulnerabilities (2 critical, 2 high, 10 moderate), including 1 high in a production dependency (`zod`).
- Actions: `npm audit fix`, `zod` to 4.6.7, `vitest` to 5.1.
- After: 7 moderate, all in `typescript-eslint` (development lint tooling only). Zero in production dependencies.

## 3. Failures encountered while fixing (kept for honesty)

| What happened | Cause | Resolution |
|---|---|---|
| Migration tests failed: "extension pgcrypto is not available" | In-process Postgres lacks that extension | Removed the line; `gen_random_uuid()` is built into Postgres 13+ and Supabase |
| 3 job-queue tests failed | Test bug: an earlier test left a queued job that later tests claimed | Cancel leftover jobs before each test. Queue code unchanged |
| CORS test failed | Test bug: the `cors` package returns the configured origin for every request; browsers enforce the mismatch | Test now asserts the header is never `*` and never echoes the attacker's origin |
| `turbo` refused to run | Needs a `packageManager` field for npm workspaces | Added |
| Lint error in `check-bundle.mjs` | Ternary used as a statement | Rewritten as if/else |
| `db/migrations/README.md` could not be edited | Qwen wrote it as UTF-16 | Deleted and rewritten as UTF-8; scan found no other affected file |

## 4. Not tested as of 2026-11-08 (superseded by section 5 where noted)

- Sign-in, token verification and invitations against the real Supabase project. *Partly covered in section 5.*
- The migration on the real Supabase Postgres. *Done in section 5.*
- The web app visually in a browser, including the invitation and password flow. *Still open.*
- Concurrency under real network latency, load, or rate limiting. *Still open.*
- Backup and restore, deployment, monitoring (Stage 5). *Still open.*

## 5. Live Supabase verification (2026-11-09)

Target: the owner's development Supabase project (session-mode pooler, region `us-west-2`, PostgreSQL 17.11). Credentials were read from the git-ignored `.env.local` and never written to any file or log.

### 5.1 Environment

| Check | Result |
|---|---|
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `DATABASE_URL` | All four present |
| `DATABASE_URL` format | **Initially unparseable**: the value had been split across two lines in `.env.local` (a line break between the password and `@host`). Joined into one line; it then parsed (`postgresql://`, pooler host, port 5432, database `postgres`) |

### 5.2 Pre-migration inspection (read-only)

Connected successfully. PostgreSQL 17.11, role `postgres`. **No tables in `public`, no `schema_migrations`, 0 auth users, no name collisions with the migration**, `gen_random_uuid()` available, Supabase roles `anon`, `authenticated`, `service_role` present. The database was empty, so migration 001 was safe to apply.

### 5.3 Migration

`npm run db:migrate` printed `Applied: 001_foundation.sql`.

### 5.4 Post-migration verification found two real security gaps

| Gap | Cause | Why offline tests missed it |
|---|---|---|
| `schema_migrations` had row-level security **off**, and `anon` and `authenticated` held ALL privileges on it | The migration runner creates this table itself, and Supabase grants broad rights on new public tables by default. Anyone holding the public publishable key could have read, changed or truncated migration history through the Data API | The test excluded this table, and the in-process test database had no Supabase-style default grants |
| `forbid_change()` executable by `anon` and `authenticated` | Supabase's default function privileges | Same reason. Low impact (a trigger function cannot do anything when called directly), but needless exposure |

Fixes: the runner now locks down its own table on every run; new migration `002_harden_functions.sql` revokes the function privileges (001 was left untouched since it had already been applied); the test database now reproduces Supabase's default grants; tests were added that assert no `anon` or `authenticated` access to any table and no public execute on the function. Proof the tests are real guards: with 002 temporarily removed, "does not let public roles execute the trigger function directly" **failed**; restored, all pass. `npm run db:migrate` then printed `Applied: 002_harden_functions.sql`.

### 5.5 Final live database state

| Check | Result |
|---|---|
| Migration history | `001_foundation.sql`, `002_harden_functions.sql` |
| Row-level security | **On for all 8 tables** (7 application tables + `schema_migrations`) |
| RLS policies | None (deny-all for public roles, by design) |
| Table privileges held by `anon` / `authenticated` | None |
| `anon`/`authenticated` SELECT or INSERT on memberships, audit_events, jobs | All `false` |
| Foreign keys | All RESTRICT; **0 CASCADE** delete rules |
| `forbid_change()` executable by `anon` / `authenticated` | `false` / `false` |
| Append-only: `UPDATE audit_events` | **Blocked**: "audit_events is append-only: UPDATE is not allowed" |
| Append-only: `DELETE audit_events` | **Blocked** |
| Rollback test left behind rows | 0 |
| Row counts (all 7 application tables) | 0 (database ready for bootstrap) |

### 5.6 Supabase Auth checks (read-only; nothing created or emailed)

| Check | Result |
|---|---|
| JWKS endpoint | HTTP 200, 1 key: `EC`, `ES256`, `P-256`, `use=sig`. **Asymmetric signing confirmed**, which the API's verifier supports. This closes the open risk from the Stage 1 report |
| Secret key accepted by the Auth admin API | HTTP 200 (read-only user list, 0 users) |
| Publishable key accepted | HTTP 200 |
| Email provider enabled | true |
| Email confirmation required (`mailer_autoconfirm`) | false = confirmation required (good) |
| **Public sign-ups** (`disable_signup`) | **false: anyone can self-register an identity.** Not a privilege escalation (a stranger has no membership, so the API answers 403), but this app is invite-only. *Recommend turning "Allow new users to sign up" off in the Supabase dashboard (owner action).* |

### 5.7 Compiled API in real Supabase mode (live signing keys, live database)

Started `node apps/api/dist/index.js` with the real `.env.local`; startup log reported `authMode: supabase`. Server log contained 0 errors.

| Request | Status |
|---|---|
| `GET /health` | 200 |
| `GET /api/me`, no token | 401 |
| `GET /api/me`, garbage token | 401 |
| `GET /api/me`, `Bearer mock:admin` (mock tokens must not work live) | 401 |
| `GET /api/me`, token forged with a throwaway key but the project's real key id, issuer and an admin claim | 401 |
| `GET /api/admin/members`, same forged admin token | 401 |

### 5.8 Full suite after the fixes

`npm run build` (5/5), `typecheck` (7/7), `lint` (clean), `npm test` (**78 passed**: shared 5, db 19, api 47, worker 7), `check:bundle` OK. All exit 0.

### 5.9 Incident note

While checking `DATABASE_URL`, a redaction command failed to match the connection string and printed the line, **including the database password, into the working session's output**. It was not written to any file. Because it exists in that transcript, rotating the database password is recommended (Supabase dashboard, Project Settings, Database, Reset database password; then update `.env.local`). The `.env.local` fix and the verification scripts used afterwards print no credentials.

### 5.10 Still not verified live

- A **real signed-in user**: bootstrap invitation email, setting a password, sign-in through the browser, and `GET /api/me` with a genuine Supabase token returning the administrator role. This needs the owner's email address and inbox, so it is the owner's step (see the checklist in `STAGE1_REMEDIATION_REPORT.md`).
- Invitation of a second user, and revocation, against the live project.
- The web app visually in a browser.

## 6. Overnight coding run (2026-11-13): M0, M1, M2

All results below are from commands run during the run. No live AI calls were made; the AI parts were tested with the mock provider and a fake Anthropic client.

### 6.1 Automated tests

| Package | Tests | Notes |
|---|--:|---|
| shared | 7 | Permission matrix incl. new `knowledge.propose` and `assistant.use` |
| db | 32 | +12 knowledge-schema tests (digest computed by DB, no pre-approved inserts, approved text immutable, status transitions, one approved version per item, no deletes, one-way retirement, brand-core kinds, same-restaurant versions, full-text search, append-only sections); public roles have no access to any table, function or **sequence** |
| api | 88 | +4 rate limiting, +19 knowledge (approval authority, self-approval confirmation, supersede, expiry, retire, brand-core cap, search returns approved only, restaurant boundary), +4 section splitting/query building, +22 AI (request shape against a fake Claude client: model, US inference, fallbacks, document blocks with citations, cache breakpoint; citation mapping; refusals; structured drafts; prompts; draft source checking; cost estimate; ask/draft/usage API; no provider → 503; budget reached → 503 recorded; provider failure → 502 recorded; AI rate limit) |
| worker | 7 | unchanged |
| **Total** | **134** | `npm test` (packages run one at a time) |

Build (5/5), strict typecheck including tests (7/7), lint and `check:bundle` all passed.

### 6.2 Problems found and fixed during the run

| Problem | Fix |
|---|---|
| Stale React state would have sent a user back to the set-password screen after saving a password | Switched to a ref |
| Conversation messages written in one transaction shared a timestamp, so an answer could appear before its question | Added an insertion-order `seq` column (migration 004, before it was applied) |
| The new identity column created a sequence that Supabase's defaults would expose to public roles | Migration 004 revokes sequence privileges; test added; test database now reproduces Supabase's default sequence grants |
| Windows test worker crashes (exit code 0xC0000409) when too many in-process Postgres instances ran at once | API/db tests limited to 2 workers; packages tested one at a time |
| A first draft of the AI rate-limit test asserted nothing | Replaced with a real test (second request within the window returns 429) |

### 6.3 Live dev database

| Step | Result |
|---|---|
| `npm run db:migrate` | `Applied: 003_knowledge.sql`, later `Applied: 004_ai_usage_and_conversations.sql` |
| Security check (read-only plus rollback-only trigger tests) | 14 tables, RLS on all 14; no RLS policies; anon/authenticated: no table, function or sequence privileges; 0 CASCADE rules; digest computed by DB; pre-approved insert blocked; editing approved text blocked; 0 leftover rows. **"RESULT: OK, no problems found"** |
| `load-knowledge` (strategy) | "Loaded "Marketing strategy (capstone team draft)" as a proposal (10,991 characters)"; 21 searchable sections |
| `load-knowledge` (research notes) | Loaded as a proposal (3,063 characters); 7 sections |
| Re-running the loader | "Already loaded … Nothing changed." |
| Admin membership | Unchanged (`admin / invited`); no auth users, invites or memberships touched |

The two documents were proposed under the first administrator's profile by the setup script; the audit trail records `knowledge.loaded_by_script` so it is clear no one clicked in the app.

### 6.4 Compiled API with the real `.env.local`

Started with no `ANTHROPIC_API_KEY` and no `NODE_ENV`: startup log `aiMode: disabled` (fails closed, not mock). `POST /api/assistant/ask` without a token → 401; `mock:admin` token → 401. 0 errors logged.

### 6.5 Not tested

- Any live Claude request (no API key yet). The exact request shape is unit-tested against the installed SDK's types and a fake client only.
- The new screens (sign-in recovery, staff, knowledge, ask, create a post) in a browser.
- Real sign-in end to end.

## 7. First live Claude check (2026-11-18)

Owner added an Anthropic Console API key to `.env.local` (not shown to or by Claude Code). API restarted with `"aiMode":"claude"`.

Run with `npm run ai-live-check -w @the-pocket/api` (new script: one real question as the first active admin, through the same `ask()` code the app uses; prints the answer, sources and usage, never keys).

| # | Question | Input tok | Output tok | Cache read | Cache write | Est. cost |
|---|---|---|---|---|---|---|
| 1 | "What tone should our Instagram captions use, and what should we avoid?" | 2,627 | 960 | 0 | 2,138 | $0.0404 |
| 2 | "x" (sent by mistake while checking the log; the script now rejects questions under 3 characters) | 6 | 780 | 2,138 | 0 | $0.0161 |

Results:
- Model `claude-opus-5-5`, outcome `ok`, not refused. Answer used the 3 approved brand rules (brand core) plus 8 strategy/reference sections chosen by full-text search.
- Citations mapped back to approved knowledge versions, with quotes. Answer kept brand rules apart from research ideas and listed what management still needs to confirm.
- Prompt caching confirmed: call 2 read the 2,138-token brand core from cache.
- Usage events recorded in `ai_usage_events`; 2 conversations stored under the admin account.
- Total spend so far: about $0.056.

## 8. M3: approve and post (2026-11-18)

**Automated:** 185 tests passing (shared 7, db 57, api 114, worker 7). Build, strict typecheck, lint and bundle secret scan clean.
- New database tests (`packages/db/src/content.test.ts`, 25):
  - digest computed by the database (supplied values ignored); versions immutable
  - approval copies the digest; only the latest version can be submitted or approved
  - only active approvers or admins decide; self-approval (requester, creator or any version's author) is admin-only and must be flagged exactly
  - an edit supersedes waiting or approved requests, with the history recorded
  - posting only from an approved request; posted posts are locked
  - changed, retired or expired cited knowledge blocks approval and posting in the database
  - viewers and former staff can't write; history is append-only; archiving is one-way
- New API tests (`content.test.ts`, `ai-history.test.ts`):
  - the full journey, the role rules, self-approval laundering, and the fingerprint mismatch check
  - sources must be current; edits refresh sources and record removed ones; archive permissions; tenant isolation
  - recent-post history in the draft prompt (opening line only; cannot escape its tag); document keys removed from output

**Independent review:** a Fable-model security review of the M3 diff found no critical or high-severity issues. All nine of its findings were fixed before applying:
- knowledge-freshness checks moved into the database
- removed sources are recorded and shown to the approver
- "self" now includes every author of a post
- archiving is limited to the creator or a reviewer, and the database refuses to archive a posted item
- neutral wording for "superseded" in the history
- no keys in warnings, and keys are deleted (not replaced) in captions
- stricter cleaning of history lines
- item-row locks to order concurrent actions
- `search_path` pinned on the new functions, and active-member checks for writers and submitters

**Live dev database:** migration 005 applied.
- 20 tables, all with RLS.
- 0 public-role grants on tables, 0 executable functions, 0 sequence access (counts only).

**Live Claude drafts** (same request twice: locals, Instagram, "Bring locals back on weeknights", "Wine on the covered patio"):

| # | Input | Output | Cache read | Cache write | Est. cost | Result |
|---|---|---|---|---|---|---|
| 1 | 2,615 | 3,005 | 0 | 2,189 | $0.0815 | 3 distinct angles, no document keys, no warnings, 36 s |
| 2 | 2,851 | 3,039 | 2,189 | 0 | $0.0726 | All three openings new; one option flagged its overlap with draft 1's idea and explained the difference |

Drafts cost more than questions (about 3,000 output tokens), so about 7–8 cents each. Total live spend to date: about $0.21.

## 9. M4a: brand interview in the app (2026-11-18)

**Automated:** 194 tests passing (shared 7, db 57, api 123, worker 7). Build, strict typecheck, lint and bundle scan clean.

`interview.test.ts` (9 tests) covers:
- notes consent is required, and viewers can't run interviews
- guide questions keep the guide's wording, and answers are append-only (latest wins)
- completed interviews are locked
- without AI consent nothing is sent to the AI, guide follow-ups are used instead, and consent cannot be added afterwards
- AI follow-ups take the next free ID; withdrawing consent stops AI use
- drafted rules keep only quotes found word for word in the answers, and unsupported suggestions are dropped
- other managers' answers are given for spotting disagreements
- saved suggestions are knowledge **proposals** with a source note built from the verified quotes, saved once only, and approvable only by an administrator
- tenant isolation

**Known flake:** `interview.test.ts` crashed twice with the Windows PGlite worker error (0xC0000409), then passed alone and in two full runs. This is the same platform issue as before (see Known limitations), not a test failure.

**Live dev database:** migration 006 applied. 24 tables, all with RLS. 0 public-role grants on tables, 0 executable functions, 0 sequence access.

**Live AI:** not run. A live test would create a permanent interview record in the real database, so the first real use is the owner's interview with management. Expected costs: a follow-up suggestion is about 1 cent (low effort); drafting rules from a full interview is roughly 15–30 cents (high effort, long input). Not yet measured.

## 10. M4b: calendar and reminders (2026-11-18)

**Automated:** 205 tests passing (shared 7, db 62, api 127, worker 9).

`reminders.test.ts` (db) checks:
- the right reminders go to the right people:
  - post due → staff who can post
  - post overdue → staff who can post
  - not submitted → whoever started the post
  - waiting for approval → reviewers other than the requester
  - fact expiring or expired → administrators
  - viewers get none
- Carmel local time in the wording
- running the scan again creates nothing
- only "read" can change, and only once; nothing can be deleted
- links must be in-app paths

`worker.test.ts`: one scan per restaurant per 15 minutes however often it is scheduled; the handler table is only `reminders.scan` and `system.noop` (still no publishing handler).

`calendar.test.ts`: scheduled posts in range, posts without a date, fact expiry dates, range validation, reminders per person, marking read (only your own).

**Live dev database:** migration 007 applied. 25 tables, all with RLS, and 0 public access. One live reminder scan ran cleanly and created 0 reminders (nothing scheduled yet).

**No AI calls and no paid services:** reminders are in-app only.

## 11. M4 security review fixes (2026-11-18)

A Fable-model review of the M4 diff found no critical or high-severity issues. All findings were fixed:
- Saving an interview suggestion re-checks its quotes against the latest answers (409 `quotes_changed`) and is refused once AI consent is withdrawn (409 `no_consent`), since saved rules and quotes later reach the AI as brand knowledge. The confirmation text now says exactly what withdrawing does.
- Follow-up question text and names are flattened to one line with no tags or quotes before going into prompts, so they cannot forge another manager's answers.
- Quotes must be at least 3 words or 12 characters; at most 5 per suggestion; the source note keeps whole quotes only.
- Disagreements are labelled as the assistant's summary, not checked word for word.
- A saved suggestion shows the wording actually saved, and the audit records whether it was edited first.
- The calendar uses a date-filtered query, so older scheduled posts can't drop off.
- Reminder scans run in the background of `GET /notifications`.
- Overdue reminders cover the last 14 days only, so there is no backlog on first scan or for new staff.
- Migration 008: interview triggers lock the session row (`FOR SHARE`); reminder links must be `/name/...` (no `//host`). Consent withdrawn while the AI is working stores nothing.

**Accepted, documented:**
- Two browser tabs suggesting a follow-up to the same question at the same moment can get the same follow-up ID; the later answer wins (both are kept in history).
- Notifications and job history are append-only and grow (about 96 small scan jobs a day). A retention or cleanup step is planned with deployment (M6).

**Results:** 208 tests passing (shared 7, db 62, api 130, worker 9). Live dev database: migration 008 applied; 25 tables with RLS; 0 public access.

## 12. M4c: photo upload (2026-11-18)

**Setup:** private Supabase Storage bucket `post-media` created with the owner's approval (`npm run create-media-bucket -w @the-pocket/api`; safe to re-run). Settings: public off, 10 MB limit, JPEG/PNG/WebP only.

**Automated:** 214 tests passing (shared 7, db 62, api 136, worker 9). `media.test.ts` uses an in-memory store and checks:
- upload links go to a fresh path inside this restaurant and post; viewers cannot upload; other tenants get 404
- the server checks the file's real type from its first bytes, enforces the size limit, refuses paths from other posts and `../`, and fingerprints the file
- the photo is saved as a new version whose digest changes, so an approved post needs approval again
- view links are short-lived (300 s) and tenant-scoped; removal works; posted posts are locked; with no storage configured the routes answer 503

**Live check** (one test file, deleted afterwards):
- upload with a one-time link: OK; server download matches
- reusing the link to overwrite: **refused**
- anonymous download: **refused**; anonymous listing sees 0 files; public URL: **400**
- signed view link: 200

## 13. Photo review and project-wide bug hunt fixes (2026-11-21)

Two Fable-model reviews (photo upload security; whole-project bug hunt plus plan risks). Neither found a critical issue or a blocker on the scripted demo path. Fixed:

**Photos**
- The stored photo's fingerprint is re-checked before approval and before "I posted it" (409 `photo_changed`).
- Rejected uploads are deleted; size is checked before reading a file into memory.
- Upload routes have their own limit (60 per person per 10 minutes).
- "Remove photo" with no photo does nothing instead of cancelling an approval.
- The bucket is confirmed private at every API start.
- Real download links; image links refresh after expiry; clearer "version fingerprint" and "photo file ID" labels.

**Demo-relevant**
- A dropped database connection no longer crashes the API (pool error handler, connect timeout).
- The screen's "your own post" rule now matches the server (creator, any version's author, or requester).
- A passing server problem (429, 500, network) no longer signs people out; only a 401 does.
- Network failures show a message instead of leaving buttons stuck on "Saving…".
- "Save as a post" caps the title (200) and angle; up to 50 sources; optional post name such as "DEMO – …".
- Interview notes typed while a save is in flight are no longer overwritten.
- Knowledge: full text can be expanded before approving; "Propose a change" keeps the source and can set a new expiry; the edit box starts from the current version.
- Post History shows saves and approval events in time order; the reminder badge updates as soon as reminders are read; guide follow-ups no longer repeat.
- Interview rule drafting: 16,000-token output limit, 5-minute timeout with one retry, and a clear message if the answer is cut off.

**Data hygiene and integrity**
- Posts titled "DEMO…" are kept but never sent to the AI as recent history; interviews named "PRACTICE…" are left out of the comparison between managers.
- Migration 009: the database itself refuses knowledge approval or rejection by anyone but an active administrator; two indexes on approval requests.

**Results:** 216 tests passing (shared 7, db 63, api 137, worker 9). Live: migration 009 applied; 25 tables with RLS; 0 public access.

**Deferred (recorded in STATUS):** `trust proxy`, and moving rate limits into the database (deployment, M6); long AI calls as background jobs if the host cuts requests short; admin view of staff chats needs a notice and consent design first; KPI "cost unknown" for failed AI calls (M5); paging instead of the 200 and 300 caps (M5); one shared restaurant time zone; Supabase free-tier pausing and backups (Dec 1 gate); growth of job and notification history; a migration lock for multiple instances; web UI tests (M6 Playwright).

## 14. Interview transcripts, names and practice flag (2026-11-21)

**Owner request:** upload a transcript and have the AI fill in the interview answers; name interviews.

- Migration 010:
  - an interview name (`label`) and an `is_practice` flag; both can be changed, other details stay fixed
  - append-only `interview_transcripts` (up to 150,000 characters; the database computes a SHA-256)
  - answers record `source` (`typed` or `transcript`) and link to the transcript they came from
- Filling from a transcript:
  - needs AI consent
  - the AI may only copy the interviewee's words: every excerpt must appear word for word in the transcript or it is dropped
  - typed answers are kept unless the person ticks "replace"
  - the result lists filled, kept and not-covered questions, and how the AI identified the speaker
- Practice interviews are excluded from the comparison between managers by the flag (no longer by name).
- The upload route accepts up to 700 KB; every other request stays at 100 KB.

**Automated:** 220 tests passing (shared 7, db 63, api 141, worker 9). New interview tests cover:
- naming and marking practice; practice answers never reach another interview's prompt
- verbatim-only filling, including an invented line being dropped
- typed answers kept by default and replaced only when asked
- a 120,000-character upload; no AI call without consent
- transcripts are append-only and cannot be used by another interview

`interview.test.ts` hit the Windows PGlite crash once and then passed twice in a row.

**Live:** migration 010 applied; 26 tables with RLS; 0 public access. `npm audit --omit=dev`: 0 vulnerabilities.

**Not yet measured live:** cost of filling from a transcript. Estimate about 30–60 cents for a one-hour interview (about 25,000 input tokens plus the excerpts).
