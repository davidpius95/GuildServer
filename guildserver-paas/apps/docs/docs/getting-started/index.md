---
sidebar_position: 1
slug: /getting-started
title: What is GuildServer?
description: Learn about GuildServer PaaS — an enterprise-grade, self-hosted platform for deploying, scaling, and managing applications and databases.
---

# What is GuildServer?

GuildServer is an **enterprise-grade, self-hosted Platform as a Service (PaaS)** that gives your team a complete deployment and application management platform on your own infrastructure. Think of it as your private Heroku, Vercel, or Railway — with full control over data, networking, and costs.

GuildServer handles the entire application lifecycle: from pushing code to running containers, provisioning databases, managing domains with automatic SSL, and monitoring health in real time.

## Key Features

- **Application Deployments** — Deploy from Git repositories, Docker images, or file uploads. Supports Dockerfiles, Nixpacks, Heroku buildpacks, Paketo, and static site builds.
- **Managed Databases** — Provision PostgreSQL, MySQL, MongoDB, and Redis instances with automatic credential management, external port access, and resource limits.
- **Custom Domains & SSL** — Attach any domain to your applications with automatic Let's Encrypt certificate provisioning, DNS verification, and forced HTTPS.
- **Team Management** — Multi-tenant organizations with owner, admin, and member roles. Granular per-project and per-application access controls.
- **Real-time Monitoring** — Application metrics, deployment logs via WebSocket, health checks, and integration with Prometheus and Grafana.
- **Billing & Usage Tracking** — Built-in Stripe integration with Hobby, Pro, and Enterprise plans. Usage metering for deployments, bandwidth, build minutes, and storage.
- **Enterprise Security** — SSO via SAML and OIDC, two-factor authentication, AES-256 encrypted environment variables, API key management, and full audit logging.
- **Kubernetes Support** — Deploy to Kubernetes clusters with Helm chart management, namespace isolation, and multi-cluster orchestration.
- **Preview Deployments** — Automatic ephemeral environments for pull requests with configurable TTL.
- **Workflow Automation** — Configurable deployment pipelines with approval gates for enterprise teams.

## Architecture Overview

GuildServer is built as a monorepo with clearly separated concerns:

```
                                +-------------------+
                                |   Web Dashboard   |
                                |  (Next.js 15 +    |
                                |   React + tRPC)   |
                                +--------+----------+
                                         |
                                    tRPC / HTTP
                                         |
                                +--------v----------+
                                |    API Server      |
                                | (Express + tRPC +  |
                                |  WebSocket + REST) |
                                +--------+----------+
                                         |
                    +--------------------+--------------------+
                    |                    |                    |
           +--------v------+    +-------v-------+   +-------v-------+
           |  PostgreSQL   |    |     Redis     |   |    Docker     |
           |  (Drizzle ORM)|    |   (BullMQ     |   | (Dockerode /  |
           |               |    |    Queues)    |   |  Kubernetes)  |
           +---------------+    +---------------+   +-------+-------+
                                                            |
                                                    +-------v-------+
                                                    |    Traefik    |
                                                    | (Reverse Proxy|
                                                    |  + Auto SSL)  |
                                                    +---------------+
```

| Component | Technology | Purpose |
|-----------|-----------|---------|
| **Frontend** | Next.js 15, React 18, TailwindCSS, Radix UI | Dashboard for managing applications, deployments, and team settings |
| **API** | Express, tRPC, WebSocket | Backend handling all business logic, authentication, and deployment orchestration |
| **Database** | PostgreSQL 15, Drizzle ORM | Persistent storage for all platform data |
| **Queue** | Redis 7, BullMQ | Background job processing for builds, deployments, and notifications |
| **Proxy** | Traefik v3 | Reverse proxy with automatic HTTPS and dynamic routing to deployed containers |
| **Container Runtime** | Docker / Kubernetes | Runs deployed applications as isolated containers |
| **CLI** | Commander.js, Chalk, Inquirer | Terminal-based management tool (`gs` / `guildserver` commands) |

## Who is GuildServer For?

- **Development teams** that want the convenience of a managed PaaS without vendor lock-in or data residency concerns.
- **DevOps engineers** looking for a self-hosted deployment platform with built-in CI/CD, monitoring, and infrastructure management.
- **Startups and agencies** that need to manage multiple client projects with team isolation, billing, and access control.
- **Enterprises** with compliance requirements (SOC 2, HIPAA) that need to run on private infrastructure with SSO, audit logging, and approval workflows.

## Next Steps

Ready to get started? Follow the [5-Minute Quickstart](/getting-started/quickstart) to have GuildServer running locally in minutes, or read the [Detailed Installation Guide](/getting-started/installation) for production-ready setup options.
