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
│   ├── rules/
│   │   ├── defaults.md
│   │   └── rtk.md
│   └── skills/
│       └── example-skill/
│           └── SKILL.md
├── profiles/                      # Tracked agent-specific entrypoints
│   ├── agents/README.md
│   ├── claude/CLAUDE.md
│   ├── codex/AGENTS.md
│   ├── cursor/rules/agent-commons.mdc
│   ├── gemini/GEMINI.md
│   ├── omp/RULES.md
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

`rules/` and `skills/` are intentionally gitignored so personal prompts, workflows, and local machine assumptions do not get pushed by accident. The one tracked exception is `skills/agent-commons/`, which contains the public management skill and sync CLI.

```gitignore
/rules/*
!/rules/.gitkeep
/skills/*
!/skills/.gitkeep
!/skills/agent-commons/
!/skills/agent-commons/**
```

Use `examples/` for public templates. Copy examples into the ignored live directories when you want to activate them:

```bash
cp examples/rules/defaults.md rules/defaults.md
cp -R examples/skills/example-skill skills/example-skill
pnpm sync
```

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
