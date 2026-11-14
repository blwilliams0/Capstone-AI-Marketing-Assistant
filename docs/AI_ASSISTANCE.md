# AI Assistance and Contribution Record

Required by the architecture specification (section 13) and CSUMB course AI-use disclosure expectations. The product owner should review and complete the sections marked *Owner to complete*. Nothing here should be edited to claim work that was not done.

## Tools used on the software

| Tool | Role | What it did |
|---|---|---|
| ChatGPT | Requirements, architecture and product design; review | Helped draft the PRD, architecture and instructions in the four `The_Pocket_*.md` files. |
| Qwen Code | Initial implementation (Stage 1, first pass, 2026-11-04) | Created the first monorepo files. Its work did not install, compile or run; much of it was corrupted by PowerShell file-writing. Its own report claimed completion, which testing did not support. |
| Codex | Independent review | An audit was mentioned in the project brief. **No Codex audit file was found in the repository.** *Owner to provide it if one exists.* |
| Claude Code (Claude Sonnet 5.5 and Opus 5.5) | Stage 1 inspection and remediation (2026-11-08) | Verified the first pass, rebuilt the broken parts, added tests and wrote the remediation documents. |

## Human contributions

- **Product owner (student):** directed the AI-assisted development, made the scope, package-manager, schema and verification decisions recorded in `docs/DECISIONS.md`, and owns review and acceptance of the code. *Owner to complete: describe the specific work you did personally.*
- **Capstone team:** marketing strategy, interviews, analyses, research and client recommendations. *Owner to complete: list teammates and their contributions.*

## Tests actually run

See `docs/TEST_LOG.md` for real command output. Tests against the live Supabase project, a real browser and the real client have **not** been run.

## Client validation

None yet. No client data, real accounts or live AI services have been used.


### Project Owner — Development Contributions

The Pocket AI Marketing Assistant has been developed under my direction as part of my CSUMB Strategic Management Capstone.

I have led the hands-on development process to date, including defining the application's purpose, functionality, technical requirements, development priorities, and implementation stages.

My responsibilities have included:

- Identifying and translating the restaurant's marketing challenges into software requirements.
- Directing the application architecture, technology selection, AI model strategy, security requirements, and development workflow.
- Working directly in Visual Studio Code to coordinate AI-assisted software development.
- Preparing instructions for coding agents, reviewing their results, identifying deficiencies, and directing corrective work.
- Creating and configuring the development environment, Supabase project, and Git/GitHub repository.
- Coordinating implementation, independent code review, debugging, testing, and Stage 1 remediation.
- Managing project documentation, development priorities, costs, and planned client handoff.

**AI assistance:** Qwen Code generated the original Stage 1 implementation. Claude Code subsequently inspected, repaired, and tested the application. ChatGPT contributed to product requirements, architecture, technical guidance, and development planning. Codex was consulted for independent review.

I have personally directed and managed this development process. AI tools have assisted with code generation, analysis, implementation, and testing.

The capstone team's broader marketing research and strategy development are collaborative. Individual team contributions to those deliverables should be credited separately.

**Current implementation status:** Stage 1 has reportedly passed offline verification, including 76 automated tests. Live Supabase integration and browser verification remain outstanding.