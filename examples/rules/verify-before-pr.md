---
description: Verification checklist before opening or updating pull requests
alwaysApply: true
---

# Verify Before PR

Before opening or updating a pull request, agents MUST complete verification and self-review.

## When This Applies

Trigger this verification:

1. **Before `gh pr create`** or `ManagePullRequest` tool call
2. **Before pushing updates** to an existing PR branch
3. **After making changes** in response to review feedback

## Required Verification Steps

### 1. Typecheck

Run the project's type checker:

```bash
# TypeScript projects
pnpm typecheck
# or
npm run typecheck
# or
tsc --noEmit

# Python projects
mypy .
# or
pyright

# Go projects
go vet ./...
```

**Capture output**: Do not assume success - capture and show the full output.

```bash
pnpm typecheck 2>&1 | tee /tmp/typecheck-output.txt
```

If typecheck fails:
- ❌ Do NOT open/update PR
- Fix all type errors first
- Re-run verification

If typecheck passes:
- ✅ Include output in verification report

### 2. Run Relevant Tests

Determine which tests are relevant:

```bash
# Get changed files
git diff main...HEAD --name-only > /tmp/changed-files.txt

# Identify test files
# TypeScript/JavaScript
grep -E "\.(test|spec)\.(ts|tsx|js|jsx)$" /tmp/changed-files.txt

# Python
grep -E "test_.*\.py$" /tmp/changed-files.txt

# Go
grep -E "_test\.go$" /tmp/changed-files.txt
```

Run affected tests:

```bash
# All tests (small test suites)
pnpm test

# Specific test files (large test suites)
pnpm test src/handler.test.ts src/service.test.ts

# Changed test files only
pnpm test $(git diff main...HEAD --name-only --diff-filter=AM | grep "\.test\.")
```

**Capture output**: Show test results.

```bash
pnpm test 2>&1 | tee /tmp/test-output.txt
```

If tests fail:
- ❌ Do NOT open/update PR
- Fix failing tests first
- Re-run verification

If tests pass:
- ✅ Include output in verification report

### 3. UI Changes: E2E Evidence

If the diff includes UI changes:

```bash
# Detect UI changes
git diff main...HEAD --name-only | grep -E "\.(tsx|jsx|vue|svelte|html|css|scss)$"
```

When UI changes detected:

1. **Run e2e tests**: Use `lightfield-e2e` or equivalent skill
2. **Generate coverage map**: Document what's tested and what's not
3. **Capture screenshots**: Minimum 3 screenshots (before, interaction, after)
4. **Record demo video**: Short (< 30s) walkthrough

**Required artifacts**:
- Coverage map table
- Screenshots with descriptive names
- Demo video
- Commit SHA evidence is pinned to

If e2e tests fail or artifacts missing:
- ❌ Do NOT open/update PR
- Complete e2e verification first
- Re-run verification

If e2e evidence complete:
- ✅ Include coverage map and artifact paths in verification report

### 4. Fresh-Context Self-Review

After all checks pass, perform a self-review of the diff:

```bash
# Generate diff
git diff main...HEAD > /tmp/pr-diff.txt

# Or for existing PR
gh pr diff $PR_NUMBER > /tmp/pr-diff.txt
```

#### Self-Review Checklist

Review the diff for:

- [ ] **Logic errors**: Off-by-one, null/undefined handling, race conditions
- [ ] **Security issues**: SQL injection, XSS, auth bypass, secrets in code
- [ ] **Edge cases**: Empty arrays, null values, boundary conditions
- [ ] **Error handling**: Try/catch blocks, error messages, user feedback
- [ ] **Test coverage**: New code has corresponding tests
- [ ] **Breaking changes**: API changes, removed exports, signature changes
- [ ] **Dead code**: Commented code, unused imports, unreachable branches
- [ ] **TODOs/FIXMEs**: Addressed or tracked in issues
- [ ] **Hardcoded values**: Magic numbers, strings, URLs extracted to config
- [ ] **Performance**: N+1 queries, unnecessary loops, memory leaks

**"Fresh context" requirement**: Imagine you are reviewing this PR as a new reviewer who hasn't seen the code before. Would you approve it?

#### Self-Review Output

Document findings:

```markdown
## Self-Review Findings

### Critical Issues (Must Fix)
- None

### Important Issues (Should Fix)
- [ ] `src/handler.ts:45` - Consider adding error handling for network failure

### Minor Issues (Nice to Have)
- [ ] `src/utils.ts:89` - Magic number 1000 could be extracted to constant

### Pre-existing Issues (Out of Scope)
- `src/legacy.ts:123` - Inconsistent naming (tracked in #789)
```

