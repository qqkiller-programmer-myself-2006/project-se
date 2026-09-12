# Domain docs

This project uses a single context for the restaurant system.

## Before exploring or designing

Read root `CONTEXT.md` for domain vocabulary and relevant decisions in `docs/adr/`. If these files or directories are absent, proceed; create them only when a term or decision is resolved. If a future `CONTEXT-MAP.md` exists, follow its pointers to the relevant contexts.

## Vocabulary

Use the canonical terms defined in `CONTEXT.md` in specs, tickets, design proposals, and tests. Respect the listed avoided synonyms. Keep `CONTEXT.md` a glossary: requirements, numerical policies, implementation choices, and progress belong in specs or tickets.

When terminology conflicts or is overloaded, clarify the meaning before updating the glossary through `domain-modeling`.

## Decisions

ADRs live in `docs/adr/`, numbered `0001-<slug>.md` onward. Create them when a resolved decision is hard to reverse, surprising without context, and reflects a real trade-off. Follow `domain-modeling` for their format.

If a proposal conflicts with an existing ADR, name the ADR and explain the conflict explicitly before changing the decision. Reference its reasoning instead of repeating it across documents.
