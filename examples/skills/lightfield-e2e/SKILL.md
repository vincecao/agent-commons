---
name: lightfield-e2e
description: >
  Use when verifying UI changes, running end-to-end tests for lightfield repo, or
  when asked to provide e2e evidence before submitting a PR. Builds coverage maps,
  runs isolated test stacks, captures screenshots and recordings, and pins evidence
  to commit SHAs. Modeled on Devin's e2e verification method.
---

# Lightfield E2E Verification

Generate comprehensive end-to-end test evidence for UI changes with coverage tracking, isolated test environments, and visual artifacts.

## Trigger Patterns

Use this skill when:
- "run e2e tests"
- "verify UI changes"
- "test the new feature end-to-end"
- "need e2e evidence for PR"
- "check if this works in the browser"
- Any UI-impacting change in the lightfield repo

## Core Principles (Devin Method)

1. **Coverage Map First**: Build a matrix of what must be tested BEFORE running tests
2. **Isolated Test Stack**: Run against a separate worktree with dedicated ports
3. **Commit-Pinned Results**: All evidence references a specific commit SHA
4. **Fault Injection**: Test error states, not just happy paths
5. **Named Visual Evidence**: Screenshots with descriptive names + short recording
6. **Caveats Explicit**: Call out what's NOT covered

## Coverage Map Structure

Before any test execution, build this table based on the git diff:

| Case | Expected Behavior | Regression Risk | Covered |
|------|-------------------|-----------------|---------|
| User clicks "Save" button | Form submits, shows success toast | Form validation skipped | ✅ |
| User clicks "Save" with invalid data | Shows error toast, form not submitted | Error handling broken | ✅ |
| Existing "Cancel" button | Still closes modal without saving | Button handler accidentally removed | ✅ |
| User navigates away with unsaved changes | (Not changed by this diff) | Prompt broken by form state changes | ✅ |
| Mobile viewport | Responsive layout | Layout broken on small screens | ❌ Not covered |

### Coverage Map Rules

- **Changed Behaviors**: Primary test cases - anything the diff modifies
- **Regression Risks**: Side effects - existing features that might break
- **Not Covered**: Explicit rows for out-of-scope cases (mobile, a11y, perf, etc.)
- **Error States**: At least one fault injection case per happy path

## Lightfield Repo Setup

### Prerequisites

The lightfield repo (magicaltome/lightfield) provides:

- `pnpm worktree:dev` — creates isolated worktree in `../lightfield-dev`
- `seed-local-db` — populates test database with fixtures
- Playwright fixtures: `authenticatedPage`, `loginAs(role)`
- Smoke test skill: `.agents/skills/smoke-test/` with `environment.md`, `recording.md`, `verify-ui.ts`

### Repository Reference

🔗 **Lightfield Smoke Test Skill**: `~/.agents/skills/smoke-test/` (or wherever synced)

Do NOT duplicate the lightfield-specific setup - reference the repo's own skill for:
- Environment variables and secrets
- Database seeding procedures
- Playwright page fixtures
- App-specific test utilities

This skill provides the **general workflow** and **evidence reporting format**.

## Workflow

### 1. Create Isolated Test Stack

```bash
# Clone to dedicated worktree
cd /path/to/lightfield
git worktree add ../lightfield-e2e HEAD

# Set dedicated ports (avoid conflicts with main dev server)
cd ../lightfield-e2e
export VITE_PORT=5174  # main uses 5173
export API_PORT=3001    # main uses 3000
export REDIS_PORT=6380  # main uses 6379

# Install and build
pnpm install
pnpm build

# Seed test database
pnpm seed-local-db --env test
```

### 2. Start Test Stack

```bash
# In lightfield-e2e worktree
pnpm worktree:dev &
TEST_DEV_PID=$!

# Wait for server ready
npx wait-on http://localhost:5174 --timeout 30000

# Verify health
curl http://localhost:5174/health
```

### 3. Build Coverage Map from Diff

```bash
# Get PR diff or recent commits
git diff main...HEAD > /tmp/pr-diff.txt

# Or for local commits
git diff HEAD~3..HEAD > /tmp/diff.txt
```

#### Analyze Diff for Test Cases

Parse diff and identify:

1. **New UI Components**: Must test render + interactions
2. **Changed Handlers**: Test before/after behavior
3. **State Changes**: Test state transitions
4. **API Calls**: Test success + error cases
5. **Routing Changes**: Test navigation
6. **Style Changes**: Visual regression check

For each, create coverage map row:
- **Case**: What to test
- **Expected Behavior**: What should happen
- **Regression Risk**: What could break
- **Covered**: ✅ or ❌ (with reason)

### 4. Write Playwright Tests

Use lightfield's fixtures and patterns:

