# Development Status

Last updated: 2026-11-18 (M3). The M3 summary below is newest; the 2026-11-13 morning summary is kept for history. Labels: *working in test*, *live* (verified against the real dev Supabase project), *not yet verified*, *deferred*. Plan: `The_Pocket_AI_Architecture_Addendum_v0_4.md` §7.

## Studio visual checkpoint (2026-11-24)

- The slate, taupe and ivory design uses locally bundled licensed Raleway and Cormorant Garamond. Buttons explicitly pair foreground and background. The supplied logo file still needs to be placed in the repository.
- Migration 011 adds private immutable assets and derivative lineage. Local photo editing exports PNG pixels and keeps normalized source images. The preview supports private upload, library filtering, simulated photo comparison in Visual Studio and Advisor, practice attachment to drafts, and a browser-local Instagram plan alongside recorded posts.
- Live photo evaluation and Supabase validation, approved visual references and presets, shared library workflow metadata, and the broader campaign, planning and measurement roadmap remain open. Coordinate migration numbering and future activity/performance changes with M5.

## Studio feature branch (2026-11-24)

- Shared palette and typography, responsive capability-aware sidebar, dedicated practice sign-in and direct approval queue link.
- Overview uses current post state, reminders, activity and calendar dates. Advisor uses the existing private history and explicit handoff to the draft form. Brand Studio filters the existing approved knowledge categories.
- The isolated preview starts its own PostgreSQL cluster, uses mock authentication and AI, and can attach privately stored practice photos to exact post versions. See [Studio preview](STUDIO_PREVIEW.md).
- Standalone assets, multimodal evaluation, visual references, photo filtering, campaign versions, and performance integration remain planned extensions. The branch does not add production analytics, schema migrations, or a live integration.

Follow-up review items: confirm whether an original approver's revoked access should block recording distribution (the architecture addendum calls for it), move complete reporting off the capped list endpoints, reconcile Pacific-time boundaries, and evaluate spend reservations for concurrent AI requests with the M5 owner. The Studio photo path keeps the caption's existing knowledge references until the text is reviewed and edited.

## Morning summary (2026-11-13 run)

**Done and committed locally (branch `stage1-remediation`, nothing pushed):**

| Commit | What |
|---|---|
| `a8a8f5e` | Stage 1 foundation (previously uncommitted) |
| `6999f54` | M0 docs: strategy files, PRD v0.4, architecture addendum v0.4, brand interview guide, decisions |
| `3c4c346` | M0 code: sign-in recovery (expired-link message, "email me a sign-in link", set-password), staff screen, rate limiting, page routing |
| `1bab401` | M1: knowledge library (approval, immutable versions, brand core, full-text search) + strategy and research notes loaded as proposals |
| `be58c2f` | M2 on the mock AI: Claude provider, tiered context, cited answers, post drafting, AI usage and budget, Ask and Create-a-post screens |

**Tests:** 134 passing (shared 7, db 32, api 88, worker 7). Build, strict typecheck, lint and bundle secret scan clean. Live dev database: migrations 001–004 applied; 14 tables, all with RLS; no public access to any table, function or sequence (TEST_LOG §6).

**Needs you:**
1. **Sign in.** Open http://localhost:5173 (after `npm run dev:api` and `npm run dev:web`), choose *Forgot your password, or your invitation link stopped working?*, enter your email, and use the emailed link to set a password. Your old invite link is used up; this replaces it. Requires the Site URL / redirect settings you were changing in Supabase.
2. **Approve the strategy.** Knowledge → Marketing strategy: the team draft is waiting as a proposal. Approving it (as yourself, with the self-approval confirmation) lets the assistant use it. Do the same for the research notes if wanted. Ideally management approves; it is your call for the prototype.
3. **Add brand rules.** The assistant has no approved brand rules yet, so drafts carry a warning. Add a few from the strategy (positioning statement, tone, "never say") or wait for the brand interview.
4. **Anthropic API key** (when ready): a key from your own Anthropic Console account in `.env.local` as `ANTHROPIC_API_KEY`, with a spend limit set in the Console. Until then the assistant runs in labelled practice mode in development, and is disabled (fails closed) otherwise.
5. Still open from before: rotate the database password.

