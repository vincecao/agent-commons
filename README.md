# agent-commons

Shared rules, skills, profiles, and sync script for local AI agent CLIs.

Keep agent defaults in one git-backed repo. `scripts/sync-agent-commons.sh` symlinks them into each agent's native config paths.

## Quick start

```bash
gh repo clone vincecao/agent-commons ~/agents/agent-commons
cd ~/agents/agent-commons
./scripts/sync-agent-commons.sh --dry-run
./scripts/sync-agent-commons.sh
```

Target one agent:

```bash
./scripts/sync-agent-commons.sh --only omp
./scripts/sync-agent-commons.sh --only claude
./scripts/sync-agent-commons.sh --only opencode
```

Test against a fake home directory:

```bash
./scripts/sync-agent-commons.sh --home /tmp/agent-home --dry-run
```

## Repository layout

```text
.
├── rules/                         # Shared rule files; linked dynamically
│   ├── defaults.md
│   └── rtk.md
├── skills/                        # Agent Skill directories; linked dynamically
│   └── example-skill/
│       └── SKILL.md
├── profiles/                      # Agent-specific entrypoints; linked dynamically
│   ├── agents/README.md
│   ├── claude/CLAUDE.md
│   ├── codex/AGENTS.md
│   ├── cursor/rules/agent-commons.mdc
│   ├── gemini/GEMINI.md
│   ├── omp/RULES.md
│   └── opencode/AGENTS.md
└── scripts/
    └── sync-agent-commons.sh
```

## Dynamic linking model

The script scans content, so future files need no script edits.

```text
skills/*/SKILL.md        -> every configured skill root
rules/*.md, rules/*.mdc  -> every configured rule root
profiles/<agent>/**      -> that agent's profile root, preserving paths
```

Example: add a new skill.

```text
skills/release-helper/
└── SKILL.md
```

Then re-run:

```bash
./scripts/sync-agent-commons.sh
```

Example: add a new shared rule.

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

Example: add an agent-specific profile file.

```markdown
<!-- profiles/omp/RULES.md -->
# OMP Always-On Rules

Use shared defaults and verify non-trivial changes.
```

## Supported agents and frameworks

| Section | Profile files | Skills | Rules | Notes |
|---|---|---|---|---|
| `claude` | `~/.claude/**` | `~/.claude/skills/*` | `~/.claude/rules/*` | `profiles/claude/CLAUDE.md` can `@` shared rule files. |
| `omp` | `~/.omp/agent/**` | `~/.omp/agent/skills/*` | `~/.omp/agent/rules/*` | Top-level `~/.omp/agent/RULES.md` is sticky always-apply. |
| `agents` | `~/.agents/**` | `~/.agents/skills/*` | `~/.agents/rules/*` | Standard `.agent` / `.agents` convention used by multiple tools. |
| `codex` | `~/.codex/**` | `~/.codex/skills/*` | `~/.codex/rules/*` | `AGENTS.md` is the main profile entrypoint. |
| `opencode` | `~/.config/opencode/**` | `~/.config/opencode/skills/*` | — | Uses `AGENTS.md` plus skill directories. |
| `gemini` | `~/.gemini/**` | — | — | Uses `GEMINI.md` as context/profile entrypoint. |
| `cursor` | `~/.cursor/**` | — | `~/.cursor/rules/*` | Uses `.mdc`/Markdown rules. |

The shared `skills/` layout follows the Agent Skills convention:

```yaml
---
name: my-skill
description: >
  Short trigger-oriented description. Mention when the skill should be used.
---
```

```markdown
# My Skill

Operational instructions go here.
```

## Script behavior

```bash
./scripts/sync-agent-commons.sh --help
```

Safety rules:

- Correct symlink: left untouched.
- Wrong symlink: relinked.
- Existing real file/dir: moved to `*.backup.<timestamp>`.
- Missing source: hard fail.

## Customizing sections

`scripts/sync-agent-commons.sh` has one `link_agent` call per supported section:

```bash
should_link omp && link_agent omp \
  "$TARGET_HOME/.omp/agent" \
  "$TARGET_HOME/.omp/agent/skills" \
  "$TARGET_HOME/.omp/agent/rules"
```

Add another framework by adding:

1. a `profiles/<name>/` directory,
2. a section in the `case` allow-list,
3. one `link_agent <name> <profile-root> <skills-root> <rules-root>` call.

Use an empty string for unsupported roots:

```bash
should_link gemini && link_agent gemini "$TARGET_HOME/.gemini" "" ""
```

## License

MIT