```typescript
// e2e-verification.spec.ts
import { test, expect } from '@playwright/test';
import { authenticatedPage, loginAs } from './fixtures';

test.describe('Save Button (PR #123)', () => {
  test('submits form and shows success toast', async ({ authenticatedPage }) => {
    await authenticatedPage.goto('/app/form');
    
    // Fill valid data
    await authenticatedPage.fill('[data-testid="name-input"]', 'Test User');
    await authenticatedPage.fill('[data-testid="email-input"]', 'test@example.com');
    
    // Click save
    await authenticatedPage.click('[data-testid="save-button"]');
    
    // Verify success
    await expect(authenticatedPage.locator('[data-testid="success-toast"]'))
      .toBeVisible();
    await expect(authenticatedPage.locator('[data-testid="success-toast"]'))
      .toContainText('Saved successfully');
  });

  test('shows error toast for invalid data', async ({ authenticatedPage }) => {
    await authenticatedPage.goto('/app/form');
    
    // Leave required fields empty (fault injection)
    await authenticatedPage.click('[data-testid="save-button"]');
    
    // Verify error handling
    await expect(authenticatedPage.locator('[data-testid="error-toast"]'))
      .toBeVisible();
    await expect(authenticatedPage.locator('[data-testid="error-toast"]'))
      .toContainText('Name is required');
  });
  
  test('existing cancel button still works', async ({ authenticatedPage }) => {
    await authenticatedPage.goto('/app/form');
    
    // Fill data
    await authenticatedPage.fill('[data-testid="name-input"]', 'Test');
    
    // Click cancel
    await authenticatedPage.click('[data-testid="cancel-button"]');
    
    // Verify modal closed
    await expect(authenticatedPage.locator('[data-testid="form-modal"]'))
      .not.toBeVisible();
  });
});
```

### 5. Capture Named Screenshots

During test execution:

```typescript
// Capture key moments with descriptive names
await authenticatedPage.screenshot({
  path: 'evidence/01-form-initial-state.png',
  fullPage: false
});

await authenticatedPage.fill('[data-testid="name-input"]', 'Test User');
await authenticatedPage.screenshot({
  path: 'evidence/02-form-filled-valid-data.png'
});

await authenticatedPage.click('[data-testid="save-button"]');
await authenticatedPage.waitForSelector('[data-testid="success-toast"]');
await authenticatedPage.screenshot({
  path: 'evidence/03-success-toast-shown.png'
});

// Error state
await authenticatedPage.screenshot({
  path: 'evidence/04-error-toast-invalid-data.png'
});
```

### 6. Record Short Demo Video

```bash
# Start recording (Playwright with video: 'on')
npx playwright test --headed --project=chromium --video=on \
  e2e-verification.spec.ts

# Or use Playwright's built-in video
# Videos saved to test-results/*/video.webm

# Rename for clarity
mv test-results/save-button-verification/video.webm \
   evidence/demo-save-button.webm
```

### 7. Generate Evidence Report

#### Pin to Commit SHA

```bash
COMMIT_SHA=$(git rev-parse HEAD)
echo "Evidence for commit: $COMMIT_SHA" > evidence/COMMIT.txt
```

#### Results Table

Format:

