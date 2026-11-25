# Developer handoff

Welcome. This page is for a teammate who will write code on The Pocket AI Marketing Assistant. Read it once before your first change. It takes about 15 minutes.

## 1. What the app is

A browser app for one restaurant, The Pocket in Carmel-by-the-Sea. It is a CSUMB capstone project for a real client.

- Management controls the brand. They approve the facts, rules and strategy the AI may use.
- Staff ask the AI assistant questions and have it draft posts.
- Nothing is published without a recorded human approval of the **exact** version, and a person always does the final post by hand. The app never posts to social media itself.

The full specification is `The_Pocket_AI_Marketing_Assistant_PRD_v0_4.md` and `The_Pocket_AI_Architecture_Addendum_v0_4.md` (the v0.3 files are history). The current state is in `docs/STATUS.md`.

**Dates:** finished product about Dec 10, Capstone Festival Dec 17.

## 2. Where things stand

Done and working (milestones M0 to M4):

- Sign-in, staff roles and invitations
- Knowledge library with approval (brand rules, facts, strategy, reference)
- AI assistant (Claude) that answers with sources, and post drafting
- Approval of exact post versions, self-approval rules, assisted posting with a record
- Brand interview (typed answers or an uploaded transcript) that produces proposed brand rules
- Marketing calendar, in-app reminders, photos on posts, home screen

Still to build:

- **M5, measurement and export (early December):** activity numbers from app data (posts approved, time to approve, edits, rejections), manual KPI entry where "unknown" is not shown as zero, export of the approved brand reference and an activity report.
- **M6, hardening and handoff (by Dec 10):** security review, an end-to-end browser test, deployment, and guides for staff and admins.

Talk to Blake before starting work, so two people don't build the same thing.

## 3. Rules that must never break

These are the core of the project. A change that weakens any of them is a bug, even if it looks convenient.

1. **Deny by default.** Every API route is added through `PolicyRouter` (`apps/api/src/policy.ts`) and needs a capability or `'member'`. Roles come from the `memberships` table, never from the sign-in token.
2. **The server enforces everything.** The web app hides buttons only for convenience.
3. **Integrity lives in the database.** Rules are checked twice: in the API for friendly errors, and by Postgres triggers as the real guarantee. History tables are append-only.
4. **Never edit a migration that has been applied.** Migrations 001 to 010 are live. Add a new numbered file in `db/migrations/` instead.
5. **Every new migration must:**
   - enable row-level security (RLS) on its tables
   - revoke table, function **and** sequence access from `anon` and `authenticated`, plus `REVOKE EXECUTE ON ALL FUNCTIONS ... FROM PUBLIC`
   - set `search_path = public, pg_temp` on new functions

   `migrations.test.ts` fails if you forget.
6. **The AI never acts.** It has no tools. It cannot approve, publish, invite or change permissions. Text from users that goes into prompts is treated as data.
7. **Secrets stay on the server.** Never commit `.env.local`, never print keys, never add a server secret to the web bundle. `npm run check:bundle` checks the bundle.
8. **No new paid services, and no live AI spending** without Blake's OK. Automated tests never call the real AI.

## 4. Setting up your laptop

You need Node 24 or newer and Git.

```bash
git clone https://github.com/blwilliams0/Capstone-AI-Marketing-Assistant.git
cd Capstone-AI-Marketing-Assistant
npm install
npm run build
npm test
```

**The tests need no setup.** They use an in-process Postgres (PGlite) and a mock AI, so you can work on most features with tests alone.

**Running the app in a browser needs a database and Supabase sign-in.** Copy `.env.example` to `.env.local` and fill it in. Choose one option with Blake:

- **Option A, your own free Supabase project (recommended for experiments).** Create a free project, put its values in `.env.local`, then run `npm run db:migrate` and `npm run bootstrap-admin -- --email you@example.com --name "Your Name"` to make yourself admin (it emails you an invitation). Your data is separate, so nothing you try can break the shared database.
- **Option B, the team's dev project.** Blake adds you to the Supabase project, and you copy the keys from the dashboard yourself. Never send keys by chat, email or GitHub. The dev project holds real client information, so be careful with it.

Leave `ANTHROPIC_API_KEY` empty. The app then uses a labelled mock AI at no cost.

Then run, each in its own terminal:

