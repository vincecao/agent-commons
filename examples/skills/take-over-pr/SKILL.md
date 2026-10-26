---
name: take-over-pr
description: >
  Use when asked to take over a PR, address review comments, fix CI failures,
  or submit a Graphite stack. Loads remote comments, validates each, fixes issues,
  replies with what changed, resolves threads, and pushes updates.
---

# Take Over PR

Take ownership of a PR or Graphite stack: load review comments, validate and fix issues, reply to reviewers, resolve threads, and handle CI failures.

## Trigger Patterns

Use this skill when:
- "take over this PR"
- "address the review comments"
- "fix the failing CI"
- "resolve review threads"
- "submit the Graphite stack"
- "handle PR feedback"

## Core Workflow

### 1. Load Latest Remote State

```bash
# Get PR details
gh pr view $PR_NUMBER --json \
  url,number,title,body,headRefOid,baseRefOid,state,isDraft,\
  reviews,comments,reviewRequests

# Get review comments (inline code comments)
gh api "/repos/{owner}/{repo}/pulls/$PR_NUMBER/comments" \
  --paginate > /tmp/review-comments.json

# Get PR-level comments
gh api "/repos/{owner}/{repo}/issues/$PR_NUMBER/comments" \
  --paginate > /tmp/pr-comments.json

# Get CI status
gh pr checks $PR_NUMBER --json name,status,conclusion,detailsUrl \
  > /tmp/ci-status.json
```

### 2. Parse and Validate Review Comments

For each review comment:

```typescript
interface ReviewComment {
  id: number;
  path: string;
  line: number;
  body: string;
  user: { login: string };
  created_at: string;
  in_reply_to_id?: number;
  state: "PENDING" | "COMMENTED" | "APPROVED" | "CHANGES_REQUESTED";
}
```

#### Validation Checks

1. **Is it actionable?**
   - Requires code change? → Fix
   - Question? → Answer
   - Style preference? → Evaluate against lint rules

2. **Is it still relevant?**
   - Check if the code in `path:line` still exists
   - If code was already changed, mark as potentially resolved

3. **Severity assessment**:
   - Blocker: Must fix before merge
   - Important: Should fix in this PR
   - Nice-to-have: Defer to follow-up
   - Pre-existing: Out of scope

### 3. Fix Issues One By One

For each actionable comment:

```bash
# Navigate to the file
code $FILE:$LINE

# Make the change
# (use StrReplace or Write tools)

# Verify the fix
npm test -- $FILE
# or
pnpm typecheck
```

#### Track Changes

Keep a mapping:

```json
{
  "comment_id": 123456,
  "path": "src/handler.ts",
  "line": 45,
  "issue": "Missing null check",
  "action": "Added null guard with early return",
  "commit_sha": "abc123def456",
  "files_changed": ["src/handler.ts", "src/handler.test.ts"]
}
```

### 4. Reply to Each Comment

Format:

```markdown
Fixed in abc123d

**Changes**:
- Added null guard at line 45
- Added test case for null scenario in `handler.test.ts`

**Verification**:
```
✅ pnpm typecheck
✅ pnpm test src/handler.test.ts
```

Ready for re-review.
```

Post reply:

```bash
# GitHub
gh api /repos/{owner}/{repo}/pulls/$PR_NUMBER/comments/$COMMENT_ID/replies \
  -f body="Fixed in abc123d..."

# Or via gh pr comment
gh pr comment $PR_NUMBER --body "Re: @reviewer's comment on handler.ts:45 - Fixed in abc123d..."
```

### 5. Resolve Threads

After fixing and replying:

```bash
# Mark conversation as resolved (GitHub UI)
# Note: gh CLI doesn't have direct resolve command
# Use GitHub GraphQL API

gh api graphql -f query='
mutation {
  resolveReviewThread(input: {threadId: "RT_kwDOABC123"}) {
    thread {
      isResolved
    }
  }
}'
```

For Graphite:

```bash
# Graphite auto-resolves when you push fixes
gt stack submit --no-interactive
```

### 6. Commit and Push

```bash
# Stage changes
git add .

# Commit with reference to review
git commit -m "Address review feedback

- Add null check in handler.ts (fixes @reviewer comment)
- Update test coverage for null case
- Fix linting issues in config.ts

Addresses: #123 (comment 456789)"

# Push
git push origin feature-branch

# Or for Graphite stacks
gt stack submit
```

### 7. Post Summary Comment

After all fixes:

```markdown
## Review Feedback Addressed

All review comments have been addressed. Here's a summary:

### Fixed Issues

| Comment | File | Status | Commit |
|---------|------|--------|--------|
| Missing null check | `src/handler.ts:45` | ✅ Fixed | abc123d |
| Typo in error message | `src/errors.ts:12` | ✅ Fixed | abc123d |
| Extract magic number | `src/config.ts:89` | ✅ Fixed | def456a |
| Consider caching result | `src/service.ts:123` | 💬 Replied | — |

### Deferred to Follow-up

| Comment | Reason |
|---------|--------|
| Refactor to use new pattern | Breaking change - tracked in #789 |
| Add integration test | Requires test infrastructure work - tracked in #790 |

### Pre-existing Issues

| Comment | Reason |
|---------|--------|
| Fix naming inconsistency | Exists in main branch, out of scope for this PR |

### Verification

```
✅ pnpm typecheck
✅ pnpm test
✅ pnpm lint
✅ CI checks passing
```

Ready for re-review @reviewer
```