**Decisions I made that you may want to revisit:**
- AI effort level `medium` (not `low`) for answers and drafts, because brand quality matters most to management. Small cost difference.
- Viewers cannot use the AI assistant (new capability `assistant.use`), since every request costs money.
- Assistant conversations are private to the person who asked (admins cannot read others' conversations).
- AI budget default $25/month estimated spend (`AI_MONTHLY_BUDGET_USD`).

## Feature status

| Capability | State | Evidence |
|---|---|---|
| Build, strict typecheck, lint, bundle secret scan | Working | `docs/TEST_LOG.md` |
| Automated tests (134) | Working in test | `docs/TEST_LOG.md` §6 |
| Database migrations 001–004 | **Live** on the dev project; security check clean | TEST_LOG §5, §6 |
| Sign-in token verification, roles from database, deny-by-default routes | Working in test; live API rejects bad credentials | `auth.test.ts`, `rbac.test.ts`, TEST_LOG §5.7 |
| Sign-in of a **real user** end to end | **Not yet verified** (needs step 1 above) | — |
| Password reset / "email me a sign-in link"; expired-link message | Built; **not yet tried in a browser** | `apps/web/src/pages/SignIn.tsx` |
| Staff screen (invite, list, remove with reason) | Built on tested API; **not yet tried in a browser** | `members.test.ts` |
| Rate limiting (per IP, per user, extra AI limit) | Working in test | `ratelimit.test.ts`, `ai.test.ts` |
| Knowledge library: propose, approve (admins only), self-approval confirmation, versions, retire, brand core cap, expiry | Working in test; triggers verified live | `knowledge.test.ts` (db and api), TEST_LOG §6 |
| Full-text search over approved content only | Working in test | `knowledge.test.ts`, `sections.test.ts` |
| Team strategy and research notes in the library | **Live** as proposals (not approved) | TEST_LOG §6 |
| Assistant answers with sources (tiered context: brand core + relevant sections) | Working in test with the mock; **no live Claude call yet** | `ai.test.ts` |
| Post drafting with source checking | Working in test with the mock; **no live Claude call yet** | `ai.test.ts` |
| AI usage, cost estimate, monthly budget (fails closed) | Working in test | `ai.test.ts` |
| Worker: durable queue | Working in test | `jobs.test.ts`, `worker.test.ts` |

## Next (per plan)

- **M3:** done 2026-11-18 (see M3 summary). Next: the Nov 23 prototype demo.
- **M4:** in-app brand interview (question set from `docs/strategy/BRAND_INTERVIEW_GUIDE.md`), calendar and reminders, fact-expiry nudges, image upload.
- **M5–M6:** measurement, export, security review, end-to-end test, deployment, guides.

## Requested for later (owner, 2026-11-16; not in the prototype, possibly after the semester)

- **Administrators can read staff assistant conversations.** Today conversations are private to the asker. Staff should be told plainly that management can read them before this is turned on.
- **Controlled guardrails** on what the assistant will discuss or draft (scope to be defined with management: for example topic limits, banned claims, escalation to a manager).

## M4 summary (2026-11-18, same branch, committed locally after the M3 push)

**Built:**
- **Brand interview in the app** (Interviews):
  - the guide's 30 questions with the same IDs, and consent recorded at the start
  - AI follow-up suggestions, or the guide's own follow-ups if the interviewee didn't agree to AI use
  - "Draft brand rules" keeps only quotes found word for word in the answers, re-checks them on save, and flags disagreements between managers
  - suggestions are saved only as **proposals** for an administrator to approve
- **Calendar:** posts by scheduled date, plus fact expiry dates. Posts now have an optional date.
- **Reminders** (in-app, with an unread badge): time to post, overdue, not submitted, waiting for approval, fact expiring or expired. Checked every few minutes; no email and no paid service.
- **Photos:** attach a photo to a post; it's private, checked, fingerprinted and approved together with the text. It shows on Ready to post with a download link.
- **Home screen:** "Needs you today" plus the five main tasks, and a **Photo guide**.

**Verified:**
- 214 tests pass.
- A Fable security review of the interview and reminder code found no critical or high-severity issues; all fixes are applied (migration 008).
- Migrations 006–008 are live; security check: 25 tables, all RLS, 0 public access.
- The private photo bucket was checked live: public and anonymous access refused.

**Not yet tried with the real AI:** interview follow-ups and rule drafting. A test would leave a permanent interview record, so the first real use is your interview with management. Estimated about 1 cent per follow-up and 15–30 cents to draft rules from a full interview.

**Needs you:** nothing new to set up. Before the demo, optionally start a practice interview (with yourself, labelled "PRACTICE") to try the flow.

## Reviews of 2026-11-21

A Fable photo-upload review and a project-wide bug hunt found no demo blockers. All demo-relevant findings are fixed (TEST_LOG §13). Known risks to handle later:

| Risk | When it bites | Plan |
|---|---|---|
| No `trust proxy`; rate limits and the reminder throttle live in memory | Hosting (M6) | Set `trust proxy` for the chosen host; move counters to Postgres if there is more than one instance |
| Drafts (about 1 minute) and interview rule drafting (longer) run inside one web request | Hosts that cut requests at 30–100 seconds | Pick a host with a timeout of 5 minutes or more, or move long AI calls to background jobs |
| Admin view of staff chats (requested) | When built | Show staff a notice and record it before admins can read chats; existing chats were made as private |
| Failed or timed-out AI calls are logged as $0; budget month is UTC | KPIs (M5) | Add a "cost unknown" outcome; use Pacific time for the month |
| Post lists capped at 200 and the calendar at 300 | Exports and KPIs (M5), after months of use | Paging and filters; exports must not reuse the capped lists |
| Restaurant time zone is used only in reminder wording | CSV import (M5) | One shared time-zone constant for scheduling, the calendar and imports |
| Supabase free tier pauses after about 7 idle days; no point-in-time restore | Before handoff | Dec 1 decision gate: plan and backups; run a restore test (M6) |
| Job, notification and history tables only grow | Months of use | Retention for job and notification rows (approval history stays forever) |
| Two API instances starting together would both migrate | Multiple instances | Advisory lock in the migration runner |
| No automated tests for the web screens | Ongoing | Playwright journey test (M6) |
| Demo and practice data are permanent | Now | Name them "DEMO…" and "PRACTICE…": the AI ignores those posts' history and those interviews |

## M3 summary (2026-11-18, branch `m3-approve-and-post`, not pushed)

**Built:**
- **Posts:** save an assistant draft (or write one yourself), edit (each save is a new version), submit, and approve, ask for changes or decline.
- **Self-approval:** administrators only, with an extra confirmation.
- **Ready to post:** copy the exact approved text, post by hand, and record it with the link.
- **Activity:** the permanent history.
- **Avoid repeating ideas** (owner request): drafts see one line per post approved or posted in the last 6 months and per idea drafted in the last 30 days, and each option says if it resembles a recent one. Verified live.
- **Bug fixed:** internal document keys ("D1–D3") no longer appear in anything staff read.
- **Demo:** [DEMO_SCRIPT.md](DEMO_SCRIPT.md).

**Verified:**
- 185 tests pass.
- A Fable security review found no critical or high-severity issues; all nine of its findings were fixed.
- Migration 005 is live, and the security check is clean.
- Two live Claude drafts worked. Details in TEST_LOG §8.

**Needs you before Nov 23:** follow "The day before" in DEMO_SCRIPT.md, which covers the second account, a few real facts, and one rehearsal. Rotating the database password is still open.

**Costs, measured:** a question is about 4 cents and a draft about 8 cents (an earlier estimate of 5 cents was low). Total live spend so far: about $0.21.

## Known limitations

- Rate-limit counters are in memory (one API process). Fine for one restaurant; revisit if the API ever runs as several processes. Behind a hosting proxy, Express `trust proxy` must be set so limits see real client IPs (deployment task).
- Mock sign-in is for UI checks only; actions that write to the database (knowledge, assistant) need real sign-in.
- Worker jobs must finish within their lease (5 minutes); no heartbeat yet. No worker jobs exist yet beyond a no-op.
- A removed person cannot be re-invited yet (409).
- The cost figures are estimates from published prices; the Anthropic invoice is authoritative.
- 7 moderate advisories remain in `typescript-eslint` (development-only lint tool).
- Test suites run one package at a time (`--concurrency=1`) and API/db tests use 2 workers: running more in parallel crashed Windows test processes (memory used by in-process Postgres).

## Marketing Studio Phase 2

Practice mode now includes role selection, a personalized Advisor entry point, governed media albums, approved visual examples and presets, simulated photo recommendations, source-aware photo editing, and named Feed Preview layouts. Personal preferences are private and optional. Structured review and feedback records retain provenance. General Advisor retrieval keeps its existing approved text sources. The photo editor selects eligible visual metadata separately. See [the evaluation plan](AI_EVALUATION.md) for the remaining quality checks.

Pending work includes approved reference image inputs for live evaluation, cross-workflow conversation continuity, a management workflow for promoting feedback into proposals, and feed-wide composition analysis. Existing organization knowledge remains the approved source of brand rules. Production integration and authorization of any live AI evaluation remain open.

### M5 measurement and export

Track approved post counts, approval turnaround, edit and rejection counts, manual KPI entry, approved brand reference exports, and marketing activity report exports. Keep missing measurements distinct from actual zero values. Existing version, approval and audit records are inputs to this work. Reservation interest, repeat visits, private-event inquiries and referrals require reliable source data before reporting outcomes or attribution.

### M6 hardening and handoff

Coordinate ownership and migration numbers before starting overlapping implementation. The new collection sharing rules, historical recipes, image processing, exact-version approval, retention and preferred context require security and end-to-end review. Production integration verification, deployment, staff documentation, administrator documentation, and operational and client handoff remain milestone work.
