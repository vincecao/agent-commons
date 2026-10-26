# Goldfish review lanes: design assessment

Goal: Elephant-Goldfish code review. The elephant is the main reviewing agent with full PR context and review state. Goldfish lanes are blind reviewers with zero context. The constraints are maximum coverage, low token cost, a simple setup, and lanes kept as blind as possible, running across Claude Code, cursor-agent, and omp on macOS (herdr, Graphite stacks), and still working when only one of those tools is installed.

## Options

| Option | Coverage | Token cost | Simplicity | Blindness |
|---|---|---|---|---|
| A. One agent, several sequential "personas" in the same session | Low: later passes are anchored on earlier ones | Medium: the diff is re-read inside one growing context | High | Poor: shared context |
| B. Subagents inside one tool (e.g. Claude Task) | Medium: one model family | Medium | Medium: tool-specific, not portable | Medium: the parent's prompt leaks its framing |
| C. Headless CLI lanes in parallel, each with a fresh process, diff-only input, an overlapping baseline plus one emphasis lens, JSON output, and a deterministic merge | High: model diversity plus overlap | Proportional to lanes x filtered diff; output is small JSON; merge is free | High: one script, no orchestration service | Strong: separate processes in an empty cwd |
| D. Like C, but each lane gets a disjoint slice of the diff | Low: misses cross-file bugs; nothing can be confirmed twice | Lowest | Medium: needs a diff splitter | Strong |
| E. Like C, plus a model-based merge/judge lane | Slightly higher precision | One more model call that reads every finding | Lower | Strong for lanes; the judge sees everything |

## Recommendation: C

Option C is the only option that has both real independence (separate processes, different models) and a way to confirm a finding without an extra model call. Each lane costs one pass over the filtered diff, and you choose how many lanes to pay for:

- **Lane count scales with risk**: 1 lane under 50 changed lines, 2 under 400, 3 above that, and one more for auth, migration, payment, or secret paths, up to 3. `--double` (6 lanes) is an explicit opt-in for risky PRs.
- **Input is capped**: lock, generated, dist, snapshot, and map files are excluded, and files past `--max-lines` are listed as not reviewed instead of being silently dropped.
- **Deltas on later rounds**: `--since <lastReviewedSha>` sends only the new commits.
- **Output stays small**: findings come back as JSON only (severity, file, line, bugClass, summary, evidence). No prose.
- **The merge is deterministic**: it drops findings on files outside the diff and style findings, clusters by bug class or nearby lines across lanes, and keeps clusters with 2+ votes or Important findings with quoted evidence.

### Overlapping lenses (deliberate)

Lenses are emphases, not partitions. Every lane runs the same baseline checklist and then digs deeper into one area: correctness and bug classes, security and data safety, or edge cases and failure paths. Disjoint lenses would make the "2+ lanes agree" rule unreachable for most bugs, because only one lane would ever look at a given class of problem. Overlap does not add tokens either. Each lane reads the whole diff regardless, so lane count drives cost, not lens breadth.

Duplicate runs are useful when the second run is *different*. `--double` runs each lens on two different tools. Running the same prompt twice on the same model mostly reproduces the same blind spots, so it is only the fallback when a single tool is installed.

### Why not E (a model judge)?

The elephant already verifies every surviving finding against source as part of `pr-inline-review`. A separate judge would pay for that verification twice and would break blindness at the merge step. It can be revisited if the deterministic merge turns out to keep too much noise.

## Blindness: what is and isn't guaranteed

Each lane is a new CLI process in an empty temporary directory. Its prompt contains only the lane instructions, `REVIEW.md`, and the diff. It never receives other lanes' output, the PR description, review threads, or the author's reasoning. Global profile files (for example `~/.claude/CLAUDE.md`) still load because the CLIs always read them. That is acceptable, since they are shared conventions, not PR context.

## Invocation

See `skills/goldfish-review/SKILL.md`. The script lives in the skill directory, so every profile that receives skills (Claude, omp, `.agents`, Codex, OpenCode, Hermes) resolves the same script through its symlink. Cursor and Gemini receive no skill directories under the current sync model, but they can still run the script by path, and cursor-agent is one of the lane tools.

## Open questions

- The omp headless flag (`omp -p`) is assumed from the pi CLI family and could not be checked here. Override it with `GOLDFISH_CMD_OMP` if it differs.
- Lane thresholds (50/400 lines) are starting points; tune them after a few weeks of review state.
