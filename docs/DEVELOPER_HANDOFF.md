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

- **Option A, your own free Supabase project (recommended for experiments).** Create a free project, put its values in `.env.local`, then run `npm run db:migrate` and `npm run bootstrap-admin -w @the-pocket/api` to make yourself admin. Your data is separate, so nothing you try can break the shared database.
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
