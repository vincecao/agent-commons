---
name: obsidian-vault
description: >-
  Safe agent workflows inside an Obsidian vault (a folder containing `.obsidian/`).
  Use whenever reading/writing markdown in a vault: link conventions, YAML
  frontmatter/properties discipline, renames without breaking wikilinks, what to
  gitignore, generated-content hygiene, and when to upgrade from plain filesystem
  access to the Local REST API MCP. Trigger on: "obsidian", "vault", "wikilink",
  "frontmatter/properties", "daily notes", or when a target folder contains `.obsidian/`.
---

# Obsidian Vault — agent read/write rules

A vault is just a folder of markdown + a `.obsidian/` config dir. Plain filesystem access is the default integration; the rules below prevent the known breakage modes. (Ecosystem snapshot: 2025-2026.)

## Detect + respect the vault

- A dir containing `.obsidian/` is a vault. Its `.md` files may carry wikilinks and YAML properties that Obsidian parses — treat both as structured data, not free text.
- Check `.obsidian/app.json → userIgnoreFilters` before linking to generated dirs: excluded paths must not be wikilinked.
- Vault-level config worth tracking in git: `app.json`, `daily-notes.json`, `core-plugins.json`, community plugin configs. Always gitignore: `.obsidian/workspace*.json` (conflicts on every open), `.obsidian/cache/`, `.trash/`.

## Links

- **Wikilinks `[[Note]]` are the vault default** (backlinks pane, graph, in-app auto-rename). Markdown relative links are acceptable for cross-references into code/data files.
- **Verify the target exists (grep/glob) before writing a wikilink.** Placeholder links to nonexistent notes litter the graph — the #1 agent-generated mess.
- No `# | ^ : %` in note filenames (collide with link syntax).

## Renames / moves — the silent killer

- **NEVER rename or move a note with plain `mv`.** Obsidian updates inbound wikilinks only for renames done in-app; an agent `mv` breaks every inbound link silently.
- Options, in order: (1) leave renames to the human; (2) grep all inbound `[[OldName]]`/`[[OldName|` references and fix them in the same change; (3) use `obsidian-cli move` (Yakitrak/notesmd-cli — updates links) if installed.

## Frontmatter / properties

- Schema-first: exact key names, correct YAML types (numbers unquoted, lists as `[a, b]`, dates `YYYY-MM-DD`). Wrong types break Bases/Dataview queries.
- Edit keys surgically. Never rewrite the whole YAML block from memory; never delete keys you don't understand; never emit duplicate keys or tabs.
- Frontmatter properties (not inline `key:: value` Dataview fields) are the 2025+ convention — the core **Bases** plugin reads them natively.

## Generated vs human content

- Agent-generated artifacts (HTML, JSON DBs, build output) stay OUT of the note graph: exclude via `userIgnoreFilters`, never wikilink them.
- Keep agent-owned note territory separate from human-owned prose (per-type folders or a `generated/` tree); living human documents change via reviewed diffs only.
- Dated notes: point the Daily Notes core plugin at the existing log folder (`folder` + `format` in `.obsidian/daily-notes.json`) — existing `YYYY-MM-DD.md` files become daily notes with zero moves.

## Sync safety

- Git is the safest sync layer for an agent-written vault. Live cloud sync (iCloud/Obsidian Sync) + direct agent writes has caused partial-write corruption in the field — if cloud sync is on, avoid long write bursts while the app is open and commit promptly.
- Obsidian auto-reloads externally-changed **notes**; conflict risk is only agent+human editing the same open note simultaneously. `.obsidian/*.json` config is different: read at startup and rewritten from memory on settings changes — a disk edit while the app is open can be silently reverted. Config changes require an app restart (or making the change in the Settings UI instead).

## Integration ladder (escalate only when needed)

1. **Plain filesystem** (default): zero friction; covers read/write-whole-note.
2. **`obsidian-cli`** (Yakitrak/notesmd-cli): link-safe move/rename, frontmatter ops from scripts.
3. **Local REST API plugin** (coddingtonbear): ships a built-in MCP server at `127.0.0.1:27124/mcp` (API-key) — surgical PATCH of headings/blocks/frontmatter keys, live metadata, Dataview execution. The canonical MCP path; most third-party Obsidian MCP servers are unmaintained.
4. **`kepano/obsidian-skills`** (official, by Obsidian's CEO): teaches agents OFM (wikilinks/embeds/callouts/properties), Bases `.base`, and JSON Canvas formats — install when authoring those formats. Never hand-edit `.canvas`/`.base` without it.

## Do-not-do list

- ❌ `mv` a note (breaks inbound links)
- ❌ freehand YAML rewrite (type/dup-key corruption)
- ❌ placeholder wikilinks (unverified targets)
- ❌ commit `.obsidian/workspace*.json`
- ❌ wikilink generated/excluded artifacts
- ❌ raw-edit `.canvas`/`.base` without the official skills
- ❌ unscoped-write MCP to a whole vault (data-destruction risk; scope or read-only)