If critical issues found:
- ❌ Do NOT open/update PR
- Fix critical issues first
- Re-run verification

If only minor issues or no issues:
- ✅ Proceed to open/update PR
- Include self-review findings in verification report

## Verification Report Format

After all checks pass, generate a report:

```markdown
## Pre-PR Verification Report

**Date**: 2026-10-26
**Branch**: `feature/add-authentication`
**Base**: `main`
**Commit SHA**: `abc123def456`

### 1. Typecheck ✅

```
$ pnpm typecheck
✓ No type errors found
```

### 2. Tests ✅

```
$ pnpm test
✓ 24 tests passed
✓ src/handler.test.ts (8 tests)
✓ src/service.test.ts (12 tests)
✓ src/utils.test.ts (4 tests)
```

### 3. E2E Evidence ✅

Coverage map:

| Case | Expected Behavior | Result | Evidence |
|------|-------------------|--------|----------|
| User clicks "Login" | Shows auth modal | ✅ Pass | `01-login-modal.png` |
| User submits valid credentials | Redirects to dashboard | ✅ Pass | `02-dashboard.png` |
| User submits invalid credentials | Shows error message | ✅ Pass | `03-error-message.png` |

Artifacts:
- Screenshots: `evidence/*.png` (5 files)
- Demo video: `evidence/login-flow.webm` (8s)

Caveats:
- OAuth flow not tested (requires external service)
- Mobile viewport not covered

### 4. Self-Review ✅

Reviewed full diff (238 lines changed across 6 files)

Findings:
- No critical issues
- 1 minor issue: magic number in `src/config.ts:89` (acceptable for MVP)

**Verdict**: ✅ Ready to open PR
```

## When to Skip Verification

**Never skip verification** for:
- New PRs
- PRs with code changes
- PRs requesting review

**May skip verification** for:
- Documentation-only changes (README, comments)
- Config changes with no code impact (.gitignore, .editorconfig)
- Trivial typo fixes in strings/messages

Even for skippable changes, always run typecheck.

## Post-Update Verification

After pushing updates to an existing PR:

```bash
# Minimal verification (if changes are small)
pnpm typecheck
pnpm test path/to/changed/files.test.ts

# Full verification (if changes are substantial)
# Run complete verification process above
```

Post a comment on the PR:

```markdown
Updated PR - verification results:

✅ Typecheck passed
✅ Tests passed (24/24)
✅ Self-review complete

Changes:
- Fixed null check in handler.ts
- Added test for error case
```

## CI vs. Local Verification

**Local verification** (pre-push):
- Catch issues before CI runs
- Faster feedback loop
- Avoid polluting CI history with broken commits

**CI verification** (post-push):
- Additional checks (integration tests, build matrix)
- Authoritative pass/fail for merge decisions
- Runs on clean environment

**Both are required**: Local verification does not replace CI, but complements it.

## Integration with Other Skills

### With `pr-inline-review`

After opening PR:
1. Run pre-PR verification
2. Open PR with verification report in description
3. Optionally self-review with `pr-inline-review` skill (round 0 / self-review)

### With `lightfield-e2e`

For UI changes:
1. Run `lightfield-e2e` skill to generate evidence
2. Include evidence in pre-PR verification report
3. Attach artifacts to PR description

### With `take-over-pr`

When updating PR based on feedback:
1. Make requested changes
2. Run pre-PR verification again
3. Include updated verification in reply comment

## Troubleshooting

### Typecheck Passes Locally, Fails in CI

```bash
# Use exact Node version from CI
nvm use $(cat .nvmrc)

# Install with exact lockfile
pnpm install --frozen-lockfile

# Clear cache
pnpm store prune
pnpm install

# Re-run typecheck
pnpm typecheck
```

### Tests Pass Locally, Fail in CI

```bash
# Check for environment-specific issues
# - Timezone differences
# - File system case sensitivity
# - Async timing issues

# Run tests with CI environment variables
NODE_ENV=test CI=true pnpm test
```

### E2E Tests Flaky

```bash
# Add explicit waits
await page.waitForLoadState('networkidle');
await page.waitForSelector('[data-testid="element"]');

# Increase timeout
test.setTimeout(60000);

# Retry failed tests
npx playwright test --retries=2
```

## Summary

**Always verify before opening or updating a PR**:

1. ✅ Typecheck passes
2. ✅ Relevant tests pass
3. ✅ (If UI changes) E2E evidence captured
4. ✅ Self-review complete with no critical issues

**Show actual output** - don't just say "tests pass", show the test output.

**Document what you verified** - include verification report in PR description or comment.

**Fix issues before opening PR** - don't rely on CI to catch preventable errors.