Post:

```bash
gh pr comment $PR_NUMBER --body-file /tmp/review-summary.md
```

## CI Failure Triage

When CI is failing:

### 1. Identify Failing Jobs

```bash
gh pr checks $PR_NUMBER

# Output:
# ✅ lint            pass    2m 30s
# ✅ typecheck       pass    1m 15s
# ❌ test            fail    5m 42s
# ✅ build           pass    3m 20s
```

### 2. Get Failure Logs

```bash
# Find the failing run
RUN_ID=$(gh run list --branch $BRANCH_NAME --limit 1 --json databaseId -q '.[0].databaseId')

# Download logs
gh run view $RUN_ID --log > /tmp/ci-failure.log

# Or view specific job
gh run view $RUN_ID --job $JOB_ID --log
```

### 3. Analyze Failure

Parse logs for:

```bash
# Find error messages
grep -A 10 "FAIL\|ERROR\|Error:" /tmp/ci-failure.log

# Find stack traces
grep -A 20 "at " /tmp/ci-failure.log

# Find failed test names
grep "✗\|✕\|FAILED" /tmp/ci-failure.log
```

Common failure patterns:

```typescript
// Test failure
// FAIL src/handler.test.ts
//   ✕ should handle null user (42ms)
//   
//   Expected: null check to throw
//   Received: undefined

// Type error
// Error: src/handler.ts:45:12
//   Property 'authToken' does not exist on type 'User | null'

// Lint error
// Error: 'user' is possibly 'null' (eslint: @typescript-eslint/no-unnecessary-condition)

// Build error
// Error: Cannot find module './missing-import'
```

### 4. Reproduce Locally

```bash
# Checkout the exact commit CI ran
git fetch origin
git checkout $HEAD_SHA

# Install dependencies (use exact lockfile)
pnpm install --frozen-lockfile

# Run the failing command
pnpm test src/handler.test.ts
# or
pnpm typecheck
# or
pnpm lint
```

### 5. Fix the Issue

Based on error type:

#### Test Failure

```bash
# Fix the code or test
# Re-run test
pnpm test src/handler.test.ts

# Verify fix
pnpm test  # run all tests
```

#### Type Error

```bash
# Fix type annotations or null checks
# Verify
pnpm typecheck
```

#### Lint Error

```bash
# Fix linting issues
pnpm lint --fix

# Or add exception if justified
// eslint-disable-next-line @typescript-eslint/no-explicit-any
```

#### Build Error

```bash
# Fix import paths or add missing files
# Verify
pnpm build
```

### 6. Commit Fix and Push

```bash
git add .
git commit -m "Fix CI failure: [brief description]

[Detailed explanation of what was wrong and how it's fixed]

Fixes test failure in handler.test.ts by adding proper null handling."

git push origin feature-branch
```

### 7. Monitor CI Re-run

```bash
# Wait for CI to start
sleep 10

# Check status
gh pr checks $PR_NUMBER --watch
```

### 8. Report CI Fix

```bash
gh pr comment $PR_NUMBER --body "CI failure fixed in commit abc123d

**Issue**: Test failure in \`handler.test.ts\` - missing null check
**Fix**: Added null guard and updated test expectations
**Verification**: All CI checks now passing ✅"
```

## Graphite Stack Workflow

For Graphite stacks (e.g., magicaltome/lightfield pattern):

### 1. View Stack

```bash
gt log --oneline

# Output:
# ○ abc123 (PR #125) Add validation layer
# ○ def456 (PR #124) Refactor handler
# ○ ghi789 (PR #123) Add new endpoint  ← current
# ● main
```

### 2. Check All PRs in Stack

```bash
# For each PR in stack
for pr in 123 124 125; do
  echo "=== PR #$pr ==="
  gh pr view $pr --json state,reviews,reviewDecision
  gh pr checks $pr
done
```

### 3. Address Feedback Bottom-Up

Start with the bottom PR (closest to main):

```bash
gt checkout pr-123-branch
# Address feedback
# Commit fixes
gt stack submit
```

Then move up:

```bash
gt up  # or gt checkout pr-124-branch
# Address feedback
# Commit fixes
gt stack submit
```

### 4. Handle Stack Dependencies

If a parent PR needs changes:

```bash
# Checkout parent
gt checkout pr-123-branch

# Make changes
# Commit
gt stack submit

# Rebase children
gt stack restack
```

### 5. Submit Entire Stack

