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
