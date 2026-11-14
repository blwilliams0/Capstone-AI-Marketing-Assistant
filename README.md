# The Pocket AI Marketing Assistant

A browser-based AI marketing assistant for The Pocket, a restaurant in Carmel-by-the-Sea. Management controls the brand; the assistant helps staff carry out the approved strategy. This is a CSUMB Strategic Management capstone project built for a real client.

**Current status: Stage 1 (software foundation) repaired and verified in an offline test environment. Stage 2 has not been started.** See [docs/STATUS.md](docs/STATUS.md) for an honest list of what works, what needs credentials, and what is deferred.

## What exists today

- Secure API that verifies Supabase sign-in tokens and looks up each person's role in the database.
- Four roles (administrator, approver, contributor, viewer) enforced by the server on every route.
- Staff invitations and access removal, with an append-only audit trail.
- Database foundation with row-level security on every table.
- A background worker foundation (durable job queue with leases, retries and duplicate prevention). It can only run a harmless test job; it cannot publish anything.
- A basic browser app: sign in, set a password from an invitation, and see your role.
- Mock AI and mock social-media providers for development. No real AI or social account is contacted.

## Layout

```text
apps/api/        Express REST API
apps/web/        React + Vite + Tailwind browser app
apps/worker/     Background job worker
packages/shared/ Roles and permissions shared by all apps (single source of truth)
packages/db/     Database access, migration runner, job queue
db/migrations/   SQL migrations
scripts/         Maintenance scripts (bundle secret check)
docs/            Documentation
```

## Requirements

- Node.js 24 or newer. npm (included with Node) is the package manager.
- A Supabase project (already created for development) for real sign-in.

## Quick start (offline, no Supabase needed)

```bash
npm install
npm run build
npm test            # 78 tests; uses an in-process Postgres, no internet or accounts needed
```

## Run locally with mock sign-in (development only)

1. Copy `.env.example` to `.env.local`.
2. Set `AUTH_MODE=mock` and `NODE_ENV=development`.
3. In two terminals: `npm run dev:api` and `npm run dev:web`.
4. Open http://localhost:5173 and use the yellow developer box to pick a role.

Mock mode needs no password and is refused by the API unless `NODE_ENV` is `development` or `test`. It only supports read-only checks (your role and permissions). Features that write to the database, such as invitations, need a real database and real sign-in.

## Run with real Supabase sign-in

Needs two server-only values in `.env.local` in addition to the URL and publishable key: `DATABASE_URL` and `SUPABASE_SECRET_KEY`. Then:

```bash
npm run db:migrate                                              # create the tables
npm run bootstrap-admin -- --email you@example.com --name "Your Name"   # invite the first administrator
npm run dev:api
npm run dev:web
```

Open the invitation email, set a password, and sign in. The Supabase project must use asymmetric JWT signing keys (the current default for new projects); see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Commands

| Command | What it does |
|---|---|
| `npm run build` | Build every package |
| `npm run typecheck` | Strict TypeScript check, including tests |
| `npm run lint` | ESLint |
| `npm test` | All automated tests |
| `npm run check:bundle` | Confirm the built web app contains no server secrets |
| `npm run db:migrate` | Apply database migrations |
| `npm run bootstrap-admin -- ...` | Invite the first administrator |

## Security rules

- `.env.local` is git-ignored. Never commit secrets.
- `SUPABASE_SECRET_KEY` and `DATABASE_URL` are server-only. The web build only receives an explicit allowlist of public values, and `npm run check:bundle` verifies it.
- The browser showing or hiding buttons is not security. The API checks permissions on every request.
- AI never approves or publishes anything. Nothing posts to a real social account.

## Documentation

- [docs/STATUS.md](docs/STATUS.md) feature status
- [docs/API.md](docs/API.md) API routes and permissions
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) deployment notes
- [docs/DECISIONS.md](docs/DECISIONS.md) decisions and open spec conflicts
- [docs/STAGE1_REMEDIATION_PLAN.md](docs/STAGE1_REMEDIATION_PLAN.md) and [docs/STAGE1_REMEDIATION_REPORT.md](docs/STAGE1_REMEDIATION_REPORT.md)
- [docs/TEST_LOG.md](docs/TEST_LOG.md) real test output
- [docs/AI_ASSISTANCE.md](docs/AI_ASSISTANCE.md) who and what built this

The product specification lives in the four `The_Pocket_*.md` files in the repository root.
