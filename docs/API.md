# API Reference

Base URL in development: `http://localhost:3000`. All routes under `/api` require `Authorization: Bearer <token>` (a Supabase access token). Every route also declares a required permission; a caller without it gets `403`.

## Routes

| Method and path | Who may call it | Purpose |
|---|---|---|
| `GET /health` | Anyone (no sign-in) | Liveness check. Reveals nothing about configuration. |
| `GET /api/me` | Any member | Your name, role and permissions, as read from the database. |
| `GET /api/admin/members` | `users.manage` (admin) | List staff and their status. |
| `POST /api/admin/invitations` | `users.invite` (admin) | Invite a person. Body: `{ email, name, role }`. Returns `201`. |
| `POST /api/admin/members/:id/revoke` | `users.manage` (admin) | Remove someone's access. Body: `{ reason }`. Takes effect on their next request. The last active administrator cannot be removed (`409`). |
| `GET /api/audit-events?limit=50` | `audit.view` (admin) | Recent activity history (limit 1 to 200). |
| `GET /api/knowledge` | `knowledge.view` | The library. People who can propose also see pending proposals and retired items; viewers see only approved, current items. |
| `GET /api/knowledge/brand-core` | `knowledge.view` | What the assistant always receives: approved, current, unexpired brand rules and facts marked for the core, with word count and limit. |
| `GET /api/knowledge/search?q=...&limit=8` | `knowledge.view` | Full-text search over sections of approved, current content only. |
| `GET /api/knowledge/:itemId` | `knowledge.view` | Version history (viewers: approved and superseded only). |
| `POST /api/knowledge` | `knowledge.propose` | New item `{ kind, title, body, sourceNote?, expiresAt? }`. Always saved as a proposal. |
| `POST /api/knowledge/:itemId/versions` | `knowledge.propose` | Propose a change `{ body, sourceNote?, expiresAt? }`. The approved version stays in use until the change is approved. |
| `POST /api/knowledge/versions/:versionId/approve` | `brand.approve` (admin) | Approve exactly that version `{ note?, confirmSelfApproval? }`. Supersedes the previous approved version. Your own proposal needs `confirmSelfApproval: true` (409 otherwise) and is audited as self-approved. 409 if expired or the brand core would exceed its limit. |
| `POST /api/knowledge/versions/:versionId/reject` | `brand.approve` (admin) | Reject `{ note }` (reason required). |
| `POST /api/knowledge/:itemId/retire` | `brand.approve` (admin) | Stop using an item `{ reason }`. Cannot be undone. |
| `POST /api/knowledge/:itemId/brand-core` | `brand.approve` (admin) | `{ inBrandCore }`. Only brand rules and facts. |

