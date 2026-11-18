> **Superseded in part (2026-11-13).** Read with [The_Pocket_AI_Marketing_Assistant_PRD_v0_4.md](The_Pocket_AI_Marketing_Assistant_PRD_v0_4.md), which replaces this document where they differ (Claude instead of Qwen; no embeddings in V1; assisted manual posting; new schedule). This file is kept unchanged below as the project record.

# The Pocket AI Marketing Assistant — Product Requirements Document

**Version:** 0.3 (Markdown)  
**Date:** November 4, 2026  
**Status:** Working product requirements approved in principle; no claim that the application has been implemented.  
**Companion technical specification:** [`The_Pocket_AI_Architecture_v0_3.md`](./The_Pocket_AI_Architecture_v0_3.md).  
**Product ownership:** The Pocket management and ownership govern the restaurant's brand. The capstone team defines the proposed strategy and solution; the project developer builds using AI-assisted coding; architecture/design review supports implementation.

> **North star:** Management controls the brand. The marketing strategy establishes direction. The AI assistant helps employees carry it out through clear expertise, useful recommendations, human approvals, and practical measurement.

## 1. Problem and scope

The Pocket, an upscale restaurant in Carmel-by-the-Sea, offers an unusual combination of a covered/heated patio, frequently changing chef-driven seasonal food, knowledgeable personal hospitality, wine, pastry capabilities, and established relationships. Previous market/competitor, external, and internal analyses found that the restaurant's strengths are not consistently communicated. Chef Mike and GM Elliot oversee marketing while carrying extensive restaurant responsibilities. The business lacks an organized, repeatable, affordable marketing process with assigned responsibility and meaningful measures of results.

The project has **two separate, complementary deliverables**:

1. **A comprehensive, editable marketing strategy** — management-approved positioning and story, locals/regulars and visitor segments, relationship marketing, channel priorities, digital discovery and SEO, referral partnerships, content guidance, owners/roles, calendars, KPIs, and ongoing review.
2. **This browser-based AI Marketing Assistant** — an employee-accessible, secure application that uses the approved strategy and knowledge to guide and simplify implementation. The application does not create marketing direction or brand authority on its own.

The initial release should address two audiences: **locals/repeat guests (primary)** and **tourists/visitors (secondary)**. Private events are an important campaign type across both audiences. Restaurant management decides its final positioning through interviews and sign-off; the capstone team's suggested positioning is a proposal, not a pre-approved brand fact.

**Outcomes to test, not promise:** Higher brand consistency, better visitor discovery, local repeat engagement, qualified event inquiries, less employee preparation time, measurable channel activity, and manageable total cost. No proven reservation or revenue uplift has yet been attributed to this system.

## 2. Users and authority

| User | Primary need | Authority |
|---|---|---|
| Administrator — Mike and Elliot initially | Preserve the brand, delegate marketing, oversee cost and access | Invite/revoke staff, approve brand facts/policies, connect authorized accounts, approve publishing and major decisions, inspect audit and exports, consistent with any owner-level sign-off requirements. |
| Marketing approver | Quickly assess proposed content | Approve/reject/return eligible public actions, with exact previews and explanations; no arbitrary user privileges. |
| Marketing contributor | Get clear step-by-step guidance | Ask questions, conduct or transcribe permitted interviews, gather facts, draft campaigns/posts, prepare schedules, submit for review. |
| Viewer | See appropriate approved information | Read selected brand/strategy material and appropriate reports only. |

Permission tiers must be explained **in plain English** when an admin invites someone. Roles can be revoked. Permission checks run on the backend and scheduled worker, not only through buttons. Owner Kent's brand sign-off role, where required, will be set by management before final brand approval. AI has **no authority** to approve, publish, connect accounts, change permissions or spend money.

## 3. Non-negotiable principles

1. **Management-led interviews.** Ask adaptive questions about The Pocket's identity, story, audiences, hospitality values, photography standards, boundaries and marketing goals.
2. **Independent durable memory.** Maintain current and historical approved restaurant knowledge in a real database. A chat conversation or model context window is not the source of truth.
3. **Separate knowledge classes.** Distinguish verified restaurant facts; management-approved brand and strategy; properly licensed research and expertise; privacy-safe customer insights; and AI-generated hypotheses/recommendations.
4. **Explicit human authorization.** Explain proposed consequential actions and approve their exact version before execution. No AI self-approval.
5. **Practical expert guidance.** Teach employees how to execute marketing tasks, not only write generic captions. Include local relationship marketing, upscale dining communications, SEO, referrals and photographic technique.
6. **Evidence-based iteration.** Compare recommendations against actual performance and management feedback. Proposed changes never silently rewrite approved brand information.
7. **Privacy by default.** Minimize external transfer, keep customer identifiers out of model prompts, control access and retention, and offer the option to evaluate a private/local AI system in a later version.
8. **Designed for nontechnical staff.** Browser access, simple language, self-explanatory permissions, clear action states, and a client maintenance guide.

## 4. Version-one features and acceptance tests

