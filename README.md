# agent-commons

Shared agent rules, skills, profiles, and sync tooling for local AI agent CLIs.

`agent-commons` is a git-backed source of truth for personal agent defaults. It keeps reusable instructions in this repo, then symlinks them into each tool's native config directory so Claude, OMP, Codex, OpenCode, Gemini, Cursor, and `.agents`-based tools read the same rules/skills without duplicated files.

## What this repo does

- Stores private local rule files in ignored `rules/`.
- Stores private local Agent Skills in ignored `skills/`.
- Stores tool-specific entrypoints in `profiles/<agent>/`.
- Runs `skills/agent-commons/scripts/sync-agent-commons.ts` to install symlinks into local agent config paths.
- Backs up pre-existing user files before replacing them with managed symlinks.
- Uses `.agent-commons-id` to identify links from another `agent-commons` checkout and relink them safely.

## Quick start

```bash
gh repo clone vincecao/agent-commons ~/agent-commons
cd ~/agent-commons
pnpm install
pnpm sync --dry-run
pnpm sync
```

Target one agent:

```bash
pnpm sync --only omp
pnpm sync --only claude
pnpm sync --only opencode
pnpm sync --only hermes
```

Test against a fake home directory:

```bash
pnpm sync --home /tmp/agent-home --dry-run
pnpm sync --home /tmp/agent-home --only cursor
```

## Repository layout

```text
.
├── .agent-commons-id              # Ownership marker for safe relinking
├── rules/                         # Ignored: your private synced rule files
│   └── .gitkeep
├── skills/                        # Ignored: your private synced Agent Skills
│   ├── .gitkeep
│   └── agent-commons/             # Tracked public management skill
│       ├── SKILL.md
│       └── scripts/
│           └── sync-agent-commons.ts
├── examples/                      # Tracked examples; safe for public repo
│   ├── profiles/
│   │   └── omp/mcp.json           # Template for the ignored personal mcp.json
│   ├── rules/
│   │   ├── defaults.md
│   │   └── rtk.md
│   └── skills/
│       └── example-skill/
│           └── SKILL.md
├── profiles/                      # Tracked agent-specific entrypoints
│   ├── agents/README.md
│   ├── claude/CLAUDE.md
│   ├── claude/RULES.md            # Ignored: employer-specific conventions
│   ├── codex/AGENTS.md
│   ├── cursor/rules/agent-commons.mdc
│   ├── gemini/GEMINI.md
│   ├── omp/RULES.md
│   ├── omp/TITLE_SYSTEM.md
│   ├── omp/extensions/            # OMP extensions linked into ~/.omp/agent
│   ├── omp/mcp.json               # Ignored: machine-specific MCP servers
│   └── opencode/AGENTS.md
├── src/
│   ├── fs-utils.ts
│   ├── linker.ts                  # Safe symlink/backup behavior
│   ├── sections.ts                # Agent path mapping
│   └── sync.ts                    # Core sync orchestration
└── tests/
    ├── fs-utils.test.ts
    └── sync.test.ts
```

## Private content policy

`rules/` and `skills/` are intentionally gitignored so personal prompts, workflows, and local machine assumptions do not get pushed by accident. Tracked exceptions are the public skills `skills/agent-commons/` (management skill and sync CLI) and `skills/obsidian-vault/`. Individual profile files join the ignore list when they carry absolute machine paths or employer-specific conventions.

```gitignore
/rules/*
!/rules/.gitkeep
/skills/*
!/skills/.gitkeep
!/skills/agent-commons/
!/skills/agent-commons/**
!/skills/obsidian-vault/
!/skills/obsidian-vault/**
/Agent Learning/
/.obsidian/
/profiles/omp/mcp.json
/profiles/claude/RULES.md
```

