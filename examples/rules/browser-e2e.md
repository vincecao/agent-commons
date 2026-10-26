---
description: Browser end-to-end testing rules for agents
alwaysApply: false
---

# Browser E2E Testing Rules

Guidelines for agents running browser-based end-to-end tests.

## Core Principles

1. **Never touch production**: Do not log in to, test against, or interact with production systems
2. **Never type real credentials**: Do not enter actual user passwords, API keys, or secrets
3. **Isolated environments only**: Run tests against local dev servers, staging, or dedicated test environments
4. **Screenshots are required evidence**: Visual artifacts are mandatory for UI verification

## Authentication Rules

### ✅ Allowed

- Use dev/test accounts (`test@example.com`, `dev-user@test.local`)
- Use Playwright fixtures like `authenticatedPage`, `loginAs(role)`
- Use environment-specific test credentials from `.env.test` or CI secrets
- Log in with dedicated test user accounts created for automation
- Use API tokens generated specifically for test environments

### ❌ Prohibited

- Do NOT type real user passwords into forms
- Do NOT use production credentials
- Do NOT authenticate against production login endpoints
- Do NOT store credentials in code or commit them to repo

## Development Server Rules

### ✅ Allowed (New: Isolated Stacks)

Agents MAY start their own development server when:

1. **Isolated worktree**: Server runs in a separate git worktree with dedicated ports
   ```bash
   git worktree add ../myapp-e2e HEAD
   cd ../myapp-e2e
   export PORT=3001  # avoid conflict with main dev server
   npm run dev
   ```

2. **Disposable local stacks**: Server is for testing only, destroyed after verification
   ```bash
   pnpm worktree:dev  # project-specific isolated dev setup
   ```

3. **Preview environments**: Ephemeral preview deploys (Vercel, Netlify previews)
   ```bash
   # Use preview URL from PR
   npx playwright test --base-url=https://pr-123.preview.example.com
   ```

### ❌ Still Prohibited

- Do NOT start server on ports used by active user development sessions
- Do NOT modify or restart the main development server user is actively using
- Do NOT interfere with user's running processes

## Screenshot Rules

### Required Evidence

Screenshots are **mandatory** for UI changes. Capture:

1. **Before/after states**: Show initial and final UI states
2. **Key interactions**: Capture moments during user flow (button click, form submit)
3. **Error states**: Visual proof of error handling
4. **Success confirmations**: Toasts, alerts, success messages

### Implementation

```typescript
// Use descriptive names
await page.screenshot({ path: 'evidence/01-form-initial-state.png' });
await page.click('[data-testid="submit"]');
await page.screenshot({ path: 'evidence/02-form-submitted-success.png' });
```

### Fallback Strategy

If the agent tool refuses to take screenshots:

1. **Document why**: Record the refusal reason
   ```markdown
   Note: Screenshot tool blocked - reason: [tool error message]
   ```

2. **Use Playwright screenshots**: Fall back to Playwright's built-in screenshot API
   ```typescript
   await page.screenshot({ path: 'fallback-screenshot.png' });
   ```

3. **Never skip silently**: Always document when screenshots cannot be captured

## Environment Detection

Before running browser tests:

```bash
# Check environment
if [ "$NODE_ENV" == "production" ]; then
  echo "ERROR: Cannot run e2e tests in production environment"
  exit 1
fi

# Verify test URL
if [[ "$BASE_URL" =~ "example.com" ]] && [[ ! "$BASE_URL" =~ "test\.|staging\.|preview\." ]]; then
  echo "ERROR: URL appears to be production: $BASE_URL"
  exit 1
fi
```

## Safe Test Patterns

### ✅ Good Patterns

```typescript
// Use test fixtures
test('user can save changes', async ({ authenticatedPage }) => {
  // authenticatedPage is pre-configured with test user
  await authenticatedPage.goto('/app/form');
  await authenticatedPage.fill('[data-testid="name"]', 'Test User');
  await authenticatedPage.click('[data-testid="save"]');
  await expect(authenticatedPage.locator('[data-testid="success"]')).toBeVisible();
});

// Use environment-specific credentials
const TEST_USER = process.env.TEST_USER_EMAIL; // from .env.test
const TEST_PASSWORD = process.env.TEST_USER_PASSWORD; // test-only password

// Use API authentication
await page.evaluate((token) => {
  localStorage.setItem('auth_token', token);
}, process.env.TEST_AUTH_TOKEN);
```

### ❌ Bad Patterns

```typescript
// DO NOT: Hardcode real credentials
await page.fill('[name="email"]', 'real.user@company.com');
await page.fill('[name="password"]', 'actualPassword123');

// DO NOT: Test against production
await page.goto('https://app.company.com');

// DO NOT: Use production API tokens
const token = 'sk_live_actual_production_key';
```

## Worktree Workflow (Preferred for Local Testing)

When running e2e tests locally:

```bash
# 1. Create isolated worktree
git worktree add ../myapp-e2e HEAD

# 2. Set dedicated ports
cd ../myapp-e2e
export VITE_PORT=5174   # main dev uses 5173
export API_PORT=3001    # main dev uses 3000

# 3. Install and start
npm install
npm run dev &
DEV_PID=$!

# 4. Run tests
npx playwright test

# 5. Clean up
kill $DEV_PID
cd ..
git worktree remove myapp-e2e
```

## CI/CD Integration

For CI environments:

```yaml
# .github/workflows/e2e-tests.yml
env:
  NODE_ENV: test
  BASE_URL: http://localhost:3000
  TEST_USER_EMAIL: test@example.com
  TEST_USER_PASSWORD: ${{ secrets.TEST_USER_PASSWORD }}

steps:
  - name: Start test server
    run: npm run dev &
    
  - name: Wait for server
    run: npx wait-on http://localhost:3000
    
  - name: Run e2e tests
    run: npm run test:e2e
    
  - name: Upload screenshots
    if: always()
    uses: actions/upload-artifact@v3
    with:
      name: e2e-evidence
      path: evidence/
```

## Error Handling

If browser tests fail:

1. **Capture screenshot on failure**:
   ```typescript
   test.afterEach(async ({ page }, testInfo) => {
     if (testInfo.status !== 'passed') {
       await page.screenshot({ path: `failures/${testInfo.title}.png` });
     }
   });
   ```

2. **Save full page HTML**:
   ```typescript
   const html = await page.content();
   fs.writeFileSync('failures/page.html', html);
   ```

3. **Record video** (if enabled):
   ```typescript
   // playwright.config.ts
   use: {
     video: 'retain-on-failure',
   }
   ```

## Summary

**Previous behavior** (hard block): Agents could not start dev servers or log in, causing tests to fail silently.

**New behavior** (controlled access): Agents may:
- Start dev servers in isolated worktrees or disposable environments
- Log in with dev/test credentials for local/staging/preview testing
- Use test fixtures and environment-specific auth

**Still prohibited**:
- Production systems
- Real user credentials
- Active user development sessions

**Screenshots are mandatory**: Fall back to Playwright screenshots if agent tool fails.
