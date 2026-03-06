---
title: "Testing"
sidebar_position: 4
---

# Testing

GuildServer maintains code quality through a multi-layered testing strategy covering unit tests, integration tests, end-to-end tests, and automated security audits. All tests run in CI on every push to `main` and `develop`, and on every pull request targeting those branches.

## Test Stack

| Tool | Purpose |
|---|---|
| **Jest** | Test runner and assertion library |
| **ts-jest** | TypeScript support for Jest |
| **Supertest** | HTTP assertion library for Express routes |
| **Playwright** | Browser-based end-to-end testing |
| **Codecov** | Coverage reporting and tracking |
| **CodeQL** | Static analysis for security vulnerabilities |

## Running Tests Locally

```bash
# Run all tests across all packages
pnpm run test

# Run tests in watch mode (re-runs on file changes)
pnpm run test:watch

# Run backend tests only
pnpm --filter @guildserver/api test

# Run frontend tests only
pnpm --filter @guildserver/web test

# Run backend tests with coverage report
pnpm --filter @guildserver/api test:ci

# Run a specific test file by pattern
pnpm --filter @guildserver/api test -- --testPathPattern=auth

# Run TypeScript type checking (no test execution)
pnpm run typecheck

# Run ESLint across all packages
pnpm run lint
```

## Test Structure

Tests are co-located with source files using the `.test.ts` suffix. This keeps tests close to the code they verify:

```
apps/api/src/
├── routers/
│   ├── auth.ts
│   ├── auth.test.ts
│   ├── application.ts
│   ├── application.test.ts
│   ├── monitoring.ts
│   └── monitoring.test.ts
├── services/
│   ├── docker.ts
│   ├── docker.test.ts
│   ├── builder.ts
│   └── builder.test.ts
└── utils/
    ├── logger.ts
    └── logger.test.ts
```

## Writing Unit Tests

Unit tests verify individual functions and utilities in isolation. External dependencies such as the database, Docker, and Redis should be mocked.

```typescript
import { describe, it, expect, jest } from "@jest/globals";
import { sanitizeAppName } from "../utils/naming";

describe("sanitizeAppName", () => {
  it("converts to lowercase", () => {
    expect(sanitizeAppName("MyApp")).toBe("myapp");
  });

  it("replaces invalid characters with hyphens", () => {
    expect(sanitizeAppName("my_app@v2")).toBe("my-app-v2");
  });

  it("strips leading and trailing hyphens", () => {
    expect(sanitizeAppName("--my-app--")).toBe("my-app");
  });
});
```

:::tip
Keep unit tests fast by mocking all I/O. A unit test suite should complete in under 5 seconds.
:::

## Writing Integration Tests

Integration tests verify tRPC router procedures with a real PostgreSQL database. The CI pipeline starts PostgreSQL 15 and Redis 7 as service containers.

### Database Setup for Tests

The backend test job provisions a dedicated test database:

```yaml
services:
  postgres:
    image: postgres:15
    env:
      POSTGRES_USER: test
      POSTGRES_PASSWORD: test
      POSTGRES_DB: guildserver_test
    ports:
      - 5432:5432

  redis:
    image: redis:7
    ports:
      - 6379:6379
```

Before tests run, migrations are applied to the test database:

```bash
npm run db:migrate --workspace=@guildserver/database
```

### Example Integration Test

```typescript
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { createTestContext } from "../test-helpers";
import { appRouter } from "../routers";

describe("application.list", () => {
  let ctx: Awaited<ReturnType<typeof createTestContext>>;

  beforeAll(async () => {
    ctx = await createTestContext();
    // Seed test data
    await ctx.db.insert(projects).values({
      name: "Test Project",
      organizationId: ctx.orgId,
    });
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it("returns applications for a project", async () => {
    const caller = appRouter.createCaller(ctx);
    const result = await caller.application.list({
      projectId: ctx.projectId,
    });

    expect(result).toBeInstanceOf(Array);
    expect(result.length).toBeGreaterThanOrEqual(0);
  });

  it("rejects unauthenticated requests", async () => {
    const anonCtx = { ...ctx, user: null };
    const caller = appRouter.createCaller(anonCtx);

    await expect(
      caller.application.list({ projectId: ctx.projectId })
    ).rejects.toThrow("UNAUTHORIZED");
  });
});
```

### API Route Tests with Supertest

Test Express middleware and HTTP endpoints directly:

```typescript
import request from "supertest";
import { app } from "../index";

describe("Health Check", () => {
  it("returns healthy status", async () => {
    const response = await request(app).get("/health");
    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty("status", "healthy");
    expect(response.body).toHaveProperty("uptime");
  });
});

describe("Authentication Middleware", () => {
  it("rejects requests without a token", async () => {
    const response = await request(app).get("/trpc/auth.me");
    expect(response.status).toBe(401);
  });

  it("accepts requests with a valid JWT", async () => {
    const response = await request(app)
      .get("/trpc/auth.me")
      .set("Authorization", `Bearer ${testToken}`);
    expect(response.status).toBe(200);
  });
});
```

## End-to-End Tests

E2E tests use **Playwright** to test the full application stack in a browser. The CI job builds all packages in production mode before running Playwright.

### Running E2E Tests Locally

