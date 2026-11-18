# The Pocket AI Marketing Assistant — Product Requirements Document

**Version:** 0.4
**Date:** November 13, 2026
**Supersedes:** PRD v0.3 (kept unchanged as history). Technical companion: [`The_Pocket_AI_Architecture_Addendum_v0_4.md`](./The_Pocket_AI_Architecture_Addendum_v0_4.md), read together with architecture v0.3.
**Marketing direction:** [`docs/strategy/MARKETING_STRATEGY.md`](./docs/strategy/MARKETING_STRATEGY.md) (capstone team draft, pending management approval).
**Status:** Stage 1 foundation built and verified. Product features in this document are requirements, not completed work; see `docs/STATUS.md`.

> **North star:** Management controls the brand. The marketing strategy sets the direction. The assistant helps employees carry it out with grounded advice, drafts, human approvals and simple measurement.

## What changed from v0.3

| Topic | v0.3 | v0.4 |
|---|---|---|
| Application AI | Qwen3.8-Flash / Qwen3.7-Plus, U.S.-scoped Alibaba workspace | **Claude Opus 5.5** through the Anthropic API, U.S. inference requested |
| Knowledge retrieval | Embeddings (local, later Bedrock Titan) + pgvector | **No embeddings in V1.** Always-included approved brand core + Postgres full-text search for relevant sections, with a size cap |
| Publishing | Instagram/Facebook API publishing via a worker | **Assisted manual posting:** exact approved content handed to staff to post; the post is recorded. API publishing is later |
| Self-approval | Open question | **Administrators (Mike, Elliot) may approve their own work** with an explicit confirmation, recorded in the audit trail. Others may not |
| Marketing strategy | Referenced generally | Team strategy recorded: one brand, two audiences (locals, tourists), private events across both, channel roles, ownership, simple measures |
| Schedule | Stages 2–5 through early December | **Prototype Nov 23 (laptop demo); finished about Dec 10** |
| Coding | Qwen Code | Claude Code |

## 1. Problem and scope

The Pocket, an upscale restaurant in Carmel-by-the-Sea, offers a covered and heated patio, frequently changing chef-driven seasonal food, personal hospitality, wine and pastry capabilities, and established guest relationships. Its strengths are not communicated consistently, and marketing is handled by management alongside operations, without a repeatable process, clear ownership or useful measures.

The project has **two complementary deliverables**:
1. **The marketing strategy** (capstone team): focused differentiation, one brand, two priority audiences, channel roles, ownership and measurement.
2. **This AI Marketing Assistant**: a secure browser application that helps staff apply the approved strategy. It does not create brand direction on its own.

**Audiences:** locals and repeat customers (retention) and tourists and visitors (discovery). Private events are a campaign type across both, not a third segment.

**Outcomes to test, not promise:** more consistent brand communication, less management time spent on marketing, more first-time and repeat reservations, more qualified event inquiries. No revenue effect is claimed.

## 2. Users and authority

| User | Need | Authority |
|---|---|---|
| Administrator (Mike and Elliot initially) | Protect the brand, delegate, oversee access and cost | Invite and remove staff; approve brand rules and facts; approve posts (including their own, with confirmation); view the audit trail and exports |
| Approver | Review content quickly | Approve, reject or return posts written by others. Cannot approve brand rules, manage staff, or approve own work |
| Contributor (e.g. the marketing lead) | Step-by-step help | Ask questions, draft posts and campaigns, propose facts and brand changes, submit for approval |
| Viewer | See approved material | Read approved brand reference and permitted reports |

Permissions are enforced by the server on every request, not by hiding buttons. Removing someone takes effect on their next action. **The AI has no authority** to approve, publish, invite, change permissions or spend money.

## 3. Principles

1. **Management-led brand.** Brand rules come from management interviews and are approved by an administrator, word for word.
2. **Durable, separated knowledge.** The database, not a chat, is the source of truth. Four classes are kept apart: verified facts, approved brand and strategy, reference research, and AI suggestions.
3. **Exact-version approval.** Every public action is approved as an exact snapshot. Changing it requires a new approval.
4. **Grounded, honest advice.** Answers cite their sources, separate facts from suggestions, and say when staff must confirm something. No invented dishes, events, prices or policies.
5. **Privacy by default.** No guest names, emails, phone numbers or reservation notes are sent to the AI. Interview content is sent only with management's permission.
6. **Affordable and maintainable.** Small number of services, spend limits, plain-language screens, documented handoff.

## 4. Requirements and acceptance tests

Priority: **Must** (Dec 10), **Should** (Dec 10 if time allows), **Later** (documented, not built).

### FR-01 Sign-in and staff administration — Must
- Invitation-only sign-in (no public sign-up), password set from the invitation, password reset, sign-out.
- Staff screen: invite with a plain-English role description, list, remove with a reason.
- **Acceptance:** A contributor cannot approve, publish or invite, in the screen or directly through the API. A removed person is refused on their next request.

### FR-02 Brand interview and approval — Must
- A written interview guide ([`docs/strategy/BRAND_INTERVIEW_GUIDE.md`](./docs/strategy/BRAND_INTERVIEW_GUIDE.md)) usable in person, and the same questions inside the app.
- The app turns answers into **proposed** brand rules with the supporting quote; disagreements between managers are shown side by side.
- **Acceptance:** No interview answer or AI summary appears as an approved rule until an administrator approves the exact wording. Conflicts are surfaced, not resolved by the AI.