```markdown
## E2E Verification Results

**Commit SHA**: `abc123def456`
**Test Date**: 2026-10-26
**Lightfield Worktree**: `../lightfield-e2e`

### Coverage Map

| Case | Expected Behavior | Result | Evidence |
|------|-------------------|--------|----------|
| User clicks "Save" with valid data | Form submits, shows success toast | ✅ Pass | `03-success-toast-shown.png` |
| User clicks "Save" with invalid data | Shows error toast, form not submitted | ✅ Pass | `04-error-toast-invalid-data.png` |
| Existing "Cancel" button | Still closes modal without saving | ✅ Pass | `05-cancel-closes-modal.png` |
| User navigates away with unsaved changes | Shows confirmation prompt | ✅ Pass | `06-unsaved-changes-prompt.png` |
| Mobile viewport (< 768px) | Responsive layout | ❌ Not covered | — |
| Keyboard navigation | All interactive elements accessible | ❌ Not covered | — |

### Caveats

- **Mobile viewport**: Not tested - requires separate mobile test run
- **Keyboard navigation**: Accessibility not verified in this pass
- **Error recovery**: Only tested client-side validation, not server errors
- **Performance**: Load times not measured

### Visual Evidence

Screenshots:
- `evidence/01-form-initial-state.png`
- `evidence/02-form-filled-valid-data.png`
- `evidence/03-success-toast-shown.png`
- `evidence/04-error-toast-invalid-data.png`
- `evidence/05-cancel-closes-modal.png`
- `evidence/06-unsaved-changes-prompt.png`

Demo recording:
- `evidence/demo-save-button.webm` (12s)

### Test Execution Logs

```
✅ Save Button (PR #123) > submits form and shows success toast (2.3s)
✅ Save Button (PR #123) > shows error toast for invalid data (1.8s)
✅ Save Button (PR #123) > existing cancel button still works (1.5s)

3 passed, 0 failed
```
```

### 8. Re-verify After New Pushes

When PR head changes:

```bash
# Fetch latest
cd ../lightfield-e2e
git fetch origin
git reset --hard origin/feature-branch

# Check if diff changed
NEW_SHA=$(git rev-parse HEAD)
if [ "$NEW_SHA" != "$PREVIOUS_SHA" ]; then
  echo "Head changed - re-running e2e verification"
  
  # Re-run tests
  pnpm test:e2e
  
  # Update evidence commit SHA
  echo "Evidence for commit: $NEW_SHA" > evidence/COMMIT.txt
  
  # Regenerate report
fi
```

### 9. Clean Up Test Stack

```bash
# Stop dev server
kill $TEST_DEV_PID

# Remove worktree
cd /path/to/lightfield
git worktree remove ../lightfield-e2e
```

## Fault Injection Strategies

Test error states by:

1. **Invalid Input**: Leave required fields empty, use malformed data
2. **Network Errors**: Mock API failures with Playwright's route interception
   ```typescript
   await authenticatedPage.route('**/api/save', route => route.abort());
   ```
3. **Race Conditions**: Rapid clicks, concurrent operations
4. **Browser State**: Cookies cleared, localStorage corrupted
5. **Edge Cases**: Boundary values, special characters, very long strings

## Attaching Evidence to PR

### GitHub Comment Method

```bash
# Create comment with uploaded screenshots
gh pr comment $PR_NUMBER --body-file evidence-report.md

# Attach screenshots as separate comments
for img in evidence/*.png; do
  gh pr comment $PR_NUMBER --body "![$img]($img)"
done
```

### GitHub Artifacts (via CI)

If lightfield has a CI workflow:

```yaml
# .github/workflows/e2e-verification.yml
- name: Upload Evidence
  uses: actions/upload-artifact@v3
  with:
    name: e2e-evidence
    path: evidence/
```

Then link to artifacts in PR comment:
```markdown
E2E Evidence: [Download artifacts](https://github.com/org/repo/actions/runs/123456)
```

### Direct Upload (via GitHub API)

For screenshots < 1MB:

```bash
# Base64 encode and upload
for img in evidence/*.png; do
  base64 $img | gh api /repos/{owner}/{repo}/issues/$PR_NUMBER/comments \
    -f body="![${img}](data:image/png;base64,$(base64 $img))"
done
```

## Lightfield-Specific Patterns

### Authentication Fixtures

```typescript
// Use lightfield's built-in fixtures
test('admin-only feature', async ({ authenticatedPage }) => {
  // Already logged in as default user
  await authenticatedPage.goto('/admin/dashboard');
});

test('role-specific behavior', async ({ page }) => {
  // Log in as specific role
  await loginAs(page, 'editor');
  await page.goto('/content/edit');
});
```

### Database Seeding

```bash
# Seed specific fixtures for test
pnpm seed-local-db --fixture users --fixture posts --env test

# Or seed from test code
await exec('pnpm seed-local-db --fixture users --env test');
```

### Environment Variables

```bash
# Test environment (lightfield defaults)
export NODE_ENV=test
export DATABASE_URL=postgresql://localhost:5432/lightfield_test
export REDIS_URL=redis://localhost:6380
export JWT_SECRET=test-secret-key
export VITE_API_URL=http://localhost:3001
```

Refer to `.agents/skills/smoke-test/environment.md` in the lightfield repo for full list.

## Output Format Reference

Always include:

1. **Coverage Map Table** (before running tests)
2. **Results Table** (after running tests)
3. **Caveats Section** (explicit "not covered" items)
4. **Visual Evidence List** (screenshot + video paths)
5. **Commit SHA** (evidence pinned to specific commit)

## Integration with PR Workflow

Pair with `pr-inline-review` and `verify-before-pr`:

1. **Before Opening PR**:
   - Run e2e verification
   - Include evidence report in PR description
   - Attach screenshots/video

2. **During Review**:
   - If reviewer questions behavior, reference specific evidence
   - If changes requested, re-run e2e and update evidence

3. **After Push**:
   - Re-verify and update evidence
   - Note in PR comment: "Re-verified at commit abc123"

## Troubleshooting

### Test Stack Won't Start

```bash
# Check port conflicts
lsof -i :5174
lsof -i :3001

# Kill conflicting processes
kill -9 $(lsof -t -i:5174)

# Check database connection
psql $DATABASE_URL -c "SELECT 1"
```

### Screenshots Empty/Blank

```bash
# Ensure page loaded before screenshot
await authenticatedPage.waitForLoadState('networkidle');
await authenticatedPage.screenshot({ path: '...' });

# Or wait for specific element
await authenticatedPage.waitForSelector('[data-testid="save-button"]');
```

### Playwright Not Found

```bash
# Install Playwright browsers
npx playwright install chromium
```

### Worktree Already Exists

```bash
# Remove stale worktree
git worktree remove --force ../lightfield-e2e

# Prune stale worktree records
git worktree prune
```

## Notes

- Prefer descriptive screenshot names over generic "screenshot-1.png"
- Keep recordings under 30 seconds - focus on key interaction flows
- Re-run e2e verification after every push to PR branch
- Store evidence locally - do NOT commit large binary files to repo
- Use GitHub artifacts or external storage for archival
- Reference lightfield repo's `.agents/skills/smoke-test/` for app-specific patterns - do NOT duplicate
