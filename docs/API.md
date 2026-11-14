# API Reference (Stage 1)

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

All `/api` routes are rate limited (300 requests per 5 minutes per IP and per signed-in user; 429 with `Retry-After`).

The old `/api/qwen/*` and `/api/social/*` routes from the first draft were removed. Publishing will never be a public HTTP endpoint; it will only happen in the worker after an approval is re-checked (Stage 4).

## Roles and permissions

| Permission | Admin | Approver | Contributor | Viewer |
|---|:-:|:-:|:-:|:-:|
| `knowledge.view`, `analytics.view` | yes | yes | yes | yes |
| `knowledge.propose` | yes | yes | yes | no |
| `content.draft` | yes | yes | yes | no |
| `approval.request`, `data.import` | yes | no | yes | no |
| `post.approve` | yes | yes | no | no |
| `brand.approve`, `channel.connect`, `users.invite`, `users.manage`, `data.export`, `analytics.view_sensitive`, `audit.view` | yes | no | no | no |

The matrix is defined once in `packages/shared/src/roles.ts` and tested in `roles.test.ts`. Roles always come from the database membership, never from token contents.

## Errors

| Status | Meaning |
|---|---|
| 400 | Invalid input. Body includes `problems: [{ field, message }]`. |
| 401 | Missing, expired or invalid token. |
| 403 | Signed in but not allowed (wrong role, no membership, or access removed). |
| 404 | Not found (also returned for another restaurant's data). |
| 409 | Conflict (already a member; already removed; last administrator). |
| 502 | The invitation email could not be sent. |
| 503 | Invitations not configured (`SUPABASE_SECRET_KEY` missing). |
| 500 | Unexpected error. Includes a `requestId` for support; no internal details. |

Every response carries an `X-Request-Id` header that matches the server log line.

## Adding a route

Routes are added only through `PolicyRouter` in `apps/api/src/policy.ts`, which requires a permission argument. `rbac.test.ts` automatically tests every registered route against every role.
