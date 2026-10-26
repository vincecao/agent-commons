# REVIEW.md

Review rules for humans and agents in this repo. Agent review lanes read this file verbatim, so keep it short.

## What failure looks like

A review failed if it let any of these through:

- A bug that breaks a user-visible flow, corrupts or loses data, or leaks data across tenants or users.
- An auth/permission check removed, bypassed, or applied to the wrong resource.
- A migration that is not backward compatible with the currently deployed code.
- A changed API, event, or DB contract with callers left un-updated.

It also failed if it buried the author in nits, re-raised settled points, or blocked on taste.

## Severity tags (required on every finding)

- **Important**: one of the failures above, or a real bug. Blocks merge.
- **Nit**: only if a lint rule or this file would flag it. Never blocks.
- **Pre-existing**: a real problem not introduced by this diff. Note it once; do not block.

The summary starts with counts: `Important: N | Nit: N | Pre-existing: N`.

## Evidence rules

- Every finding cites `path:line` in the diff and quotes the code it is about.
- When you find a bug, check the whole diff for the same bug class and list every location in one finding.
- No pure style findings (formatting, naming taste, import order) unless a lint rule would catch them.
- UI changes need e2e evidence: a `Case | Result` table, named screenshots, and a `Caveat:` line, pinned to a commit SHA.

## Caps

- Nits: at most 3 per review round.
- Rounds: at most 3 per PR head lineage. Round 2+ reviews only the diff since the last reviewed SHA. Say `risky PR: full review` to lift the cap.
- Never re-raise a finding that was already raised, answered, or resolved.

## Paths to skip

- Lock files, generated code (`**/__generated__/**`, `*.generated.*`), snapshots, `dist/`, `build/`.
- Add repo-specific paths here (vendored code, fixtures, translations).

## Repo-specific risks

- List the 3 to 5 things that have actually broken in this repo before (e.g. "tenant id missing from queries in `packages/db`").