Everything on that list is backed up by the private repo described in [Private payload backup](#private-payload-backup).

Use `examples/` for public templates. Copy examples into the ignored live directories when you want to activate them:

```bash
cp examples/rules/defaults.md rules/defaults.md
cp -R examples/skills/example-skill skills/example-skill
pnpm sync
```

## Private payload backup

Two repos share one working tree at `~/agent-commons`:

| Repo | Git dir | Visibility | Owns |
|---|---|---|---|
| `vincecao/agent-commons` | `.git` | public | harness: `src/`, `examples/`, `profiles/`, `skills/agent-commons/`, `skills/obsidian-vault/` |
| `vincecao/agent-commons-sync` | `.git-private` | private | everything the public repo ignores: `rules/`, private `skills/*`, `Agent Learning/`, `.obsidian/`, machine-specific profile files |

The payload is exactly the set of files the public `.gitignore` excludes, minus build output and machine junk, so privatizing one more file means adding it to `.gitignore` and running `pnpm backup save` — no list to maintain in two places. `skills/agent-commons/scripts/private-backup.sh` drives the private git dir over the same worktree and force-adds that set, because the worktree `.gitignore` outranks `.git-private/info/exclude` and an ignore inversion inside the private git dir would silently match nothing.

Profile entrypoints stay public so a fresh clone of the harness alone still links working defaults. Only files that cannot be shared move to the payload: `profiles/omp/mcp.json` (absolute binary paths for local MCP servers, with a shareable template in `examples/profiles/omp/mcp.json`) and `profiles/claude/RULES.md` (employer-specific ticket conventions).

```bash
pnpm backup init            # once per machine: create .git-private, wire the remote
pnpm backup save            # stage + commit payload changes
pnpm backup push            # publish to the private remote
pnpm backup status          # tracked payload count + dirty tracked files
pnpm backup git log --stat  # any git command against the private repo
```

Override the remote with `AGENT_COMMONS_PRIVATE_REMOTE`.

### New machine

```bash
gh repo clone vincecao/agent-commons ~/agent-commons
cd ~/agent-commons
bash skills/agent-commons/scripts/private-backup.sh restore
pnpm install
pnpm sync
```

`restore` clones the private repo into `.git-private` and checks the payload out into the worktree; it refuses to clobber existing local files unless you pass `--force`. `pnpm sync` then links the restored rules, skills, and profiles into every agent section (claude, omp, codex, cursor, …).

Without the private repo the harness still works on its own — `pnpm sync` links the public profiles, and personal content starts empty:

```bash
cp examples/profiles/omp/mcp.json profiles/omp/mcp.json
cp examples/rules/defaults.md rules/defaults.md
```

No path is tracked by both repos, so `git status` stays clean on both sides: the public repo ignores the payload, and the private repo tracks only payload paths (`status.showUntrackedFiles=no` keeps public-repo files out of its view). `pnpm backup save` untracks anything that later becomes public-tracked, so the two sets cannot drift into overlap.

## Dynamic linking model

The sync command scans repo content. Adding a new private rule, skill, or profile file usually needs no script change.

```text
skills/*/SKILL.md        -> every configured skill root
rules/*.md, rules/*.mdc  -> every configured rule root
profiles/<agent>/**      -> that agent's profile root, preserving nested paths
```

Examples:

```text
skills/release-helper/
└── SKILL.md
```

```markdown
<!-- rules/code-review.md -->
---
description: Shared review standards
alwaysApply: false
---

# Code Review

- Report only actionable findings.
- Include exact file and line when possible.
```

```markdown
<!-- profiles/omp/RULES.md -->
# OMP Always-On Rules

Use shared defaults and verify non-trivial changes.
```

Then re-run:

```bash
pnpm sync
```

## Supported agents and frameworks

| Section | Profile root | Skills root | Rules root | Notes |
|---|---|---|---|---|
| `claude` | `~/.claude/**` | `~/.claude/skills/*` | `~/.claude/rules/*` | Uses `CLAUDE.md` as profile entrypoint. |
| `omp` | `~/.omp/agent/**` | `~/.omp/agent/skills/*` | `~/.omp/agent/rules/*` | Top-level `RULES.md` is OMP's sticky always-apply entrypoint. |
| `agents` | `~/.agents/**` | `~/.agents/skills/*` | `~/.agents/rules/*` | Generic `.agents` convention used by multiple tools. |
| `codex` | `~/.codex/**` | `~/.codex/skills/*` | `~/.codex/rules/*` | Uses `AGENTS.md` as profile entrypoint. |
| `opencode` | `~/.config/opencode/**` | `~/.config/opencode/skills/*` | — | Uses `AGENTS.md` plus skill directories. |
| `gemini` | `~/.gemini/**` | — | — | Uses `GEMINI.md` as profile/context entrypoint. |
| `cursor` | `~/.cursor/**` | — | `~/.cursor/rules/*` | Uses `.mdc`/Markdown rules. |
| `hermes` | `~/.hermes/**` (opt-in) | `~/.hermes/skills/*` | — | Skills-only by default: skills link flat as `~/.hermes/skills/<name>/` (Hermes also supports category dirs). No native rules dir. No profile files ship, so Hermes's own `SOUL.md` is never touched; create `profiles/hermes/SOUL.md` to opt in to managing it. |

## Skill format

Shared skills use the Agent Skills convention: one directory per skill, with `SKILL.md` as the entrypoint.

```text
skills/my-skill/
└── SKILL.md
```

```yaml
---
name: my-skill
description: >
  Trigger-oriented description. Mention when the skill should be used.
---
```

```markdown
# My Skill

Operational instructions go here.
```

## Sync behavior and safety

```bash
pnpm sync --help
```

Rules:

- Missing destination: create symlink.
- Correct symlink: leave untouched.
- Existing regular file/dir: move to `*.backup.<timestamp>`, then install commons symlink.
- Existing user symlink: move to `*.backup.<timestamp>`, then install commons symlink.
- Existing agent-commons-owned symlink: relink to the current checkout without backup.
- Missing source or missing `.agent-commons-id`: hard fail.
- Dry run prints all operations without writing.

This means first sync migrates local manual files into backups. After that, agent config locations stay in sync with this repo through symlinks.

Hermes-specific caveat: Hermes's `~/.hermes/SOUL.md` is the agent's system prompt (Nous-authored by default). This repo ships no `profiles/hermes/` files, so syncing the `hermes` section only adds skill symlinks and never touches `SOUL.md` or any other Hermes config. To manage `SOUL.md` from this repo, create `profiles/hermes/SOUL.md` yourself — the next sync then backs up the existing file as `SOUL.md.backup.<timestamp>` before linking. Keep that file agent-facing only: it ships as prompt bytes in every Hermes conversation. Hermes has no native rules directory, so `rules/*.md` are not linked for this section.

## For agents editing this repo

- Treat `rules/` and `skills/` as private local state; they are ignored by git on purpose.
- Keep only public/shareable skills under explicit `.gitignore` allowlists such as `skills/agent-commons/`.
- Put public/shareable examples under `examples/`, not live `rules/` or private `skills/`.
- Keep tool-specific entrypoints under `profiles/<agent>/`.
- Do not hardcode new file names in sync logic unless adding a new agent section.
- Update `SECTION_NAMES` and `SECTION_CONFIGS` in `src/sections.ts` when adding a new supported framework.
- Preserve backup-first behavior for existing user files/links.
- Run verification before committing:

```bash
pnpm typecheck
pnpm test
pnpm test:coverage
pnpm build
```

## Adding another agent section

Agent paths are configured in `src/sections.ts`:

```typescript
const SECTION_CONFIGS = {
  omp: {
    profileRoot: [".omp", "agent"],
    skillsRoot: [".omp", "agent", "skills"],
    rulesRoot: [".omp", "agent", "rules"],
  },
} as const;
```

Add a framework by adding:

1. `profiles/<name>/` with native entrypoint files,
2. `<name>` to `SECTION_NAMES`,
3. `<name>` in `SECTION_CONFIGS`.

Use `null` for unsupported roots:

```typescript
const SECTION_CONFIGS = {
  gemini: {
    profileRoot: [".gemini"],
    skillsRoot: null,
    rulesRoot: null,
  },
} as const;
```

## Development

```bash
pnpm install
pnpm sync --dry-run
pnpm typecheck
pnpm test
pnpm test:coverage
pnpm build
```

## License

MIT
