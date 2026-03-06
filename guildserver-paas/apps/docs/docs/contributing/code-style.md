---
title: "Code Style"
sidebar_position: 5
---

# Code Style

GuildServer enforces consistent code style across the entire monorepo through ESLint, Prettier, and TypeScript strict mode. All style checks run automatically in CI and must pass before a pull request can be merged.

## Toolchain

| Tool | Version | Config File | Purpose |
|---|---|---|---|
| ESLint | Latest | `.eslintrc` | Code quality rules and style linting |
| Prettier | Latest | `.prettierrc` | Opinionated code formatting |
| TypeScript | 5.3+ | `tsconfig.json` | Static type checking in strict mode |
| Turborepo | Latest | `turbo.json` | Monorepo task orchestration |

## Running Linters

```bash
# Lint all packages
pnpm run lint

# Auto-fix lint errors where possible
pnpm run lint:fix

# Format all files with Prettier
pnpm run format

# Type check all packages (no emit)
pnpm run typecheck
```

These commands are defined in the root `package.json` and use Turborepo to run across all workspaces in parallel.

## TypeScript Conventions

### Strict Mode

All `tsconfig.json` files enable strict mode:

```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitReturns": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

### Type Safety Rules

- **Avoid `any`** -- use `unknown` and narrow with type guards, or define a proper interface. The ESLint rule `@typescript-eslint/no-explicit-any` warns on any usage.
- **Prefer `type` imports** -- use `import type { Foo }` when importing only types. This ensures the import is erased at compile time.
- **Explicit return types on exported functions** -- public API boundaries should have explicit return types so consumers see stable types even if the implementation changes.
- **Use `satisfies`** -- prefer `satisfies` over type assertions (`as`) when you want to validate a value matches a type without widening.

```typescript
// Preferred: explicit return type on exported function
export function getAppStatus(app: Application): ApplicationStatus {
  return app.status ?? "inactive";
}

// Preferred: type import
import type { Application } from "@guildserver/database";

// Preferred: satisfies over as
const config = {
  port: 4000,
  host: "0.0.0.0",
} satisfies ServerConfig;
```

## Naming Conventions

### Files

| Context | Convention | Example |
|---|---|---|
| Source files | kebab-case | `metrics-collector.ts` |
| Test files | kebab-case with `.test` suffix | `metrics-collector.test.ts` |
| React components | PascalCase | `ApplicationCard.tsx` |
| React component tests | PascalCase with `.test` suffix | `ApplicationCard.test.tsx` |
| Config files | Standard names | `tsconfig.json`, `.eslintrc` |

### Variables and Functions

| Context | Convention | Example |
|---|---|---|
| Local variables | camelCase | `containerPort` |
| Functions | camelCase | `getContainerStats()` |
| Constants | UPPER_SNAKE_CASE | `MAX_CONCURRENT_BUILDS` |
| Boolean variables | `is`/`has`/`should` prefix | `isRunning`, `hasDeployments` |
| Private class members | leading underscore (optional) | `_internalCache` |

### Types and Interfaces

| Context | Convention | Example |
|---|---|---|
| Types | PascalCase | `DeploymentStatus` |
| Interfaces | PascalCase (no `I` prefix) | `ApplicationConfig` |
| Enums | PascalCase | `BuildType` |
| Enum members | PascalCase or UPPER_SNAKE_CASE | `Dockerfile`, `NIXPACKS` |
| Generics | Single uppercase letter or descriptive | `T`, `TInput`, `TOutput` |

### Database

| Context | Convention | Example |
|---|---|---|
| Table names | snake_case, plural | `applications`, `audit_logs` |
| Column names | camelCase (Drizzle maps to snake_case) | `containerPort`, `buildType` |
| Enum types | snake_case | `user_role`, `build_type` |
| Index names | Descriptive composite | `metrics_app_name_ts_idx` |

## Import Organization

Imports should be grouped in the following order, separated by blank lines:

```typescript
// 1. Node.js built-in modules
import path from "path";
import fs from "fs";

// 2. External packages
import { Router } from "express";
import { z } from "zod";
import { eq, and, desc } from "drizzle-orm";

