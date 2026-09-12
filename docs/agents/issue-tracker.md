# Issue tracker: Local Markdown

Specs and issues live as Markdown files in `.scratch/`, relative to the project root. Publishing means writing local files; it does not require Git or an external account.

## Conventions

- One feature per directory: `.scratch/<feature-slug>/`.
- Spec: `.scratch/<feature-slug>/spec.md`.
- Implementation tickets: `.scratch/<feature-slug>/issues/<NN>-<slug>.md`, one file per ticket, numbered from `01` with blockers first.
- Record `Status:` near the top. Use `ready-for-agent` for a buildable spec or ticket, `claimed` for work in progress, and `resolved` after acceptance criteria are verified. Record any blockage and its reason in the ticket.
- Record `Blocked by:` with prerequisite ticket numbers and titles, or `None`.
- Append comments under `## Comments`; preserve prior decisions and discussion.
- Reference tickets by descriptive title and path. Resolve a number within its feature directory; clarify if ambiguous across features.

## Skill operations

When a skill says “publish to the issue tracker,” create the appropriate local spec or ticket using that skill's template. When it says “fetch the relevant ticket,” read the full file including comments. When it requests the `ready-for-agent` label, record `Status: ready-for-agent` in the file. There is no separate triage workflow or triage-labels file configured.

Work a ticket only when all its blockers are resolved. Record the claimant before implementation, and record verification results before marking it resolved. Follow `AGENTS.md` for the Codex/opencode execution split.

## Wayfinding operations

- Map: `.scratch/<effort>/map.md`.
- Decision tickets: `.scratch/<effort>/issues/NN-<slug>.md`, each containing its question and `Type: research`, `prototype`, `grilling`, or `task`.
- New decision tickets use `Status: open`; claiming changes this to `claimed` and records `Assignee:`.
- Dependencies use `Blocked by:`. The frontier consists of open, unclaimed tickets whose blockers are all resolved, ordered by number.
- Resolve by appending `## Answer`, setting `Status: resolved`, and adding a brief linked pointer to the map's Decisions so far.
- Implementation tickets and decision tickets use distinct feature/effort directories to avoid numbering collisions.
