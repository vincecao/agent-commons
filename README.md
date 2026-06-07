# agent-commons

Shared rules, skills, profiles, and sync script for local AI agent CLIs.

Keep agent defaults in one git-backed repo. `scripts/sync-agent-defaults.sh` symlinks them into each agent's native config paths.

## Layout

```
.
├── rules/                    # shared rule files; all files are linked dynamically
│   └── defaults.md
├── skills/                   # Agent Skill directories; each must contain SKILL.md
│   └── example-skill/
│       └── SKILL.md
├── profiles/                 # agent-specific entrypoint files; linked dynamically
│   ├── claude/
│   │   └── CLAUDE.md
│   ├── omp/
│   │   └── RULES.md
│   ├── codex/
│   │   └── AGENTS.md
│   └── agents/
│       └── README.md
└── scripts/
    └── sync-agent-defaults.sh
```

## How linking works

Dynamic discovery:

- `skills/*/SKILL.md` → linked into every enabled agent skill directory
- `rules/*.md` and `rules/*.mdc` → linked into shared rule directories
- `profiles/<agent>/**` → linked into that agent's native config root, preserving relative paths

Default agent roots:

| Section | Profile root | Skills root | Rules root |
|---|---|---|---|
| `claude` | `~/.claude` | `~/.claude/skills` | `~/.claude/rules` |
| `omp` | `~/.omp/agent` | `~/.omp/agent/skills` | `~/.omp/agent/rules` |
| `agents` | `~/.agents` | `~/.agents/skills` | `~/.agents/rules` |
| `codex` | `~/.codex` | `~/.codex/skills` | `~/.codex/rules` |

## Usage

Preview all links:

```bash
./scripts/sync-agent-defaults.sh --dry-run
```

Link all sections:

```bash
./scripts/sync-agent-defaults.sh
```

Target one section:

```bash
./scripts/sync-agent-defaults.sh --only omp
./scripts/sync-agent-defaults.sh --only claude
```

Set a different home directory for testing:

```bash
./scripts/sync-agent-defaults.sh --home /tmp/agent-home --dry-run
```

## Safety

- Correct symlink: left untouched.
- Wrong symlink: relinked.
- Existing real file/dir: moved to `*.backup.<timestamp>`.
- Missing source: hard fail.

## Customize

Add a skill:

```text
skills/my-skill/SKILL.md
```

Add a shared rule:

```text
rules/my-rule.md
```

Add an agent-specific entrypoint:

```text
profiles/omp/RULES.md
profiles/codex/AGENTS.md
profiles/claude/CLAUDE.md
```

Re-run `scripts/sync-agent-defaults.sh`; no script edit needed.