// 3. Internal packages (workspace imports)
import { db, applications, deployments } from "@guildserver/database";

// 4. Relative imports (parent directories first, then siblings)
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { dockerService } from "../services/docker";
import { logger } from "../utils/logger";

// 5. Type-only imports (at the end)
import type { Application, Deployment } from "@guildserver/database";
```

:::tip
ESLint enforces import ordering automatically. Run `pnpm run lint:fix` to auto-sort imports.
:::

## tRPC Conventions

### Router Organization

Each domain gets its own router file in `apps/api/src/routers/`:

```
routers/
├── auth.ts           # Authentication procedures
├── application.ts    # Application CRUD and deployment
├── project.ts        # Project management
├── organization.ts   # Organization and member management
├── monitoring.ts     # Metrics and health checks
├── environment.ts    # Environment variable management
└── index.ts          # Root router merging all sub-routers
```

### Procedure Naming

Use descriptive, action-oriented names:

```typescript
export const applicationRouter = createTRPCRouter({
  // Queries: noun or get + noun
  list: protectedProcedure.input(...).query(...),
  getById: protectedProcedure.input(...).query(...),
  getMetrics: protectedProcedure.input(...).query(...),

  // Mutations: verb + noun
  create: protectedProcedure.input(...).mutation(...),
  update: protectedProcedure.input(...).mutation(...),
  delete: protectedProcedure.input(...).mutation(...),
  deploy: protectedProcedure.input(...).mutation(...),
  restart: protectedProcedure.input(...).mutation(...),
});
```

### Input Validation

Always validate inputs with Zod schemas. Place complex schemas in separate files if they exceed 10 lines:

```typescript
const deployInput = z.object({
  id: z.string().uuid(),
  title: z.string().min(1).max(255).optional(),
  description: z.string().max(1000).optional(),
});

export const applicationRouter = createTRPCRouter({
  deploy: protectedProcedure
    .input(deployInput)
    .mutation(async ({ ctx, input }) => {
      // Implementation
    }),
});
```

### Error Handling in tRPC

Use tRPC error codes consistently:

```typescript
import { TRPCError } from "@trpc/server";

// 401 - Not authenticated
throw new TRPCError({ code: "UNAUTHORIZED", message: "Login required" });

// 403 - Not authorized
throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });

// 404 - Resource not found
throw new TRPCError({ code: "NOT_FOUND", message: "Application not found" });

// 400 - Validation failed
throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid port number" });

// 409 - Conflict
throw new TRPCError({ code: "CONFLICT", message: "Name already taken" });

// 500 - Internal error
throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Docker unavailable" });
```

## React and Next.js Conventions

### Component Structure

```typescript
// 1. Imports
import { useState } from "react";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import type { Application } from "@guildserver/database";

// 2. Types (if component-specific)
interface ApplicationCardProps {
  app: Application;
  onDeploy: (id: string) => void;
}

// 3. Component definition (named export for pages, default export for components)
export function ApplicationCard({ app, onDeploy }: ApplicationCardProps) {
  // 3a. Hooks first
  const [isDeploying, setIsDeploying] = useState(false);

  // 3b. Derived state
  const isRunning = app.status === "running";

  // 3c. Event handlers
  const handleDeploy = async () => {
    setIsDeploying(true);
    await onDeploy(app.id);
    setIsDeploying(false);
  };

  // 3d. Render
  return (
    <Card>
      <CardHeader>{app.name}</CardHeader>
      <CardContent>
        <p>Status: {app.status}</p>
        <button onClick={handleDeploy} disabled={isDeploying}>
          Deploy
        </button>
      </CardContent>
    </Card>
  );
}
```

### File Organization

```
apps/web/src/
├── app/                    # Next.js App Router pages
│   ├── layout.tsx          # Root layout
│   ├── page.tsx            # Landing page
│   ├── auth/
│   │   └── login/page.tsx  # Login page
│   └── dashboard/
│       ├── layout.tsx      # Dashboard layout with sidebar
│       ├── page.tsx        # Dashboard home
│       └── applications/
│           └── page.tsx    # Applications list
├── components/
│   ├── ui/                 # shadcn/ui primitives (button, card, dialog)
│   ├── layout/             # Layout components (sidebar, header)
│   └── features/           # Feature-specific components
└── lib/
    ├── trpc.ts             # tRPC client setup
    ├── utils.ts            # Utility functions
    └── hooks/              # Custom React hooks