```bash
# Submit all PRs in stack at once
gt stack submit --no-interactive

# Or submit with review
gt stack submit
```

### 6. Sync with Remote

```bash
# Pull latest for entire stack
gt stack sync

# Or pull just current branch
gt sync
```

## Handling Different Comment Types

### 1. Code Change Request

```markdown
Reviewer: "Add null check here"

Action:
1. Add null check
2. Add test for null case
3. Reply: "Fixed in abc123d - added null guard and test case"
4. Resolve thread
```

### 2. Question

```markdown
Reviewer: "Why did you choose this approach?"

Action:
1. Reply with explanation
2. If code can be clearer, add comment or rename
3. No resolve - let reviewer confirm understanding
```

### 3. Style Preference

```markdown
Reviewer: "Can you use const instead of let?"

Action:
1. Check lint rules - if enforced, fix
2. If not enforced, evaluate:
   - Does it improve code? → Fix
   - Pure preference? → Politely defer
3. Reply with decision rationale
```

### 4. Scope Creep

```markdown
Reviewer: "We should also refactor this entire module"

Action:
1. Agree it's valuable
2. Create follow-up issue
3. Reply: "Great idea! Tracked in #789 - keeping this PR focused on the original scope"
4. Resolve thread
```

### 5. Pre-existing Issue

```markdown
Reviewer: "This function name is inconsistent"

Action:
1. Confirm it's pre-existing
2. Reply: "Agreed - this exists in main branch. Created #790 to address naming across the codebase"
3. Resolve thread
```

## Reply Templates

### Fixed with Code

```markdown
Fixed in abc123d

**Changes**:
- [Specific change made]
- [Additional change if needed]

**Verification**:
✅ Tests pass
✅ Typecheck passes
```

### Answered Question

```markdown
Good question! [Answer]

[Optional: code example or link to docs]

Let me know if this makes sense or if you'd like me to add a code comment explaining this.
```

### Deferred to Follow-up

```markdown
Great suggestion! This is beyond the scope of this PR, but I agree it's valuable.

Created #789 to track: [brief description]

I'll tackle this in a follow-up once this PR merges.
```

### Disagreement (use sparingly)

```markdown
I considered this approach, but [technical reason for current implementation].

[Explain trade-offs]

Happy to discuss further if you have concerns about this approach!
```

## State Management

Track progress in local file:

```json
// .take-over-pr-state.json
{
  "pr_number": 123,
  "review_started_at": "2026-10-26T19:00:00Z",
  "comments": [
    {
      "id": 456789,
      "path": "src/handler.ts",
      "line": 45,
      "body": "Missing null check",
      "status": "fixed",
      "fixed_in_commit": "abc123d",
      "replied_at": "2026-10-26T19:15:00Z",
      "resolved": true
    },
    {
      "id": 456790,
      "path": "src/config.ts",
      "line": 89,
      "body": "Extract magic number",
      "status": "in_progress",
      "fixed_in_commit": null,
      "replied_at": null,
      "resolved": false
    }
  ],
  "ci_failures": [
    {
      "job": "test",
      "status": "fixed",
      "fixed_in_commit": "def456a"
    }
  ]
}
```

## Verification Checklist

Before marking PR as "ready for re-review":

- [ ] All blocking review comments addressed
- [ ] All nice-to-have comments replied to (fixed or deferred)
- [ ] Questions answered
- [ ] Threads resolved where appropriate
- [ ] CI checks passing
- [ ] Tests added for new functionality
- [ ] Type errors resolved
- [ ] Lint errors resolved
- [ ] Summary comment posted
- [ ] Stack rebased if needed (for Graphite)

## Automation Opportunities

### Auto-resolve After Push

Some teams configure GitHub to auto-resolve threads when the mentioned line is changed. Check settings:

```bash
gh api repos/{owner}/{repo} --jq '.allow_auto_merge'
```

### CI Integration

If CI runs verification on push:

```bash
# Wait for CI before posting summary
gh pr checks $PR_NUMBER --watch

# Then post summary with CI badge
```

## Error Handling

### Comment Not Found

```bash
# Comment may have been deleted
# Skip and note in summary
echo "Note: Comment #456789 no longer exists - may have been deleted"
```

### Merge Conflicts

```bash
# Fetch latest base
git fetch origin $BASE_BRANCH

# Rebase
git rebase origin/$BASE_BRANCH

# Resolve conflicts
# ... manual resolution ...

git add .
git rebase --continue

# Push
git push --force-with-lease
```

### Permission Denied

```bash
# May not have write access to resolve threads
# Reply to comment instead:
gh pr comment $PR_NUMBER --body "Fixed in abc123d - marking as resolved"
```

## Notes

- Always verify fixes with tests and CI before replying
- Be responsive but thoughtful - don't rush fixes
- Acknowledge reviewer time and expertise in replies
- Keep replies concise and actionable
- Use Graphite's auto-sync features when available
- Track deferred items in GitHub issues - don't lose them
- Re-verify entire PR after addressing all comments