### FR-03 Knowledge library — Must
- Add brand rules, facts (with who verified them and when they expire), the strategy document and reference notes. Each change is a new version; approved versions cannot be edited.
- Show which items form the **brand core** that every AI request uses, and how large it is.
- **Acceptance:** Only approved, current, unexpired versions reach the AI. Rejected, superseded, expired and proposed versions never do.

### FR-04 Grounded marketing assistant — Must
- Practical answers on restaurant and relationship marketing, locals vs tourists, channels, Google and SEO basics, events, content and photography.
- Every answer lists its sources (clickable), separates The Pocket's facts from general advice, and flags what staff must confirm.
- **Acceptance:** An answer never states a menu item, price or event not in the approved facts. A question about something unknown gets "please confirm" rather than a guess. Text inside a document that says "ignore your instructions" changes nothing.

### FR-05 Post and campaign drafting — Must
- Choose audience (locals, tourists, both), goal, channel and the facts to feature; receive draft options with why each fits, what to confirm, and risks. Edit and keep history.
- **Acceptance:** A locals draft and a tourists draft about the same dish are visibly different but follow the same brand rules. Drafts list the facts and rules they used; unknown IDs are rejected.

### FR-06 Photo-taking guidance — Should
- Text checklist for angles, light, framing and simple editing for food and patio photos.
- **Acceptance:** The assistant never claims to have seen a photo. (Image analysis is Later.)

### FR-07 Approval with context — Must
- Each request shows what exactly will be posted, why it fits, which verified facts it relies on, what is uncertain, and risks. Choices: approve exactly, return for edits, reject.
- Self-approval: administrators only, with an extra confirmation, recorded as self-approved.
- **Acceptance:** Editing any part of an approved post creates a new version with no approval. An approver or contributor cannot approve their own work. An expired fact or revoked brand rule blocks posting until re-approval.

### FR-08 Assisted posting — Must
- "Ready to post" shows the exact approved caption and image; staff post it themselves and record the link.
- **Acceptance:** Only approved, unchanged content appears there; marking it posted re-checks the approval. No social account passwords or tokens are stored. API publishing to Instagram/Facebook is **Later**.

### FR-09 Calendar and reminders — Should
- Planned posts and campaigns on a calendar; reminders when something is due to post or a fact is about to expire.

### FR-10 Measurement — Should
- Activity measures from the app (posts approved and published, time to approval, edits and rejections) and manually entered KPIs (reservations, referrals, event inquiries).
- **Acceptance:** Missing data shows as unknown, never zero. Engagement is never presented as bookings or revenue. Targets are kept separate from results.

### FR-11 Discovery guidance (Google, website, listings) — Should
- Help staff check public information for consistency and draft corrections for a human to make. No automatic changes.

### FR-12 Export and handoff — Must (basic)
- Export the approved brand reference. Admin guide covering setup, accounts, staff, backups, costs and troubleshooting.

### Later (not in V1)
Instagram/Facebook API publishing; embeddings and vector search; Toast/Tock CSV import (only if sample exports arrive by Nov 28); live web research; Google or website automation; image analysis and editing; operations advice beyond marketing; a locally hosted model.

## 5. Human-controlled lifecycle

1. Management approves brand rules and the strategy.
2. Staff keep facts current; the assistant helps research, plan and draft.
3. A staff member submits an exact post for approval.
4. An approver or administrator sees context, sources, uncertainty and risks, then decides.
5. Staff post the approved version themselves and record it.
6. The app records what happened and what can be measured.
7. The assistant may suggest changes to the strategy or rules; a human decides.

No autonomous posting, ad buying, spending, customer outreach or surveys.

## 6. Privacy, cost and operations

- **AI provider:** Anthropic (Claude Opus 5.5) via API, U.S. inference requested. Data handling terms to be reviewed before real interview content is sent.
- **Data sent to the AI:** the approved brand core, relevant approved sections, and the user's question. Never guest identifiers or raw reservation data.
- **Billing:** an Anthropic Console API account (a Claude Pro chat subscription cannot power the app). Development uses the project owner's account; the restaurant should own its own account at handoff, with a monthly spend limit. Estimated $20–60/month for one restaurant; **to be measured**, not promised.
- **Other services:** Supabase (database and sign-in) and, at handoff, one hosting provider. Plans and costs need owner approval (decision gate Dec 1).
- The app records model, tokens and estimated cost per AI request (no prompt text) and stops AI requests when the monthly app budget is reached.

## 7. Definition of done

**Prototype (Nov 23, on the owner's laptop):** sign in; approve a brand rule; ask a question and see sources; draft a post for locals; submit; approve as a manager; post it manually and record it; see the activity history.

**V1 (about Dec 10):** all Must requirements, deployable build, admin guide, tests passing, honest status report marking what is working, waiting on the client, and deferred.

## 8. Attribution

The marketing strategy, interviews and research are the capstone team's work. The project owner directs the application's requirements, design and development; Claude Code writes the code under that direction. Record tests actually run and client validation actually completed. Do not present untested features as complete.