```bash
npm run dev:api    # API on http://localhost:3000 (restart it after changing .env.local)
npm run dev:web    # web app on http://localhost:5173
```

## 5. Map of the code

```
apps/api         Express 5 REST API: all business rules
apps/web         React 19 + Vite + Tailwind v4 + React Router 7
apps/worker      background jobs (reminder scans; deliberately no publishing)
packages/shared  roles and capabilities, zod schemas, types shared by API and web
packages/db      database interface, migration runner, job queue, reminder scan
db/migrations    numbered SQL migrations
docs/            status, test log, API list, decisions, demo script
```

Useful starting points:

- `packages/shared/src/roles.ts`: the single list of roles and what each may do
- `apps/api/src/routes.ts`: where routes are registered
- `apps/api/src/ai/`: Claude provider, prompts, context building, budget guard
- `apps/api/src/testing/harness.ts`: builds the real app for tests, with real signed tokens
- `apps/web/src/auth.tsx`: sign-in and `apiFetch`

`CLAUDE.md` at the top of the repo has more detail. If you use Claude Code, it reads that file automatically.

## 6. How to add a feature

1. **Branch:** `git checkout main && git pull && git checkout -b your-feature-name`.
2. **New permission?** Add the capability in `packages/shared/src/roles.ts`, a label in `apps/web/src/pages/Home.tsx` (`CAPABILITY_LABELS`) and a row in `docs/API.md`.
3. **New table?** Add a new migration file (see rule 5) and a test.
4. **New route:** register it through `PolicyRouter`. Validate params and body with zod **before** any side effect. `rbac.test.ts` calls every route as every role with an empty body and bad IDs, and expects no crashes and no leaks.
5. **Business event?** Record it with `recordAudit`, passing the transaction handle so it is saved with the change.
6. **Tests:** cover the happy path, the permission refusals, and other restaurants not seeing the data (`addUser(role)`, `addRestaurant()` in the harness).
7. **Before you push**, all must pass:

   ```bash
   npm run build
   npm run typecheck
   npm run lint
   npm test
   npm run check:bundle
   ```

8. **Push your branch and open a pull request.** Blake reviews and merges. Never push to `main` directly.
9. Update `docs/STATUS.md`, and `docs/API.md` for new routes.

After changing `packages/shared` or `packages/db`, rebuild them (`npm run build -w @the-pocket/shared` or `-w @the-pocket/db`). The apps use their built copies, so a stale build shows up as "missing export" errors.

Run one test file from inside its package:

```bash
cd apps/api && npx vitest run src/content.test.ts -t "self-approval"
```

## 7. Windows notes

- More than 2 test workers, or packages tested in parallel, can crash PGlite with exit code `0xC0000409`. The settings already limit this. If it still happens, run the tests again before assuming a bug.
- Shell one-liners can mangle text that contains `$`, backticks or backslashes. Edit such files in your editor.

## 8. Private files that are not on GitHub

Some files stay only on Blake's laptop and in the app's database, because they contain the client's interview and business details:

- `.env.local` (keys and passwords)
- `docs/research/` (Carmel and Monterey context, the marketing playbook, public web research)
- `docs/strategy/CLIENT_FACTS_FROM_TEAM_ANALYSES.md`

If you need them for your work, ask Blake. Don't commit client details to the repo.

## 9. Who decides what

- **Blake:** project lead. Reviews and merges pull requests, approves spending and anything touching keys, live servers or the client's data.
- **Management (Mike, Elliot):** approve brand rules, facts and strategy inside the app.
- **Marketing team:** owns the strategy documents in `docs/strategy/`.

When you are unsure whether a change is allowed, ask before you build it.

## Phase 3 practice and integration handoff

