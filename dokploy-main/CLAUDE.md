# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Dokploy is a free, self-hostable Platform as a Service (PaaS) that simplifies deployment and management of applications and databases. It's built as a monorepo with Next.js frontend, Node.js backend, and supporting services.

## Architecture

### Monorepo Structure
- **apps/dokploy/**: Main Next.js application with tRPC API
- **apps/api/**: Standalone API service  
- **apps/monitoring/**: Go-based monitoring service
- **apps/schedules/**: Node.js scheduling service
- **packages/server/**: Shared server utilities and schemas

### Core Technologies
- **Frontend**: Next.js 15, React 18, Tailwind CSS, Radix UI
- **Backend**: tRPC, Drizzle ORM, PostgreSQL
- **Authentication**: better-auth with 2FA support
- **Infrastructure**: Docker, Docker Compose, Traefik
- **Database**: PostgreSQL with extensive migrations (100+ files)
- **Monitoring**: Custom Go service with metrics collection
- **Queue System**: BullMQ with Redis
- **WebSockets**: Custom implementation for real-time features

### Key Features Architecture
- **Multi-tenant**: Project-based organization with user permissions
- **Docker Integration**: Full Docker API integration via dockerode
- **Git Providers**: GitHub, GitLab, Gitea, Bitbucket integrations
- **Database Support**: MySQL, PostgreSQL, MongoDB, MariaDB, Redis
- **Backup System**: Automated backups to external storage
- **Multi-server**: Remote server deployment via SSH
- **Real-time Monitoring**: WebSocket-based container logs and stats

## Development Commands

### Setup and Development
```bash
# Initial setup (creates database, runs migrations)
pnpm run dokploy:setup

# Start development server
pnpm run dokploy:dev

# Start with Turbopack (faster)
pnpm run dokploy:dev:turbopack

# Setup server-side development environment
pnpm run server:script
pnpm run server:dev
```

### Database Operations
```bash
# Run database migrations
pnpm run migration:run

# Generate new migration
pnpm run migration:generate

# Database studio (Drizzle Studio)
pnpm run studio

# Reset database
pnpm run db:clean

# Seed database
pnpm run db:seed
```

### Build and Production
```bash
# Build all packages
pnpm run build

# Build main application
pnpm run dokploy:build

# Start production server
pnpm run dokploy:start
```

### Docker Operations
```bash
# Build Docker image
pnpm run docker:build

# Build canary version
pnpm run docker:build:canary

# Push to registry
pnpm run docker:push
```

### Code Quality
```bash
# Format and lint (using Biome)
pnpm run check

# Type checking
pnpm run typecheck

# Run tests
pnpm run test
```

### Utilities
```bash
# Reset user password
pnpm run reset-password

# Reset 2FA
pnpm run reset-2fa
```

## Important Configuration

### Environment Setup
- Copy `apps/dokploy/.env.example` to `apps/dokploy/.env`
- Requires Docker to be running
- PostgreSQL and Redis are set up automatically during `dokploy:setup`

### Database Schema
- Uses Drizzle ORM with PostgreSQL
- Extensive schema in `packages/server/src/db/schema/`
- 100+ migrations in `apps/dokploy/drizzle/`
- Main tables: applications, projects, users, deployments, databases

### tRPC API Structure
- Router defined in `apps/dokploy/server/api/root.ts`
- 25+ feature routers (application, docker, project, etc.)
- All routers follow consistent patterns with Zod validation

## Development Guidelines

### Code Quality Tools
- **Biome**: Used for formatting, linting (replaces Prettier/ESLint)
- **Lefthook**: Git hooks for commit-msg and pre-commit
- **Conventional Commits**: Required for commit messages
- **TypeScript**: Strict configuration across all packages

### Testing
- **Vitest**: Test runner with config in `__test__/vitest.config.ts`
- Tests located in `apps/dokploy/__test__/`
- Focus on compose, deploy, and utility functions

### Branch Strategy
- `main`: Production-ready releases
- `canary`: Development branch for PRs
- Always branch from and PR to `canary`

## Key Implementation Details

### Docker Integration
- Full Docker API via dockerode
- Container management, logs, terminal access
- Custom networking and volume handling
- Support for Docker Compose and Swarm

### Real-time Features
- WebSocket implementation in `apps/dokploy/server/wss/`
- Real-time logs, terminal access, deployment status
- Docker stats monitoring

### Multi-server Architecture
- SSH-based remote server management
- Server validation and setup scripts
- Remote Docker API access

### Authentication & Security
- better-auth with session management
- 2FA with QR codes and backup codes
- Role-based permissions (admin, user, member)
- API key authentication for external access