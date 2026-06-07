# OMP Always-On Rules

This top-level `RULES.md` is the OMP sticky always-apply entrypoint.

Keep shared rules in `rules/`; this profile file may summarize or point to them. For OMP-native rule discovery, `rules/*.md` is also linked into `~/.omp/agent/rules/`.

## Defaults

- Follow shared agent defaults.
- Prefer explicit verification for non-trivial changes.
