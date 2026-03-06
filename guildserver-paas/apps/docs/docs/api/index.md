---
sidebar_position: 1
title: API Overview
description: Overview of the GuildServer API -- tRPC endpoints, REST compatibility, authentication, and error handling.
---

# API Overview

The GuildServer API is built with **tRPC** on top of Express.js, providing type-safe remote procedure calls between the frontend and backend. The API also supports traditional REST-style HTTP calls through the tRPC HTTP adapter.

## Base URL

All tRPC endpoints are available at:

\`\`\`
{API_URL}/trpc/{router}.{procedure}
\`\`\`

For example: \`http://localhost:3001/trpc/application.list\`

## Authentication

Most endpoints require authentication via JWT tokens. Include the token in the Authorization header:

\`\`\`
Authorization: Bearer <jwt-token>
\`\`\`

Obtain a token by calling the \`auth.login\` procedure with email and password credentials.

## Available Routers

| Router | Description |
|--------|-------------|
| **auth** | Login, register, token management |
| **application** | Application CRUD and deployment triggers |
| **deployment** | Deployment management and rollbacks |
| **database** | Database provisioning and management |
| **organization** | Organization CRUD and membership |
| **project** | Project management |
| **domain** | Custom domain configuration |
| **environment** | Environment variable management |
| **webhook** | Webhook delivery tracking |
| **billing** | Subscription, invoices, payment methods |
| **monitoring** | Metrics and health checks |
| **notification** | Notification management and preferences |
| **user** | User profile and account management |
| **kubernetes** | K8s cluster and deployment management |
| **workflow** | Workflow templates and executions |
| **audit** | Audit log queries |
| **github** | GitHub repository browsing |

## REST Endpoints

In addition to tRPC, the API exposes plain REST endpoints:

| Endpoint | Method | Description |
|----------|--------|-------------|
| /health | GET | Health check |
| /api-docs | GET | Swagger UI documentation |
| /webhooks/github | POST | GitHub webhook receiver |
| /webhooks/gitlab | POST | GitLab webhook receiver |
| /webhooks/stripe | POST | Stripe webhook receiver |
| /auth/github/callback | GET | GitHub OAuth callback |
| /auth/google/callback | GET | Google OAuth callback |

## WebSocket

Real-time events (deployment logs, status updates) are delivered via WebSocket at the API server's WebSocket endpoint.

## Error Handling

All tRPC errors follow a standard format with a code (e.g., UNAUTHORIZED, NOT_FOUND, BAD_REQUEST) and a human-readable message. HTTP status codes are mapped from tRPC error codes.
