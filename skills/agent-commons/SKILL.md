---
name: agent-commons
description: >
  Manage this agent-commons repo. Use when syncing shared agent rules, skills, and profiles;
  adding a new supported agent section; or debugging symlink/backup behavior.
---

# Agent Commons

This skill owns the sync CLI and repo conventions for `agent-commons`.

## Sync

```bash
pnpm sync --dry-run
pnpm sync
```

Target one section:

```bash
pnpm sync --only claude
pnpm sync --only omp
pnpm sync --only cursor
```

## Source layout

- Private live rules: `rules/` (gitignored except `.gitkeep`)
- Private live skills: `skills/<name>/SKILL.md` (gitignored except allowlisted public skills)
- Public examples: `examples/`
- Agent entrypoints: `profiles/<agent>/`
- Sync implementation: `skills/agent-commons/scripts/sync-agent-commons.ts`

## Safety invariant

Existing manual files or user symlinks at destination paths are moved to `*.backup.<timestamp>` before installing the managed symlink. Existing agent-commons-owned links may be relinked without backup.

## Verify

```bash
pnpm typecheck
pnpm test
pnpm test:coverage
pnpm build
```
