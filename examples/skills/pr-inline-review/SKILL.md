---
name: pr-inline-review
description: >
  Use when the user asks to review a PR, check a Graphite URL, run inline PR review,
  or says "another round", "check carefully again", "submit", "mark resolve", or
  "load latest remote comments". Implements Anthropic's solving-code-review convergence
  practices: tagged findings, round-capped review, incremental re-review, and persistent state.
---

# PR Inline Review

Perform thorough, incremental code reviews with tagged findings, round limits, and persistent state.

## Trigger Patterns

Use this skill when the user says:
- "use inline pr review for [Graphite/GitHub URL]"
- "review this PR"
- "another round"
- "check carefully again"
- "submit" / "submit review"
- "mark resolve" / "resolve comments"
- "load latest remote comments"
- "why did CI fail"

## Core Principles (Anthropic Convergence Practices)

1. **Tagged Findings**: Every finding MUST be tagged as one of:
   - `[Important]` — Bugs, security issues, correctness problems, data loss risks
   - `[Nit]` — Style, naming, minor improvements (max 3 per round after round 1)
   - `[Pre-existing]` — Issues that existed before this PR (note but don't block)

2. **Round-Capped Review**: Default maximum of **3 review rounds** per PR head lineage
   - Override phrase: "deep review" or "risky PR" — use when critical systems or security involved
   - After 3 rounds, report findings and recommend merge or reject

3. **Incremental Re-Review**: After round 1, only review the diff since the last reviewed SHA
   - Never re-raise a finding that was already raised and addressed
   - Check that previous findings were actually resolved

4. **Bug Class Detection**: When a bug is found, scan the entire diff for the same bug class
   - Example: If null check is missing in one place, check all similar patterns
   - Report all instances of the same bug class in one finding

5. **Evidence Required**: Every finding MUST include exact file and line reference
   - Format: `path/to/file.ts:123` or `path/to/file.ts:123-456` for ranges
   - No vague references like "in the handler" without line numbers

6. **Style Findings**: Drop pure style findings UNLESS a lint rule would catch them
   - Focus on actionable, correctness-oriented feedback
   - Style suggestions only if they impact readability significantly

## Review State Persistence

Store review state in `.agent-review-state/<pr-number>.json` (relative to repo root):

```json
{
  "prUrl": "https://github.com/org/repo/pull/123",
  "prNumber": 123,
  "headSha": "abc123def456",
  "lastReviewedSha": "abc123def456",
  "reviewRound": 1,
  "findings": [
    {
      "id": "finding-1",
      "severity": "Important",
      "file": "src/handler.ts",
      "line": 45,
      "endLine": 47,
      "summary": "Missing null check before dereference",
      "status": "open",
      "raisedInRound": 1,
      "resolvedInRound": null
    }
  ],
  "submittedAt": "2026-10-26T19:00:00Z"
}
```

### State Management

- **First Review**: Create state file with initial findings
- **Subsequent Rounds**: 
  - Load existing state
  - Increment `reviewRound`
  - Update `lastReviewedSha` to current head
  - Mark addressed findings as resolved
  - Add only new findings
- **Cross-Agent Access**: Other agents can read this state to continue reviews

### Directory Setup

Create `.agent-review-state/` at repo root on first use:

```bash
mkdir -p .agent-review-state
echo "# Agent-generated review state - safe to gitignore" > .agent-review-state/README.md
```

Add to `.gitignore` if not present:

```bash
# Agent review state (local only)
.agent-review-state/
```

## Workflow

### 1. Initial Setup (Round 1)

```bash
# Load PR details
gh pr view [PR_NUMBER] --json url,number,title,headRefOid,baseRefOid

# Get full diff
gh pr diff [PR_NUMBER] > /tmp/pr-diff.txt

# Check for existing state
if [ -f ".agent-review-state/${PR_NUMBER}.json" ]; then
  # Load and check round count
  # If >= 3 and no override, warn and exit
fi

# Create state file
mkdir -p .agent-review-state
```

#### Review Process

1. Scan entire diff for:
   - Logic errors and bugs ([Important])
   - Security vulnerabilities ([Important])
   - Potential data loss or race conditions ([Important])
   - Missing error handling ([Important])
   - Bug classes (check all instances)

2. Note style issues only if lint-catchable or significantly impact readability

3. For each finding:
   - Assign unique ID (`finding-N`)
   - Tag severity
   - Record exact file:line or file:line-endLine
   - Write clear, actionable summary
   - Store in state with `status: "open"`

4. Generate summary:
   ```
   PR Review Summary (Round 1)
   - Important: 3
   - Nit: 2
   - Pre-existing: 1
   
   Findings below...
   ```

### 2. Subsequent Rounds

```bash
# Load state
STATE=$(cat .agent-review-state/${PR_NUMBER}.json)

# Check round limit
ROUND=$(echo $STATE | jq -r '.reviewRound')
if [ $ROUND -ge 3 ] && [[ ! "$USER_INPUT" =~ "deep review"|"risky PR" ]]; then
  echo "Reached 3-round limit. Override with 'deep review' or 'risky PR' if needed."
  exit 0
fi

# Get incremental diff
LAST_SHA=$(echo $STATE | jq -r '.lastReviewedSha')
CURRENT_SHA=$(gh pr view $PR_NUMBER --json headRefOid -q .headRefOid)

gh api "/repos/{owner}/{repo}/compare/${LAST_SHA}...${CURRENT_SHA}" \
  --jq '.files[] | "\(.filename) \(.patch)"' > /tmp/incremental-diff.txt
```

#### Re-Review Process

1. Check if previous findings were addressed:
   - For each open finding, verify if the code changed
   - Mark as `resolved` if fixed, or update `status` if still present

2. Review only the incremental diff:
   - Apply same Important/Nit/Pre-existing tags
   - Increment round: `reviewRound += 1`
   - Add new findings to state

3. Nit cap: After round 1, max 3 nits per round
   - Focus on most impactful nits
   - Skip minor style issues

4. Update state file with new findings and resolved status

### 3. Blind Lane / Double-Confirm

For high-severity findings:

1. **Blind Lane**: Review the file independently without seeing other findings first
2. **Double-Confirm**: After initial review, re-check [Important] findings to ensure accuracy
3. If a bug class is detected, scan entire diff for all instances

### 4. Submit Review

When user says "submit":

1. Format findings for GitHub/Graphite:
   - Group by file
   - Include severity tag in comment
   - Link to line numbers

2. Post review comments:
   ```bash
   # GitHub
   gh pr review $PR_NUMBER --comment --body "..."
   
   # For inline comments
   gh api /repos/{owner}/{repo}/pulls/$PR_NUMBER/comments \
     -f body="[Important] Missing null check" \
     -f commit_id="$HEAD_SHA" \
     -f path="src/handler.ts" \
     -f line=45
   ```

3. Update state:
   ```json
   {
     "submittedAt": "2026-10-26T19:30:00Z",
     "submittedInRound": 2
   }
   ```

### 5. Mark Resolve

When user says "mark resolve":

1. Load latest remote comments:
   ```bash
   gh pr view $PR_NUMBER --json comments,reviews
   ```

2. For each resolved finding:
   - Post "Resolved ✓" reply to the comment thread
   - Update local state: `status: "resolved"`

3. Cross-reference remote and local state to catch discrepancies

### 6. Load Latest Remote Comments

When user says "load latest remote comments":

```bash
# Get all review comments
gh api "/repos/{owner}/{repo}/pulls/$PR_NUMBER/comments" | \
  jq -r '.[] | "\(.path):\(.line) - \(.body)"'

# Sync with local state
# Mark findings as resolved if author replied/fixed
```

## CI Failure Workflow

When user asks "why did CI fail":

1. **List CI Runs**:
   ```bash
   gh pr checks $PR_NUMBER
   ```

2. **Get Logs for Failed Jobs**:
   ```bash
   # Find the failed run
   RUN_ID=$(gh pr checks $PR_NUMBER --json databaseId -q '.[] | select(.status == "FAILED") | .databaseId' | head -1)
   
   # Download logs
   gh run view $RUN_ID --log > /tmp/ci-failure.log
   ```

3. **Analyze Failure**:
   - Parse logs for error messages
   - Identify failing test or build step
   - Link to code changes in this PR
   - Suggest fix or explain pre-existing issue

4. **Report**:
   ```
   CI Failure Analysis
   Job: test-suite
   Step: Unit tests
   Error: TypeError: Cannot read property 'foo' of undefined
   Location: src/handler.spec.ts:123
   Cause: New code in handler.ts:45 doesn't handle null case
   Fix: Add null check before accessing property
   ```

## Graphite-Specific Support

For Graphite stacks (magicaltome/lightfield pattern):

```bash
# Use gt CLI if available
gt log --oneline

# For stack context, check dependent PRs
gt stack --json

# Review stack dependencies
# - Note if this PR depends on unmerged parent
# - Check if child PRs will be affected
```

## Output Format

### Summary (Always First)

```
PR Review Summary (Round N of 3)
PR: #123 - Add new authentication handler
Head SHA: abc123d

Findings:
- Important: 2
- Nit: 1
- Pre-existing: 0

Review status: Ready for merge after addressing Important findings / Needs another round / Recommend rejection
```

### Findings

```
## [Important] Missing null check in authentication handler
**File**: `src/auth/handler.ts:45-47`
**Status**: Open (Round 2)

The `user` object is dereferenced without null check:
```typescript
const token = user.authToken; // user could be null
```

**Fix**: Add null guard:
```typescript
if (!user?.authToken) {
  throw new AuthError("User not authenticated");
}
const token = user.authToken;
```

**Bug Class Check**: Scanned entire diff - similar pattern found in:
- `src/auth/middleware.ts:89`
- `src/api/session.ts:123`

---

## [Nit] Consider extracting magic string
**File**: `src/config/constants.ts:12`
**Status**: Open (Round 1)

Hardcoded string "production" appears 3 times. Consider extracting to constant.
```

## State File Format Reference

```typescript
interface ReviewState {
  prUrl: string;
  prNumber: number;
  headSha: string;
  lastReviewedSha: string;
  reviewRound: number;
  maxRounds: number; // default 3, or higher if "deep review" override
  findings: Finding[];
  submittedAt?: string; // ISO timestamp
  submittedInRound?: number;
}

interface Finding {
  id: string; // "finding-N"
  severity: "Important" | "Nit" | "Pre-existing";
  file: string; // relative path
  line: number;
  endLine?: number; // for ranges
  summary: string; // one-line description
  details?: string; // full explanation
  bugClass?: string; // if part of a bug class, shared identifier
  status: "open" | "resolved" | "wontfix";
  raisedInRound: number;
  resolvedInRound?: number;
}
```

## Error Handling

- **Missing gh CLI**: Prompt user to install GitHub CLI or provide PR URL
- **Missing gt CLI**: Fall back to GitHub API for Graphite PRs
- **State file corruption**: Back up and recreate
- **Network errors**: Retry with exponential backoff (max 3 attempts)

## Goldfish Lanes (Blind Parallel Review)

For large or risky PRs, or when the user asks for a goldfish, blind, or parallel review, read the `goldfish-review` skill and run its script before writing findings. Its lanes see only the diff, `REVIEW.md`, and one lens, and they share a baseline checklist on purpose so the 2-lane confirmation can work. Treat merged lane findings as candidates: verify each one at `file:line` against current source, then apply the rules above (severity tags, no re-raising, round cap). On round 2 and later, pass `--since <lastReviewedSha>` so lanes only see the delta.

## Notes

- Review state is local only (gitignored) - it's for agent continuity, not team sharing
- Other agents can read state files to pick up review context
- State files persist across sessions - review can span days
- If PR is force-pushed (head SHA changes but round incomplete), treat as new round
