# The Pocket AI Marketing Assistant — Cost, Security & Maintenance Handbook

**Status:** Draft for client handoff; not a promise of final monthly cost.  
**Updated:** November 4, 2026  
**Scope:** Browser application using Qwen APIs, AWS Bedrock embeddings, Supabase PostgreSQL/Auth/Storage, and separate application hosting.

## 1. Who pays, and when?

- **Student development:** Use separate development accounts/projects and test data. Keep the application local until a hosted demonstration is necessary. Record all AI subscriptions and API expenses separately from the software's future operating costs.
- **Client production:** Before launch, agree in writing who owns each vendor account, payment method, domain, application code, access credentials, and ongoing billing. Ideally the restaurant controls production accounts and appoints a technical maintainer.
- **No real customer records or live social-media credentials in development** without explicit authorization and an agreed handling policy.

## 2. Monthly cost categories (actual amounts must be verified before launch)

| Category | Examples and cost driver | Primary responsibility |
|---|---|---|
| Managed data platform | Supabase subscription, PostgreSQL compute/size, storage, outbound bandwidth, backups | Account owner and maintainer |
| AI reasoning | Qwen Flash/Plus tokens, repeated/long requests, research workflows | Account owner; app enforces usage policy |
| Embeddings | AWS Bedrock Titan indexing of new/updated documents; re-indexing on model changes | Account owner; maintainer watches ingestion |
| Application hosting | Node API and scheduled worker uptime, memory, network, logs | Maintainer |
| Search and integrations | Web-search services, email, optional paid connectors | Account owner |
| Domain and monitoring | Domain renewal, errors, uptime checks, notifications | Account owner |
| Advertising | Paid advertising campaigns (separate approved marketing budget) | Management |
| **Software maintenance** | Security patches, platform/API changes, failed integrations, incident response, backups/restore tests, support, upgrades | **Assigned maintainer; can outweigh cloud fees** |

**Risk disclosure:** Even when hosted AI calls are inexpensive, paid professional maintenance can create a significant monthly expense. A client should NOT assume the app will remain free of technical support needs after the capstone ends. Obtain a separate support estimate or assign a capable technical owner. No unverified savings/ROI guarantees.

## 3. Spending controls — set these BEFORE enabling real paid APIs

### Alibaba Cloud Model Studio (Qwen)
1. Open Model Studio console → **Cost and Usage → Budget Management**.
2. Set a separate **development workspace/API-key monthly budget**, low initial limit, and notification threshold (e.g., 50% and/or 80% where configurable).
3. Where available for pay-as-you-go calls, choose **Stop Service When Budget Reached** for development. This may interrupt requests and isn't an absolute instantaneous cap; some charges can arrive during processing delay and some charge types are excluded.
4. Configure alerts to an email actively monitored; inspect usage regularly.
5. Before production, set a separate production budget approved by management and implement application-level limits (per-user usage, daily token caps, max retrieved context, operation timeout).

Reference: https://www.alibabacloud.com/help/en/model-studio/budget-management

### AWS (Bedrock embeddings)
1. BEFORE the first real invocation, enable AWS billing notifications and create an **AWS Budget** (monthly cost budget, ideally scoped to Bedrock as well as account total) with email alerts at multiple thresholds.
2. AWS Budgets are principally **alerts, not a universal hard spending cap**; the billing data may lag. Review any available spend-limit features and whether they apply to the account/service; do not assume they automatically block Bedrock.
3. Use a dedicated least-privileged IAM identity for Bedrock embedding calls, region restrictions, limited concurrency, request-size caps, and application-level usage throttles. Never put AWS secrets in the browser.
4. Make re-indexing a deliberate, observable operation; prevent infinite retry loops and duplicate indexing.

References: https://aws.amazon.com/aws-cost-management/aws-budgets/ ; https://docs.aws.amazon.com/cost-management/latest/userguide/bcm-lite-use-budget.html

### Supabase
1. **Development:** stay on the Free plan until there is a demonstrated need for paid capacity. Free isn't billed for normal usage but projects may pause or face limits.
2. **Production:** evaluate Pro, enable **Spend Cap** (Billing → Cost Control) if using Pro, and monitor the Upcoming Invoice and Usage pages. The spend cap covers certain usage overages but **does not cover compute, additional projects, and various add-ons**.
3. Avoid accidentally creating multiple paid projects or upgrading compute tiers without approval.
4. Use private storage, authentication, row-level security, minimal retention, appropriate backup/restore procedures.

References: https://supabase.com/docs/guides/platform/cost-control ; https://supabase.com/docs/guides/platform/manage-your-usage/compute

### Application hosting and other vendors
- Enable spending/usage alerts where offered; select a small fixed-size plan initially; require explicit approval to increase service size or enable new paid services.
- Log usage by provider without storing secrets or customer PII in logs.
- Before enabling live publishing, verify account ownership, authorizations, permissions, and rollback/incident contacts.

## 4. Support responsibilities and escalation

**Restaurant management:** owns brand strategy, authorized users, publishing/marketing approval, vendor spending budgets, and final content decisions.  
**Marketing lead (staff):** ensures current menu/events, checks drafts, handles calendar and metrics, reports errors.  
**Technical maintainer (must be assigned):** monitors services/bills, updates dependencies, rotates credentials, manages backups, diagnoses failures, tests connector changes, verifies restore, and responds to security events.

**Failure policy:** On security concerns, missing approval, unverifiable menu claims, expired credentials, or exhausted budget, stop the affected action and inform the responsible person. Never silently publish or switch to unapproved AI regions/providers.

## 5. Pre-handoff checklist

- [ ] Restaurant approves recurring operating budget and explicitly acknowledges maintenance costs.
- [ ] Production vendor accounts and billing owners are identified (not tied permanently to a student's personal card).
- [ ] App spending limits, supplier alerts, and responsible recipients configured and tested.
- [ ] Private data classification, retention/deletion, backup, and recovery policies agreed.
- [ ] Management and employee access reviewed; MFA enabled where supported.
- [ ] Social integrations tested with approved permissions; publishing audit logs validated.
- [ ] Written instructions for passwords/credential rotation, account recovery, and support contacts delivered securely.
- [ ] Backup restoration tested; clear process for transferring code and infrastructure ownership documented.
- [ ] Limitations (no guaranteed booking uplift, reporting/attribution uncertainty, integration dependencies) disclosed.

## 6. Monthly operating review template

| Item | Amount / Result | Owner / Follow-up |
|---|---|---|
| Supabase actual invoice | | |
| Qwen inference bill | | |
| AWS Bedrock bill | | |
| Hosting / search / notifications | | |
| Advertising (separate) | | |
| Maintenance hours and cost | | |
| API errors, blocked posts, security events | | |
| Next-month planned changes or budget approvals | | |

**Document ownership:** This document is a client-operations draft and must be validated against actual deployment, supplier plan terms, and support arrangement before handoff.
