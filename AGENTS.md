# AGENTS.md

Instructions for AI coding agents (Codex and others) working in this repository.

**Read `CLAUDE.md` first.** It is the full guide to commands, architecture and project rules, and it applies to every coding agent, not only Claude. Humans should also read `docs/DEVELOPER_HANDOFF.md`.

## Rules you must follow

1. **Deny by default.** Add every API route through `PolicyRouter` (`apps/api/src/policy.ts`) with a capability or `'member'`. Roles come from the `memberships` table, never from token claims. Validate params and body with zod before any side effect.
2. **Never edit an applied migration** (`db/migrations/001` to `010` are live). Add a new numbered file. Every new migration must enable RLS on its tables; revoke table, function and sequence access from `anon` and `authenticated`; run `REVOKE EXECUTE ON ALL FUNCTIONS ... FROM PUBLIC`; and set `search_path = public, pg_temp` on new functions.
3. **Do not weaken approval integrity.** Content versions are immutable, approvals bind to a digest, self-approval is admin-only with confirmation, and history tables are append-only. Rules are enforced by both API checks and database triggers; keep both.
4. **The app's AI gets no tools** and never approves, publishes, invites or changes permissions. Wrap untrusted text in prompts as data. Keep system prompts byte-stable.
5. **Secrets:** never commit `.env.local`, never print keys, never put server secrets in the web bundle.
6. **No live AI calls in tests.** Use the mock or a spy provider. No new paid services.
7. **New capabilities** need an entry in `packages/shared/src/roles.ts`, a label in `apps/web/src/pages/Home.tsx` (`CAPABILITY_LABELS`) and a row in `docs/API.md`.
8. **Do not add client private data to the repo.** `docs/research/` and `docs/strategy/CLIENT_FACTS_FROM_TEAM_ANALYSES.md` are git-ignored on purpose.

## Before you finish

Run and pass all of these:

```bash
npm run build
npm run typecheck
npm run lint
npm test
npm run check:bundle
```

After changing `packages/shared` or `packages/db`, rebuild that package before testing the apps. Tests use PGlite; keep vitest `maxWorkers: 2` and turbo `--concurrency=1`.

Work on a feature branch and open a pull request. Never push to `main`. Update `docs/STATUS.md`, and `docs/API.md` for new routes.
