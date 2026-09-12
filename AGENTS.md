# AGENTS.md

## Language

Respond in Thai unless the user uses another language or requests otherwise. Keep code, commands, paths, and identifiers in their original language.

## Role split

Codex owns research, read-only exploration and diagnostics, architecture, planning documents, specs, and review. Codex may directly edit planning artifacts, agent instructions, skills, and non-code administrative documentation.

Delegate code changes, scaffolding, dependency installation, builds, and tests to the `opencode-executor` subagent. It executes through `D:\dev-tools\opencode\opencode.exe` with agent `build`. Give it a self-contained task with the goal, owned paths, constraints, acceptance criteria, and verification steps. Preserve other contributors' changes. Review its diff and verification report before claiming completion; send corrections back to the executor.

The last reported opencode provider configuration had no authenticated provider and only community models available. Verify current availability when needed. If the task needs a stronger provider, explain the limitation; provider login requiring credentials is performed by the user.

## Agent skills

### Issue tracker

Specs and tickets use Local Markdown under `.scratch/`. Before publishing, reading, claiming, or resolving work, read `docs/agents/issue-tracker.md`.

### Domain docs

This project uses a single domain context. Before exploration, design, specs, or review, follow `docs/agents/domain.md` for glossary and ADR usage.

### Skill workflow

Read the relevant `.agents/skills/<name>/SKILL.md` when a skill is invoked. The planning flow is `grill-with-docs` → `to-spec` → `to-tickets`; implementation goes through opencode and is reviewed afterward. Use `writing-for-agents` when authoring agent-facing instructions or task briefs. Use `handoff` only when explicitly requested. Apply available skills without assuming that every skill mentioned by another skill is installed.
