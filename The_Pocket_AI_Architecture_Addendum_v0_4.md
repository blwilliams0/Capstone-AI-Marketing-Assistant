# The Pocket AI Marketing Assistant — Architecture Addendum v0.4

**Date:** 2026-11-13
**Read with:** `The_Pocket_AI_Architecture_v0_3.md`. Where this addendum and v0.3 differ, **this addendum wins.** Everything in v0.3 not mentioned here still applies (security boundary, roles, audit, privacy, worker design principles).
**Requirements:** `The_Pocket_AI_Marketing_Assistant_PRD_v0_4.md`.

## 1. Superseded decisions

| v0.3 section | Replaced by |
|---|---|
| §2 Embeddings (local model, pinned dimension) and the later Bedrock Titan decision | §3 below: no embeddings in V1 |
| §2, §6 Qwen `qwen3.8-flash` / `qwen3.7-plus`, Alibaba US workspace | §2 below: Claude Opus 5.5 |
| §5 steps 4–5 (embedding, pgvector, hybrid ranking) | §3 below |
| §7 Durable executor calling Meta; §8 Instagram/Facebook connector | §5 below: assisted manual posting |
| §11 schedule and Qwen implementation order | §7 below |
| §12 open decision on self-approval | §5 below |

## 2. Application AI

- **Model:** `claude-opus-5-5` for all tasks, through `@anthropic-ai/sdk`, called **only from the API server**. Key: `ANTHROPIC_API_KEY` (server-only; the web bundle check fails the build if it appears).
- **Per request:** adaptive thinking (cannot be disabled on this model), explicit `output_config.effort` per task (`low` for Q&A and drafting, `high` for interviews and rule extraction), `inference_geo: "us"`, server-side refusal fallback enabled, typed SDK errors handled, `stop_reason` checked before reading output.
- **Two output modes** (citations and structured outputs cannot be combined in one request):
  - *Answers:* knowledge passed as `document` blocks with citations enabled; each citation is mapped back to a knowledge version ID shown as a source.
  - *Drafts and extractions:* structured output validated with Zod on the server; the model returns the IDs of the facts and rules it used and the server rejects any ID it was not given.
- **Provider seam:** the existing `AiProvider` interface (`apps/api/src/providers/ai.ts`). A mock implementation stays for automated tests; tests never call the live API.
- **No dangerous tools:** the model receives no tool that approves, posts, invites, changes permissions or spends.
- **Usage and budget:** an `ai_usage_events` table (model, task, input/output/cached tokens, estimated cost, user, time; no prompt text). A monthly app budget and per-user rate limit; requests fail closed when exceeded. A spend limit is also set in the Anthropic Console.
- **To verify before real data:** Anthropic data-retention terms for the account used; exact SDK shapes for citations, structured outputs and fallbacks at implementation time.

## 3. Knowledge retrieval without embeddings

**Why not send everything:** prompt caching makes repeated identical prefixes cheaper, but its cache lasts minutes to an hour, resets whenever the library changes, and mostly misses at a restaurant's low request volume. It also does nothing for relevance: more irrelevant text makes answers worse. So context is tiered:

| Tier | Content | Sent | Limit |
|---|---|---|---|
| Brand core | Approved brand rules, approved positioning, current verified facts marked as core | Every request, first in the prompt, cached | Hard cap (target under ~4,000 words); admin screen shows size |
| Relevant sections | Approved strategy and reference documents, split into sections by heading at save time | Top matches for the question from Postgres full-text search (`tsvector`, `websearch_to_tsquery`, `ts_rank`) | Token budget per request |
| Never | Proposed, rejected, superseded, expired versions; anything outside the user's restaurant | — | — |

Retrieval filters by restaurant, approval status and expiry **in SQL before ranking**. Retrieved text is data, never instructions. The search function has one interface so embeddings can replace it later without changing callers.

## 4. Data model additions (V1)

New migrations (003 onward), each with RLS enabled, no public-role access, restrictive foreign keys, and tests:

| Table | Purpose |
|---|---|
| `knowledge_items` | One per brand rule, fact, strategy document or reference; kind; title; `in_brand_core` |
| `knowledge_versions` | Immutable body and digest; origin (`human`, `interview`, `ai_proposal`); status (`proposed`, `approved`, `rejected`, `superseded`); proposer; approver and time; `expires_at` for facts |
| `knowledge_sections` | A version's text split by heading, with a full-text index |
| `content_items`, `content_versions` | Posts and their immutable versions (caption, channel, audience, planned time, media reference and checksum, knowledge versions used) |
| `approval_requests`, `approval_events` | Approval of one exact content version by SHA-256 digest of its canonical snapshot; append-only decision history |
| `post_records` | Who posted, when, where, link, and the digest posted |
| `conversations`, `messages` | Assistant conversations, kept separate from authoritative knowledge |
| `interview_sessions`, `interview_answers` | Brand interviews and the proposals made from them |
| `ai_usage_events` | Per-request usage and cost |
| `media_assets` | Private Supabase Storage object keys and checksums |

Approved knowledge versions and approved content versions are protected by triggers against edits. Status alone never grants authority: every approved record names the approving human and time.

## 5. Approvals and posting

- Approval binds to **one content version's digest**. Any edit creates a new version with no approval.
- **Who may approve:** `post.approve` (approvers and administrators) for others' work. **Self-approval only for administrators**, requiring an explicit `confirmSelfApproval` flag, audited as `approval.self_approved`.
- **Brand rules and facts:** approved only with `brand.approve` (administrators).
- **Assisted posting:** approved items appear in "Ready to post" with the exact caption and media. Marking an item posted re-checks the approval digest, the approver's current access, and that no fact or rule it relied on has expired or been revoked; otherwise it is blocked and returned for review.
- The worker sends reminders (due to post, fact expiring) using the existing job queue. **No worker handler posts to a social platform in V1.**

## 6. What stays from v0.3

Supabase Auth with invitation-only sign-in; server-side role checks on every route; append-only audit, permission and job history; RLS deny-all for the Data API; privacy rules (no guest identifiers to the AI); untrusted-content handling; React + Vite + Tailwind + React Router; Express; PostgreSQL on Supabase; npm workspaces; Vitest tests.

## 7. Delivery plan

| Milestone | Dates | Content |
|---|---|---|
| M0 | Nov 13–14 | Stage 1 committed; strategy recorded; PRD v0.4; interview guide; sign-in recovery; staff screen; rate limiting |
| M1 | Nov 14–17 | Knowledge library with approval and full-text sections |
| M2 | Nov 17–20 | Claude provider, tiered context, cited answers, post drafting, usage and budget |
| M3 | Nov 19–22 | Exact-version approval, self-approval rule, assisted posting; **prototype Nov 23** |
| M4 | Nov 24–Dec 1 | In-app brand interview, calendar and reminders, fact expiry, image upload, home screen |
| M5 | Dec 1–5 | Measurement, export; CSV import only if exports arrive |
| M6 | Dec 5–10 | Security review, end-to-end test, backup/restore, deployment, guides, client walkthrough |

Decision gates: Nov 28 (CSV exports?), Dec 1 (hosting provider and Supabase plan; spending approval).
