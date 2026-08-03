# OMP Always-On Rules

This top-level `RULES.md` is the OMP sticky always-apply entrypoint.

Keep shared rules in `rules/`; this profile file may summarize or point to them. For OMP-native rule discovery, `rules/*.md` is also linked into `~/.omp/agent/rules/`.

## Defaults

- Follow shared agent defaults.
- Prefer explicit verification for non-trivial changes.

## Headroom

- Headroom is enabled for OMP through `~/.omp/agent/mcp.json`; after restart or `/mcp reload`, use its MCP tools for large logs or bulky context when compression materially helps.
  Read `skill://headroom` when configuring Headroom, checking its MCP status, or deciding whether to compress/retrieve context.

## Herdr

- At session start, if `HERDR_ENV=1`, read `skill://herdr-session-titles` before beginning the user's task.
- Keep the current Herdr workspace title aligned with the session objective; PR review titles must use the exact PR title.
