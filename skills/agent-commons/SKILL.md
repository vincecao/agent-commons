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

## Private payload backup

The gitignored payload (`rules/`, private `skills/*`, `Agent Learning/`, `.obsidian/`) is versioned by a second git dir, `.git-private`, pushed to the private repo `vincecao/agent-commons-sync`. The public repo never sees it.

```bash
pnpm backup save && pnpm backup push
pnpm backup status
```

Fresh machine, after cloning the public repo:

```bash
bash skills/agent-commons/scripts/private-backup.sh restore
pnpm install && pnpm sync
```

Payload selection is an explicit `add -f` pathspec in `scripts/private-backup.sh`; worktree `.gitignore` outranks `.git-private/info/exclude`, so never switch it to ignore-inversion. Public-tracked paths (`skills/agent-commons/`, `skills/obsidian-vault/`, `.gitkeep`) stay excluded so no path is owned by both repos.

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