### FR-01 — Secure browser application and staff administration

- Login; admin invitations; understandable administrator, approver, contributor, viewer tiers; revocation; safe logout.
- **Acceptance:** Contributor cannot approve/post/invite users via UI or directly through API. Removed access prevents future use, including pending scheduled actions.

### FR-02 — Management brand interviews and approval

- Adaptive interview questions, draft summaries, extracted proposed brand guidelines, source evidence, an easy edit/approve/reject screen, and preserved versions.
- **Acceptance:** An interview answer cannot appear as official brand policy until an authorized human approves the exact statement. Conflicts between leadership responses are surfaced, not guessed away.

### FR-03 — Knowledge library, source attribution and persistent memory

- Upload relevant marketing strategy, interviews, authorized restaurant documents and free/open marketing reference materials. Store title, license, source, version, verified/approved status, access policy and source date. Search these materials within permitted roles.
- **Acceptance:** The assistant retrieves relevant approved and current evidence; provides clickable/resolvable citations; distinguishes research from Pocket facts; excludes unapproved, obsolete, and unauthorized content.
- Use only public-domain, openly licensed, explicitly permitted, or appropriately summarized and cited marketing textbooks. Uploading a document does not automatically authorize ingestion or re-distribution.

### FR-04 — Grounded AI marketing conversations

- Answer practical questions on high-end restaurant and **relationship marketing**, brand positioning, customer experience communication, social strategy, local retention, visitor discovery, referral partners, seasonal events and SEO.
- Model policy: Qwen3.8-Flash for routine tasks; Qwen3.7-Plus for complex interviews and nuanced evaluation; verify a U.S.-inference workspace before any confidential inference.
- **Acceptance:** Every recommendation distinguishes evidence, approved directives, speculation, missing information, suggested employee actions and measurable outcomes. No invented menu item, availability, event or restaurant policy.

### FR-05 — Marketing campaign and social content builder

- Select goal, locals/visitors/event audience, platform, key verified offer/experience, approved brand guidelines. Generate draft alternatives, scheduling suggestions, staff checklist and campaign measures. Keep an editable history.
- **Acceptance:** A local-repeat campaign and a first-time-visitor campaign are visibly distinct while following the same approved brand identity.

### FR-06 — Photography guidance (text only for V1)

- Describe suggested angles, lighting, framing, background, camera positioning and optional editing tools appropriate for premium food and restaurant photography. Instructions should be actionable for non-experts.
- **Acceptance:** User can ask how to photograph a dish and receive a practical checklist; AI does **not claim to have assessed an unseen photograph**. Automated uploaded-image analysis and edited output are deferred.

### FR-07 — Contextual approval before actions

Every approval request must explain:

1. **What** exactly will happen (full caption/media/destination/time preview).
2. **Why** it fits the approved strategy and intended audience.
3. **What facts** are verified and by whom; citations to current brand guidelines and sources.
4. **What is uncertain** or requires a kitchen/manager check.
5. **Possible risks**, customer impact, time and resource requirements.
6. **Choices:** approve exact action, edit and re-submit, reject, request more explanation.

- **Acceptance:** Changing an approved caption, media, destination, or scheduled time invalidates the old approval. A scheduled job never executes unapproved or revoked content. Drafting/research does not require approval.

### FR-08 — Social account connection, scheduling and publishing

- Instagram professional-account OAuth where eligible, verified account status, permissions and scheduling; support an eventual Facebook business Page. Management can authorize exact content and have the executor post at the approved time. Manual publishing remains available when account access is blocked.
- **Acceptance:** With a permitted test account, one approved eligible post publishes once with external post ID and visible status. Duplicate requests, revoked permissions, expired facts, uncertain API responses and missing tokens fail safely. **Client production publishing is a dependency, not an already-implemented promise.**
- Never ask for or store social account passwords; connect through official provider authorization.

### FR-09 — Manual Toast/Tock CSV imports

- File validation, column mapping, preview, explicit import, provenance, helpful errors, deduplication or import history, aggregated metrics. Keep raw data briefly and only when permitted; no names, addresses or reservation notes sent to external AI.
- **Acceptance:** Staff can inspect and correct mapping before import; imports cannot leak PII in logs or model calls; metrics disclose missing/incomplete fields.

### FR-10 — Marketing KPIs and review

- Dashboard can show measured/estimated/unknown new and repeat reservations, Inn/hotel referrals where known, private-event inquiries/bookings, content preparation time, marketing spend, social reach/engagement, approved-post volume, rejected/edited content, and brand accuracy.
- **Acceptance:** No empty field is shown as zero; baselines and targets are separate; reach and likes are not presented as bookings or revenue; metrics trace to dates/sources and allow basic period comparisons.

### FR-11 — SEO and digital discovery guidance

- Review controllable public information: Google/Maps positioning, descriptions, photos, booking links, website messaging, referral listings. Suggest precise changes with instructions and management approval; track resolution.
- **Acceptance:** Assistant identifies an inconsistency and suggests a human-correctable action. No claim that every Google Search snippet can be controlled by Google Business Profile. Automated Google/CMS edits are not in V1.

