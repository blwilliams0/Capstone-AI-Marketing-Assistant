# Evaluating Advisor quality

Use fictional fixtures in an isolated tenant. Keep a versioned record of each case’s approved data, actor role, expected sources, prompt, model settings, and rubric. Include a second actor and tenant to exercise access boundaries.

| Case | What to score |
| --- | --- |
| Approved brand fact and brand voice | Factual accuracy, citation to the approved version, and agreement with a reviewer’s voice criteria |
| Local and visitor versions of the same prompt | Meaningful audience differentiation given the approved channel and audience guidance |
| Opted-in personal preferences across conversations | Appropriate level of detail and workflow emphasis, with equivalent prompts from another account receiving only its own preferences |
| Management correction | Application of the current approved rule after supersession, and absence of rejected or retired rules |
| Photo editing | Accurate use of current recipe and eligible preset, bounded adjustments, visual comparison of rendered output, and preservation of the depicted subject |
| Visual reference retrieval | Relevance of approved references and exclusion of inaccessible or obsolete assets |
| Mixed context | Correct use of the available facts, channel rules and relevant visual or preference data, with sources identified |
| Missing or contradictory material | Explicit uncertainty, a focused clarification, and no unsupported operating or menu claims |
| Unauthorized data | Zero disclosure of another tenant’s records, private photos, conversations, or feedback |

The integration tests exercise selected deterministic cases, including review provenance, edit parameters, approved version selection, asset access, memory isolation and persistence. Simulated answers cannot establish scoring for voice, relevance, or visual judgment.

For future approved live runs, fix the model version, token budget, fixtures and prompts. Compare a baseline and a context-enabled condition on the same cases. Shuffle and blind results for staff and management reviewers. Score accuracy, applicability, voice, uncertainty and provenance from 0 to 2 per applicable case, and track latency, usage and review disagreements. Treat private data exposure and unsupported factual claims as separate failure counts. Reuse the cases after changing retrieval or incorporating approved feedback. Report observed differences and reviewer disagreement before drawing conclusions.

## Phase 3 fixtures and pending evidence

Repeat paired cases for casual greetings and text follow-ups, topic changes, revoked reference images, edit requests that use indirect language, and different grid orderings that contain the same photos. Compare the provider request and rendered pixels separately. For consent-based learning, test an unpublished proposal, its approved exact version, a corrected or superseded version, and the same scenario from another tenant. Use sanitized standalone evidence and verify that neither the private note nor its conversation is included.

The editor provides bounded prior instructions and an exact current recipe. Record the normalized subject dimensions and reference IDs used by each fixture. Feed evaluation passes ordered square photos and planned/existing flags. Rate lighting, repetition, brand fit and usefulness only after authorized live cases with staff review. A simulated output or a verified payload can establish isolation and protocol behavior. Neither measures answer quality or real-world marketing impact.

Track acceptance and correction rates only with a clear denominator. Keep employee usefulness, adherence to approved knowledge, unsupported claims, privacy breaches, latency and cost as separate measures. Use a reviewed rubric, blind the baseline and context-enabled conditions, and retain anonymized reasoning for reviewer disagreements. Use only approved photos and an approved budget in live runs.

## Phase 3.5 acceptance evidence

Use the separate opt-in preview only after approval. Begin with a small fictional text batch, then separately enable subject and reference image comparisons. Capture API mode, model, latency, estimated usage and the blinded reviewer rubric. Compare the same images with and without eligible approved references. Include revoked references, shared layouts with private review history, uncertain brand claims and an indirect photo request. Score grounding, practical value, visual authenticity and uncertainty separately. Do not treat simulated output or an accepted payload as evidence of live quality.

The local fixture checks verify private document persistence, old attachment exclusion, tenant boundaries, request reservation, ordered feed persistence, and fake Instagram pagination and failure handling. Pending work includes genuine model quality, guest privacy review, structured cross-tool continuity and official account synchronization.
