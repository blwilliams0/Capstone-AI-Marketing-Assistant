# The Pocket AI Marketing Assistant

A browser-based AI marketing assistant for The Pocket, an upscale restaurant in Carmel-by-the-Sea. Management controls the brand; the assistant helps staff carry out the approved strategy; nothing goes public without an exact, recorded approval, and a person always does the final post. This is a CSUMB Strategic Management capstone project built for a real client.

**Status (Nov 2026):** milestones M0 to M4 are built and tested; the prototype demo is Nov 23 and the finished product is planned for about Dec 10. See [docs/STATUS.md](docs/STATUS.md) for what works, what has been verified live, and what is next.

## What it does

- **Sign-in and staff access:** four roles (administrator, approver, contributor, viewer), enforced by the server on every request. Invitations, password reset and access removal.
- **Knowledge library:** brand rules, verified facts, the marketing strategy and research. Every change is a proposal until an administrator approves the exact wording; facts can expire.
- **Ask the assistant:** answers grounded in approved knowledge, with clickable sources (Claude, via the Anthropic API).
- **Create a post:** on-brand caption options for locals or visitors, with a photo plan, what to confirm, risks, timing and how to measure. Drafts avoid repeating recent posts.
- **Approve and post:**
  - approval covers one exact version (text, date and photo), so any edit needs approval again
  - only administrators may approve their own work, with a confirmation
  - Ready to post gives the exact approved text and photo; staff post by hand and record it
- **Brand interview:**
  - management's answers to the 30-question guide, with consent recorded
  - AI follow-up questions, and suggested brand rules backed by word-for-word quotes
  - disagreements between managers are flagged, never resolved by the AI
- **Calendar and reminders:** scheduled posts, fact expiry dates, and in-app reminders (time to post, overdue, waiting for approval, fact expiring).
- **Activity history:** who submitted, approved and posted what, and when. It cannot be edited or deleted.

The AI never approves, publishes, invites, changes permissions or spends money, and it has no tools.

## Layout

```text
apps/api/        Express REST API (all business rules)
apps/web/        React + Vite + Tailwind browser app
apps/worker/     Background job worker (reminders; it never publishes)
packages/shared/ Roles, permissions and types shared by all apps
packages/db/     Database access, migrations runner, job queue, reminder scan
db/migrations/   SQL migrations (row-level security and integrity triggers)
scripts/         Maintenance scripts (bundle secret check)
docs/            Documentation
```

## Requirements

- Node.js 24 or newer, with npm.
- For real use, a Supabase project (sign-in, Postgres database, private photo storage) and an Anthropic Console API key. A Claude Pro subscription cannot be used for the app.

## Quick start (offline)

```bash
npm install
npm run build
npm test      # 214 tests; in-process Postgres, no internet or accounts needed
```

## Run locally

1. Copy `.env.example` to `.env.local` and fill in the Supabase values, `DATABASE_URL`, and optionally `ANTHROPIC_API_KEY`. Set `NODE_ENV=development`.
2. First time only:
   ```bash
   npm run db:migrate
   npm run bootstrap-admin -- --email you@example.com --name "Your Name"
   npm run create-media-bucket -w @the-pocket/api
   ```
3. Start the servers in two terminals (a third, `npm run dev:worker`, is optional):
   ```bash
   npm run dev:api
   npm run dev:web
   ```
4. Open http://localhost:5173 and sign in.

Without an API key, the assistant runs in a clearly labelled practice mode in development, and is switched off everywhere else. Spending is capped by `AI_MONTHLY_BUDGET_USD`; a question costs about 4 cents and a draft about 8 cents.

## Commands

| Command | What it does |
|---|---|
| `npm run build` | Build every package |
| `npm run typecheck` | Strict TypeScript check, including tests |
| `npm run lint` | ESLint |
| `npm test` | All automated tests (run one package at a time; see CLAUDE.md for Windows notes) |
| `npm run check:bundle` | Confirm the built web app contains no server secrets |
| `npm run db:migrate` | Apply new database migrations |
| `npm run bootstrap-admin -- ...` | Invite the first administrator |

## Security rules

- `.env.local` is git-ignored. `SUPABASE_SECRET_KEY`, `DATABASE_URL` and `ANTHROPIC_API_KEY` are server-only; `npm run check:bundle` verifies they never reach the browser.
- The database refuses the public Supabase roles everything. The API checks permissions on every request; hiding a button in the browser is not security.
- Approval integrity is enforced by the database itself (immutable versions, fingerprints, append-only history), not only by the app.

## Documentation

- [docs/STATUS.md](docs/STATUS.md) status and next steps
- [docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md) prototype demo script
- [docs/API.md](docs/API.md) API routes and permissions
- [docs/TEST_LOG.md](docs/TEST_LOG.md) real test and verification output, including AI costs
- [docs/DECISIONS.md](docs/DECISIONS.md) design decisions
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) deployment notes
- [docs/AI_ASSISTANCE.md](docs/AI_ASSISTANCE.md) who and what built this
- [docs/strategy/](docs/strategy/) marketing strategy, research notes and the brand interview guide
- Product specification: `The_Pocket_AI_Marketing_Assistant_PRD_v0_4.md` and `The_Pocket_AI_Architecture_Addendum_v0_4.md` (v0.3 files are kept as history)