```bash
# Install Playwright browsers (first time only)
npx playwright install --with-deps

# Run all E2E tests
npx playwright test

# Run with 2 parallel workers (matches CI)
npx playwright test --workers=2

# Run in headed mode for debugging
npx playwright test --headed

# Run a specific test file
npx playwright test tests/auth.spec.ts

# View the test report
npx playwright show-report
```

### E2E Test Environment

The E2E test job uses a separate database (`guildserver_e2e_test`) and Redis database index (`/2`) to avoid conflicts with unit tests:

```
DATABASE_URL: postgresql://test:test@localhost:5432/guildserver_e2e_test
REDIS_URL: redis://localhost:6379/2
JWT_SECRET: test-jwt-secret-key-for-e2e
```

:::warning
E2E tests have a 30-minute timeout in CI. If tests exceed this limit, the job is terminated. Optimize slow tests by reducing unnecessary waits and using Playwright auto-waiting.
:::

### Test Artifacts

When E2E tests fail in CI, two artifacts are uploaded:

| Artifact | Retention | Contents |
|---|---|---|
| `playwright-report` | 7 days | Full HTML test report |
| `playwright-screenshots` | 7 days | Screenshots from failed tests only |

Download artifacts from the GitHub Actions run page to debug failures.

## CI/CD Pipeline

The GitHub Actions workflow (`.github/workflows/test.yml`) runs **7 jobs** on every push and pull request:

### Job Overview

| Job | Purpose | Services | Depends On |
|---|---|---|---|
| `lint-and-typecheck` | ESLint + TypeScript strict check | None | -- |
| `backend-tests` | Jest unit and integration tests | PostgreSQL 15, Redis 7 | -- |
| `frontend-tests` | Jest component and hook tests | None | -- |
| `e2e-tests` | Playwright browser tests | PostgreSQL 15, Redis 7 | -- |
| `build-test` | Production build + Docker image build | None | -- |
| `security-audit` | npm audit + CodeQL static analysis | None | -- |
| `dependency-check` | Outdated and vulnerable dependency scan | None | -- |

All jobs run in parallel except the **test-summary** job, which waits for all other jobs and reports the final result.

### Lint and Type Check

Runs ESLint and the TypeScript compiler in check-only mode across all workspaces:

```bash
npm run lint
npm run typecheck
```

### Backend Tests

Starts PostgreSQL and Redis service containers, runs database migrations, then executes the API test suite. Coverage is uploaded to Codecov with the `backend` flag.

### Frontend Tests

Runs the Next.js component tests in isolation without any backend services.

### Build Test

Verifies that all packages build successfully in production mode and that Docker images can be built:

```bash
npm run build
docker build -f apps/api/Dockerfile -t guildserver-api:test .
docker build -f apps/web/Dockerfile -t guildserver-web:test .
```

### Security Audit

Runs two security checks:

1. **npm audit** at the `high` severity level -- fails the build if any high or critical vulnerabilities are found
2. **GitHub CodeQL** analysis for JavaScript and TypeScript -- detects security anti-patterns, injection flaws, and insecure data handling

### Dependency Check

Runs a softer audit at the `moderate` level and reports outdated dependencies. This job uses `|| true` on the outdated check so it reports without failing the build.

## Coverage

Backend test coverage is collected using Jest built-in coverage and uploaded to Codecov:

```yaml
- name: Upload backend coverage
  uses: codecov/codecov-action@v3
  with:
    files: ./apps/api/coverage/lcov.info
    flags: backend
    name: backend-coverage
```

Frontend coverage is uploaded separately:

```yaml
- name: Upload frontend coverage
  uses: codecov/codecov-action@v3
  with:
    files: ./apps/web/coverage/lcov.info
    flags: frontend
    name: frontend-coverage
```

:::info
Coverage targets are not enforced as hard gates in CI, but teams should aim for at least 80% line coverage on the API package and 70% on the web package.
:::

## Test Environment Variables

The following environment variables are used during testing:

| Variable | Value | Purpose |
|---|---|---|
| `TEST_DATABASE_URL` | `postgresql://test:test@localhost:5432/guildserver_test` | Backend test database |
| `DATABASE_URL` | `postgresql://test:test@localhost:5432/guildserver_e2e_test` | E2E test database |
| `REDIS_URL` | `redis://localhost:6379/1` (backend) or `/2` (E2E) | Redis test instances |
| `JWT_SECRET` | `test-jwt-secret-key-for-ci` | JWT signing key for tests |
| `NODE_ENV` | `test` | Disables production features |
| `CI` | `true` | Signals CI environment to Playwright |

## Best Practices

1. **Keep tests independent** -- each test should set up and tear down its own data. Do not rely on test execution order.

2. **Use descriptive test names** -- test names should read as specifications: "returns 404 when application does not exist" rather than "test error case".

3. **Mock at the boundary** -- mock external services (Docker, SMTP, Slack) but use real database connections for integration tests.

4. **Avoid snapshot tests for API responses** -- they break on any field addition. Use explicit assertions on specific fields.

5. **Run tests before pushing** -- execute `pnpm run test && pnpm run typecheck` locally before pushing to avoid CI failures.

## Related Pages

- [Development Setup](./development-setup) -- Setting up a local environment
- [Code Style](./code-style) -- Linting and formatting standards
- [Architecture](./architecture) -- How the system is structured