### FR-12 — Internet research and expert library

- Query current public research through a safe web research connector and cite current source and date. Protect sensitive internal terms from external search queries; separately label sources and recommendations. Populate expert library using legally usable materials.
- **Acceptance:** External claims and business facts are visibly separated; untrusted webpage instructions cannot alter system permissions or approval rules.

### FR-13 — Export, client installation and ongoing support

- Management can export approved brand reference, marketing plan and performance reports; README explains setup, hosting, backups, authorized account connection, staff invitations, maintenance and problem resolution.
- **Acceptance:** Client can use the browser without VS Code; tests validate backup/restore and appropriate export access.

## 5. Human-controlled marketing lifecycle

1. A management-approved strategy defines audience, goals, positioning and rules.
2. Staff confirms timely restaurant facts; an AI assistant helps research, plan, draft and explain.
3. Employee submits an **exact content/action version** for authorized approval.
4. Manager sees plain-language context, sources, uncertainties and risks; approves or returns for correction.
5. A deterministic, auditable executor performs the authorized action at the approved time **only** if the approval and permissions are still valid.
6. The application records outcome, platform identifiers and what can actually be measured.
7. AI may propose a revised strategy or rule based on results, but an authorized human decides whether to adopt it.

No autonomous execution of marketing changes, no purchasing ads, no automatic spending, no unsolicited customer surveys or outreach, and no general restaurant-operation consulting in V1.

## 6. Privacy and knowledge-handling requirements

- Private documents, interviews and permissions stored with server-side authorization and appropriate U.S. service configuration.
- External Qwen calls require approved provider, confirmed U.S.-only inference scope, review of data handling, and management authorization for confidential interview excerpts.
- No unredacted reservation/Toast/Tock exports, guest names, emails, phone numbers, or reservation notes leave the controlled backend for AI models.
- Analyze customer retention using aggregate information and, where genuinely needed and approved, keyed pseudonymous identifiers; don't infer someone's local status or spending power from insufficient evidence.
- Inputs from uploaded documents or web pages are *data*, not system instructions. Audit authorized operations and redact sensitive logs.
- The application records where each cited fact, research finding, brand principle and AI recommendation came from and when it was reviewed.
- Local/private Gemma 4 or another capable model is an **optional later deployment** only after quality, privacy, hardware and maintenance comparisons. Nontechnical staff must not be required to maintain a GPU server.

## 7. Quality, cost and completion criteria

**Quality:** Brand-alignment checks, source-grounding evaluations, usability walk-throughs, action authorization/integrity tests, data-leak tests, worker duplication/uncertainty tests, role-revocation tests and backup recovery.

**Operating-cost categories:** AI usage, embedding/indexing, hosted API, job worker, managed database/authentication, object storage/egress, backup, web search, email, logging, domain, implementation and maintenance labor, optional future private model. Price budgets after measuring requests, files and usage; seek a $100–$200/month practical configuration with a $200–$400/month fuller scenario to evaluate, not a fixed guarantee.

**Definition of usable V1:** A nontechnical contributor can create a brand-aligned campaign draft, see evidence, submit it; a manager can approve exact content with context; the same approved version can be scheduled to a mock or genuinely authorized external account without unauthorized publishing; managers can inspect meaningful KPIs and update approved knowledge, with every action recorded. The system also has a clear guide for what is working, what awaits client access, and what remains deferred.

**Delivery:** Working repo, deployable web application, managed knowledge, editable approved marketing strategy, README and operations handbook, tests, client staff walkthrough, honest feature status, and human-owned maintenance plan. Tentative milestones remain subject to available time and external platform access; no untested feature should be represented as complete.

## 8. Deferred capabilities

- Automatic analysis of an uploaded image for aesthetic/brand quality; photo touch-ups via external editor after approvals and review.
- Recommending changes throughout restaurant operations (products, service, vendors) instead of marketing only.
- Local/private Gemma model hosting.
- Direct automated Google Business Profile or website CMS changes.
- Live POS/reservation API syncing, advanced attribution and paid ad management.

## 9. Development and academic attribution

The capstone marketing strategy, interviews, analyses, research and client recommendations are contributions of the student team. The software developer uses VS Code and an AI coding agent; product/architecture design and review may use ChatGPT. Keep clear documentation of which work was done by whom, AI assistance used, tests actually run and client validation completed. Do not falsely present software as completed or experimental benefits as proven. Follow applicable CSUMB/CSU course AI-use and disclosure requirements.

## 10. Technical reference

The authoritative architecture decisions, security design, data model, embedding choice procedure, approval state machine, integrations, deployment and implementation gates appear in **`The_Pocket_AI_Architecture_v0_3.md`**. In case of a technical conflict between the older v0.2 Word PRD and architecture v0.3, use this Markdown PRD and architecture v0.3. Resolve any material business requirement conflict with the product owner; do not silently edit requirements.