- The existing launcher uses a loopback-only PostgreSQL cluster, applies pending migrations, and uses cached API builds. Keep local practice data by reusing the checkout and its ignored preview directory. [Practice preview](STUDIO_PREVIEW.md)
- Confirm migration numbering with the team before integration. Phase 3 added 015 after the feature branch's migrations 012–014. The restaurant insert trigger and backfill run under the app database owner. Use a production-like staging role and test invitation, restaurant initialization, album archive, revocation through each media endpoint, and backup and restore in M6.
- Personal preferences remain account scoped. Disabling personalization excludes saved preferences from prompts and clearing deletes the active record. Conversations, reviews and feedback have their own storage and existing retention behavior. Define deletion, audit retention, photo retention, and access after staff departure before live rollout.
- Test provider timeouts, interrupted clients and concurrent spend. The UI can cancel waiting for a reply. The server may still finish, charge usage, and save it in history. The current estimated monthly guard does not reserve spend across concurrent requests. Failed requests may have unknown provider costs. Review distributed rate limiting, Pacific-time reporting boundaries, bounded lists, image size limits and queue/retry behavior before deployment.
- For M5, reuse the approval, content-version and audit data model for counts, revisions, rejections and turnaround. Confirm analytics ownership and the manual KPI schema before adding storage or endpoints. Use verified outcomes only and carry their provenance and missing-value status into any future Advisor context.

### Future read-only Instagram integration

The application currently supports manual feed planning and manually recorded publications. There is no OAuth route, token store, sync worker, or active Meta configuration. Use the following plan once authorization is available.

1. Obtain approval from the restaurant account manager and confirm the account is a supported Business or Creator profile. Select Meta's official Instagram API login product for that account. Verify the current version, read scopes, app review and account eligibility before registering anything.
2. Configure an authorized Meta app with the application's exact deployed HTTPS callback and approved privacy policy and data-deletion instructions. Use the read-only basic access scope supported by the chosen product. For Instagram Login this starts with `instagram_business_basic`. Verify the current contract in Meta documentation before implementation. Request publication, messaging and moderation scopes only if separately required and authorized by a future feature.
3. Implement management-only OAuth initiation with expiring one-time state tied to the session, tenant and account. Exchange and refresh tokens server-side. Keep encrypted tokens and secrets outside browser data and logs. Define access revocation, expiry handling and local deletion on disconnect.
4. Add a read-only adapter that returns normalized media ID, type, timestamp and eligible cover previews. Test pagination, expired URLs, box sizes and layouts, expired authorization, throttling, retries and atomic last-success state with a fake client before live authorization. Keep the canonical list separate from hypothetical layouts and manually recorded posts. Recent media ordered by timestamp may differ from the public profile because of pinned posts, archived items, carousel cover selection and Reel covers.
5. After review, authorize with the restaurant manager in staging, verify one read-only refresh and disconnect, and confirm retention and rate-limit behavior before production enablement. [Meta Instagram platform documentation](https://developers.facebook.com/docs/instagram-platform/)

## Phase 3.5 integration checkpoint

- Coordinate migrations 016–018 against team branches before eventual integration. The working feature branch remains separate from M5 measurement and M6 hardening. New document and feed query paths are owner- and tenant-scoped. RLS and privilege-revocation checks cover the migration set.
- Document extraction supports UTF-8 plain text and CSV line excerpts. No archives, document macros, formulas or embedded links execute. Build bounded sandboxed parsers for PDF, OOXML and OCR, and a safe retention job for inactive conversation records.
- The mock Instagram connector and paginated read adapter use a bounded normalized contract. The Meta reader has a fixed Graph host, a versioned account path, capped responses, no redirects and cursor-based continuation. It requests only ID, type and timestamp. Wire it to a management-owned authorization flow and separate storage once those pieces are implemented. Add one-time tenant/session OAuth state, encrypted token storage, renewal, revocation, privacy and retention controls, and safe cover retrieval before authorizing a live account.
- Meta describes Instagram Login and the basic permission for its API. The media reference distinguishes images, carousels and video and provides thumbnail URLs for video where available. Confirm account eligibility, current review requirements and token lifecycle in the approved app before enabling any live access. [Meta Instagram API changelog](https://developers.facebook.com/docs/instagram/platform/instagram-api/changelog/) [Meta media reference](https://developers.facebook.com/docs/instagram-platform/reference/instagram-media/v21.0/)
- Evaluation reserves a persistent call slot even if the upstream request fails. The application's estimated monthly USD threshold is advisory because in-flight or failed requests can still be billed. Set an approved provider-side project/workspace limit if offered and keep a small call cap. Check credentials, provider mode, documented output caps, and timeouts before a live run.
- M5 remains responsible for approval counts, turnaround, revisions, rejections, manual KPIs, approved reference and activity exports, and distinguishing unknown from zero. M6 includes end-to-end browser verification, retention, secure external connections, deployment, backup and restore, user guides and operational handoff.
