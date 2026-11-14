# Development Status

Last updated: 2026-11-09, after live Supabase verification (offline remediation was 2026-11-08). Labels follow the architecture's rule: be clear about what is *working in test*, *live connected*, *blocked*, and *deferred*.

## Stage 1: software foundation

| Capability | State | Evidence |
|---|---|---|
| Monorepo builds, type-checks (strict), lints | Working | `docs/TEST_LOG.md` |
| Automated tests (78) | Working in test | `docs/TEST_LOG.md` |
| Database migration (foundation tables, RLS, append-only history) | Working in test (in-process Postgres) | `packages/db/src/migrations.test.ts` |
| Migrations 001 and 002 on the real Supabase project | **Live, verified 2026-11-09**: RLS on all 8 tables, no public-role access, append-only blocks tampering | `docs/TEST_LOG.md` section 5 |
| Sign-in token verification (JWT, issuer, audience, expiry, key) | Working in test with locally signed tokens | `apps/api/src/auth.test.ts` |
| Supabase signing keys | **Live, verified**: project publishes an ES256 key the API supports | `docs/TEST_LOG.md` section 5.6 |
| Live API rejects bad credentials (garbage, mock, forged token with real key id) | **Live, verified** | `docs/TEST_LOG.md` section 5.7 |
| Sign-in of a **real user** end to end | **Not yet verified.** Needs the owner to bootstrap an administrator | `docs/STAGE1_REMEDIATION_REPORT.md` section 6 |
| Role lookup from database; forged role claims ignored | Working in test | `auth.test.ts` |
| Four roles enforced on every API route; deny by default | Working in test | `rbac.test.ts` |
| Staff invitations and access removal, audited | Working in test with a fake invitation sender | `members.test.ts` |
| Real invitation emails through Supabase | **Not yet verified** | Needs `SUPABASE_SECRET_KEY` |
| Mock auth cannot run in production | Working, tested | `config.test.ts`, startup check |
| Worker: durable queue, leases, retries, duplicate prevention | Working in test | `jobs.test.ts`, `worker.test.ts` |
| Mock AI and mock social providers | Working (internal only, not exposed over HTTP) | `providers.test.ts` |
| Browser app: sign-in, set password, role display | Builds and passes secret scan. **Not yet viewed in a browser or tested against live Supabase** | `npm run check:bundle` |

## Mocks (by design in Stage 1)

- **AI (Qwen):** `apps/api/src/providers/ai.ts` returns clearly labelled mock text. No network calls.
- **Social (Meta):** `apps/api/src/providers/social.ts` returns fake IDs. No network calls, no HTTP route, no worker handler.
- **Mock sign-in:** development only, off by default, refused unless `NODE_ENV` is `development` or `test`.

## Needs the owner before it can be verified live

1. ~~`DATABASE_URL` and `SUPABASE_SECRET_KEY` in `.env.local`~~ (done 2026-11-09).
2. ~~Confirm asymmetric signing keys~~ (confirmed: ES256, 2026-11-09).
3. Invite the first administrator and sign in once (migrations are already applied). Also turn off public sign-ups in the Supabase dashboard.

## Deferred (not Stage 1)

- **Stage 2:** employee marketing interface, brand interviews and approval records, content and campaign tables, approval snapshots, calendar.
- **Stage 3:** real Qwen calls, embeddings and vector search (embedding model and dimension still to be decided; see `docs/DECISIONS.md`), knowledge ingestion, spending controls.
- **Stage 4:** Instagram/Facebook authorization and publishing, CSV imports, KPIs.
- **Stage 5:** end-to-end browser tests, deployment, monitoring, backup and restore, training.

## Known limitations

- No rate limiting on the API yet.
- Worker jobs must finish within their lease (default 5 minutes); there is no heartbeat extension yet.
- A person removed from the restaurant cannot currently be re-invited (the API says so with a 409). Reinstatement is a Stage 2 task.
- Mock sign-in supports read-only checks only; writes need a real database and sign-in.
- 7 moderate advisories remain in `typescript-eslint`, a development-only lint tool. Nothing in the deployed app is affected.
