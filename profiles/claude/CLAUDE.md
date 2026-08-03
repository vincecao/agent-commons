# Claude Profile

This file is managed by `agent-commons`.

@rules/workflow.md
@rules/defaults.md
@rules/rtk.md
# graphify
- **graphify** (`~/.claude/skills/graphify/SKILL.md`) - any input to knowledge graph. Trigger: `/graphify`
When the user types `/graphify`, invoke the Skill tool with `skill: "graphify"` before doing anything else.
- For codebase questions/reviews in repos with `graphify-out/`, use the existing graph as discovery context when useful. Refresh after a branch switch only when the user invokes `/graphify` or the owning review skill's objective escalation trigger fires; prefer an incremental code-only, no-visualization update and verify claims against current source.