```

### Styling with Tailwind CSS

Use the `cn()` utility (from `lib/utils.ts`) to merge Tailwind classes conditionally:

```typescript
import { cn } from "@/lib/utils";

<div className={cn(
  "rounded-lg border p-4",
  isActive && "border-green-500 bg-green-50",
  isError && "border-red-500 bg-red-50"
)} />
```

Use shadcn/ui components as the foundation. Avoid writing custom CSS unless absolutely necessary.

## Git Conventions

### Branch Naming

```
feature/add-kubernetes-support
fix/deployment-timeout-handling
docs/update-ssl-guide
refactor/extract-docker-service
chore/upgrade-dependencies
```

### Commit Messages

Follow the [Conventional Commits](https://www.conventionalcommits.org/) format:

```
<type>(<scope>): <short description>

<optional body>

<optional footer>
```

**Types:**

| Type | When to Use |
|---|---|
| `feat` | New feature or capability |
| `fix` | Bug fix |
| `docs` | Documentation changes only |
| `refactor` | Code change that neither fixes a bug nor adds a feature |
| `test` | Adding or modifying tests |
| `chore` | Dependency updates, CI changes, tooling |
| `perf` | Performance improvement |
| `style` | Code style changes (formatting, semicolons) |

**Examples:**

```
feat(api): add container metrics collection endpoint
fix(web): prevent dashboard crash when org has no projects
docs(contributing): add testing guide with CI pipeline details
refactor(api): extract notification service from router
test(api): add integration tests for deployment rollback
chore: upgrade drizzle-orm to 0.30.x
```

:::info
The CI pipeline does not enforce conventional commits as a gate, but following this format keeps the git history readable and enables automated changelog generation.
:::

### Pull Request Guidelines

1. **Keep PRs focused** -- one feature or fix per PR. Large PRs are harder to review and more likely to introduce regressions.

2. **Include a description** -- explain what the PR does and why. Link to related issues.

3. **All CI checks must pass** -- lint, typecheck, backend tests, frontend tests, E2E tests, build, and security audit.

4. **Request a review** -- at least one approval is required before merging.

5. **Squash and merge** -- use squash merging to keep the main branch history clean.

## Error Handling

### API Layer

Always log errors with context before throwing tRPC errors:

```typescript
import { logger } from "../utils/logger";

try {
  await dockerService.createContainer(config);
} catch (error) {
  logger.error("Failed to create container", {
    applicationId: app.id,
    error: error instanceof Error ? error.message : String(error),
  });
  throw new TRPCError({
    code: "INTERNAL_SERVER_ERROR",
    message: "Failed to create container",
  });
}
```

### Frontend Layer

Use error boundaries for unexpected errors and explicit error states for expected failures:

```typescript
const { data, error, isLoading } = trpc.application.list.useQuery({
  projectId,
});

if (error) {
  return <ErrorAlert message={error.message} />;
}
```

## Logging Standards

Use the Winston logger (not `console.log`) in all backend code:

```typescript
import { logger } from "../utils/logger";

// Structured logging with context
logger.info("Deployment started", {
  applicationId: app.id,
  deploymentId: deployment.id,
});

logger.warn("Container health check failed", {
  applicationId: app.id,
  attempt: retryCount,
});

logger.error("Build failed", {
  applicationId: app.id,
  error: err.message,
  buildType: app.buildType,
});
```

See the [Logging](../monitoring/logging) page for full details on the logging configuration.

## Related Pages

- [Development Setup](./development-setup) -- Local environment configuration
- [Testing](./testing) -- Test framework and CI pipeline
- [Architecture](./architecture) -- System design and patterns
- [Database Schema](./database-schema) -- Table definitions and naming
