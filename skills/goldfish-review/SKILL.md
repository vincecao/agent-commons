---
name: goldfish-review
description: >
  Blind parallel review lanes (Elephant-Goldfish "goldfish" side) across Claude Code,
  cursor-agent, and omp. Use when the user asks for a goldfish review, blind lanes,
  parallel or multi-tool review, or when pr-inline-review handles a large or risky PR.
  Each lane sees only the diff plus REVIEW.md; a cheap merge keeps findings confirmed
  by 2+ lanes or by quoted evidence.
---

# Goldfish Review

Companion to `pr-inline-review`. The reviewing agent is the elephant: it holds PR context, review state, and history. Goldfish lanes hold none of that. Each lane is a fresh headless CLI process that gets the filtered diff, the team `REVIEW.md` (if present), and one emphasis lens. Lanes never see each other's output, the author's reasoning, or the conversation.

Design rationale and the alternatives considered: `docs/goldfish-review-design.md` in the agent-commons repo.

## Run

From the PR branch checkout (any terminal, including a herdr pane; the script runs lanes in parallel itself):

```bash
# Script path is the same in every agent profile because skills are symlinked:
#   ~/.claude/skills/goldfish-review, ~/.omp/agent/skills/goldfish-review,
#   ~/.agents/skills/goldfish-review, ~/.codex/skills/goldfish-review
GOLDFISH=~/.agents/skills/goldfish-review/scripts/goldfish-review.ts

npx --yes tsx "$GOLDFISH" --base origin/main            # GitHub PR against main
npx --yes tsx "$GOLDFISH" --base <graphite-parent-branch>  # one branch of a Graphite stack
npx --yes tsx "$GOLDFISH" --since <last-reviewed-sha>    # round 2+: delta only
npx --yes tsx "$GOLDFISH" --base origin/main --double     # risky PR: each lens on two tools
npx --yes tsx "$GOLDFISH" --base origin/main --dry-run    # write lane prompts, run nothing
```

For a Graphite stack, review each branch against its parent (`gt log short` shows the parent), not against `main`. Otherwise every lane re-reviews the whole stack.

Flags: `--lanes auto|1|2|3`, `--tools claude,cursor-agent,omp`, `--review-md <path>` (defaults to `./REVIEW.md`), `--max-lines 3000`, `--timeout 900` (seconds per lane), `--out <dir>`.

Output: a summary on stdout that starts with severity counts, plus `.agent-review-state/goldfish/<sha>/merged.json` (kept and dropped findings, lanes, reviewed SHA) and each lane's raw output next to it.

## Lanes

- **Lane count** (`auto`): fewer than 50 changed lines gets 1 lane, fewer than 400 gets 2, more gets 3. Diffs touching auth, session, permission, migration, schema, payment, billing, secret, or crypto paths add one lane, up to 3.
- **Lenses overlap on purpose.** Every lane runs the same baseline checklist (correctness, security, data safety, error handling, edge cases), then digs deeper into one emphasis: `correctness` (including bug-class sweeps), `security-data`, or `edge-errors`. The overlap is what makes the 2-lane confirmation possible. With fully separate lenses, a real bug that only one lens covers could never get a second vote.
- **Diversity comes from tools, not repeated prompts.** Tools rotate across lanes. The same prompt run twice on the same model tends to repeat the same mistakes, so `--double` runs each lens on two *different* tools when they are installed (6 lanes).
- **One tool installed:** everything still works. The lanes use that tool with different lenses, and a 1-lane run behaves like a single review pass that drops findings without evidence.

## Headless commands used per tool

| Tool | Command | Override env |
|---|---|---|
| Claude Code | `claude -p <prompt>` | `GOLDFISH_CMD_CLAUDE` |
| Cursor CLI | `cursor-agent -p --output-format text <prompt>` | `GOLDFISH_CMD_CURSOR_AGENT` |
| omp | `omp -p --advisor <prompt>` | `GOLDFISH_CMD_OMP`; `GOLDFISH_OMP_ADVISOR=0` drops `--advisor` |

The override replaces the command and its flags, and the prompt is appended as the last argument. Example: `GOLDFISH_CMD_CLAUDE="claude -p --model sonnet"`. If you set `GOLDFISH_CMD_OMP`, include `--advisor` yourself.

omp's advisor is a second model that reviews the omp lane's own transcript and gives that lane notes before it answers. It is enabled per run by `--advisor` (omp `docs/advisor-watchdog.md`, "Headless runs"), and the persisted `advisor.enabled` setting is left unchanged. It stays blind because it only sees that one lane's transcript, plus omp's user-level `~/.omp/agent/WATCHDOG.md` / `WATCHDOG.yml` if you have them. The script writes no lane output until every lane has finished. The advisor model comes from omp's `advisor` role, which falls back to the `slow` role when unset. Set `modelRoles.advisor` in omp config to pick a cheaper reviewer. In print mode omp waits up to 10 minutes for final advisor reviews, so the default `--timeout` is 900 seconds. Each lane runs in an empty temporary directory, so it cannot read the repo or another lane's files. Global profile files such as `~/.claude/CLAUDE.md` still load, because the CLIs always read them.

## Merge (cheap, no model call)

1. Drop findings on files that are not in the reviewed diff, plus `style` findings.
2. Cluster by shared `bugClass`, or by the same file within 3 lines *across different lanes*. Votes are the number of distinct lanes in a cluster.
3. Keep a cluster if 2 or more lanes agree, or if it is `Important` with quoted evidence. With a single lane, keep anything that has evidence.

## How the elephant uses the result

In `pr-inline-review`, treat merged goldfish findings as candidates, not verdicts. Verify each one against the current source (open the file at `file:line`), then apply the convergence rules: severity tags, do not re-raise findings already raised or resolved in the review state, and respect the round cap. Record which goldfish run and SHA a finding came from in the per-PR review state.