| `GET /api/assistant/status` | any member | `{ available, provider }`: `anthropic`, `mock` (practice mode, development only) or `disabled`. |
| `POST /api/assistant/ask` | `assistant.use` | `{ question, conversationId? }` → answer, cited sources (approved knowledge versions), what the assistant was given. Stored in the asker's own conversation. |
| `GET /api/assistant/conversations` | `assistant.use` | Your own recent conversations. |
| `GET /api/assistant/conversations/:conversationId` | `assistant.use` | One of your conversations (others' return 404). |
| `POST /api/drafts/generate` | `content.draft` | `{ audience: locals|tourists|both, channel, goal, topic }` → 2–3 options with the sources each relies on, what to confirm, risks, timing, measures, photo tips, warnings. Nothing is saved or posted. |
| `GET /api/ai/usage` | `analytics.view_sensitive` (admin) | Estimated AI spend this month, budget, request count. |

**Posts, approval and assisted posting (M3).** A post has immutable versions; the database computes each version's canonical snapshot and SHA-256 fingerprint. An approval covers exactly one version. Saving an edit creates a new version and the database supersedes any waiting or approved request.

| Method and path | Who may call it | Purpose |
|---|---|---|
| `GET /api/posts?archived=true` | `content.view` | All posts with status (`draft`, `in_review`, `changes_requested`, `rejected`, `approved`, `posted`, `archived`) and blockers. Archived hidden unless asked. |
| `GET /api/posts/:itemId` | `content.view` | Versions (with sources and whether each is still current), approval requests, post record, history. |
| `POST /api/posts` | `content.draft` | `{ channel, audience, caption, title?, angle?, photoPlan?, scheduledFor?, sourceVersionIds[], origin: human|ai_draft }`. Sources must be approved, current knowledge (400 `invalid_sources`). |
| `POST /api/posts/:itemId/versions` | `content.draft` | Save an edit `{ caption, angle?, photoPlan?, channel?, audience?, scheduledFor? }`. Outdated sources are replaced by the current approved version of the same rule or fact. 409 once posted or archived. |
| `POST /api/posts/:itemId/submit` | `approval.request` | Submit the latest version `{ note? }`. 409 `already_open` if waiting or approved. |
| `POST /api/posts/:itemId/archive` | `content.draft` | Withdraw/supersede open requests and hide. Not allowed once posted. |
| `POST /api/approvals/:approvalId/approve` | `post.approve` | `{ note?, confirmSelfApproval? }`. If you submitted or wrote the version: 403 `self_not_allowed` unless you are an administrator; administrators need `confirmSelfApproval: true` (409 otherwise) and it is recorded as self-approval. 409 `stale_sources` if a cited rule or fact changed. |
| `POST /api/approvals/:approvalId/request-changes` · `/reject` | `post.approve` | `{ note }` (required). |
| `POST /api/approvals/:approvalId/withdraw` | `approval.request` | The submitter or an administrator. |
| `GET /api/posts/ready` | `post.record` | Approved posts not yet posted: exact text, fingerprint, blockers. |
| `POST /api/approvals/:approvalId/posted` | `post.record` | `{ digest, postUrl?, note? }` after posting by hand. `digest` must equal the approved fingerprint (409 `digest_mismatch`); 409 `stale_sources`, `not_approved`, `already_posted`. Posted posts are locked. |
| `GET /api/activity?limit=100` | `content.view` | Append-only approval and posting history. |

Drafting (`POST /api/drafts/generate`) now also sends a one-line summary of each post approved or posted in the last 6 months and of ideas drafted in the last 30 days (angle and opening line only; at most 80 + 40 lines), and returns `repeatNote` per option. Records are kept; the window only limits what the AI receives. Document keys (D1…) are removed from any text shown to staff.

AI routes return **503** when no AI is configured (`reason: disabled`) or this month's budget is reached (`reason: budget`), and **502** if the AI service fails. They have an extra limit of 30 requests per 10 minutes per person.

All `/api` routes are rate limited (300 requests per 5 minutes per IP and per signed-in user; 429 with `Retry-After`).

The old `/api/qwen/*` and `/api/social/*` routes from the first draft were removed. Publishing will never be a public HTTP endpoint; it will only happen in the worker after an approval is re-checked (Stage 4).


**Photos (M4c).** Private bucket `post-media`. The browser never gets general storage access.

| Method and path | Who may call it | Purpose |
|---|---|---|
| `POST /api/posts/:itemId/media/upload-link` | `content.draft` | `{ contentType: image/jpeg, image/png or image/webp }` → one-time upload link for a fresh, server-chosen path. |
| `POST /api/posts/:itemId/media` | `content.draft` | `{ path }` after uploading. The server downloads it, checks the real type and size (10 MB), fingerprints it (SHA-256) and saves a **new version**, so an approved post needs approval again. |
| `POST /api/posts/:itemId/media/remove` | `content.draft` | New version without a photo. |
| `GET /api/posts/:itemId/media?versionId=` | `content.view` | Short-lived (5 minute) link to view or download that version's photo. |

**Brand interviews (M4a)**, all `interview.conduct` except saving a suggestion (`knowledge.propose`):
- `GET` and `POST /api/interviews`, `GET /api/interviews/:sessionId`
- `POST /api/interviews/:sessionId/` + `answers`, `follow-up`, `extract`, `proposals`, `complete` or `withdraw-ai-consent`

**Calendar and reminders (M4b):**
- `GET /api/calendar?from=YYYY-MM-DD&to=YYYY-MM-DD` (`content.view`, at most 92 days)
- `GET /api/notifications`, `POST /api/notifications/:notificationId/read`, `POST /api/notifications/read-all` (any member, own reminders only)

## Roles and permissions

| Permission | Admin | Approver | Contributor | Viewer |
|---|:-:|:-:|:-:|:-:|
| `knowledge.view`, `analytics.view`, `content.view` | yes | yes | yes | yes |
| `knowledge.propose`, `assistant.use` | yes | yes | yes | no |
| `content.draft`, `approval.request`, `post.record` | yes | yes | yes | no |
| `data.import` | yes | no | yes | no |
| `post.approve` (never your own, except administrators with confirmation) | yes | yes | no | no |
| `brand.approve`, `channel.connect`, `users.invite`, `users.manage`, `data.export`, `analytics.view_sensitive`, `audit.view` | yes | no | no | no |

The matrix is defined once in `packages/shared/src/roles.ts` and tested in `roles.test.ts`. Roles always come from the database membership, never from token contents.

## Errors

| Status | Meaning |
|---|---|
| 400 | Invalid input. Body includes `problems: [{ field, message }]`. |
| 401 | Missing, expired or invalid token. |
| 403 | Signed in but not allowed (wrong role, no membership, or access removed). |
| 404 | Not found (also returned for another restaurant's data). |
| 409 | Conflict (already a member; already removed; last administrator; already decided; approval no longer applies; fingerprint mismatch; outdated sources). Body includes `reason`. |
| 502 | The invitation email could not be sent. |
| 503 | Invitations not configured (`SUPABASE_SECRET_KEY` missing). |
| 500 | Unexpected error. Includes a `requestId` for support; no internal details. |

Every response carries an `X-Request-Id` header that matches the server log line.

## Adding a route

Routes are added only through `PolicyRouter` in `apps/api/src/policy.ts`, which requires a permission argument. `rbac.test.ts` automatically tests every registered route against every role.
