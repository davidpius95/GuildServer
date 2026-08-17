# PaaS Landing Page Research

Internal strategy note. Do not render this comparison on the public landing page.

## Purpose

Use the market comparison to shape GuildServer positioning, product priorities, and landing-page flow. The public page should not mention competitors directly or expose a gap matrix.

## What strong PaaS landing pages do

- Lead with a short outcome promise, not a feature inventory.
- Show the deploy workflow visually within the hero or immediately after it.
- Reduce friction in the first CTA: start, import, deploy, or talk to sales.
- Explain the product in layers: build, deploy, run, observe, secure, scale.
- Make failure handling and preview workflow feel safe.
- Sell speed and simplicity, then reassure with infrastructure, security, and reliability.

## Competitor observations

### Vercel

- Current emphasis: agentic infrastructure, app and agent deployment, CI/CD, content delivery, fluid compute, observability, and security.
- Landing pattern: sharp headline, immediate deploy CTA, then product primitives and use cases.
- Lesson for GuildServer: keep hero focused on one big deployment promise; put primitives below the fold.

### DigitalOcean App Platform

- Current emphasis: simpler app launch, Git-based workflow, predictable pricing, static and dynamic apps, autoscaling, high availability, metrics, log forwarding, databases, and dedicated egress IPs.
- Landing pattern: approachable headline, cost/value reassurance, simple feature blocks, use cases, pricing entry points.
- Lesson for GuildServer: communicate simplicity and cost control without sounding like a generic cloud provider.

### AWS Amplify

- Current emphasis: frontend/full-stack developer experience on AWS, Git workflows, global hosting, auth, data, storage, functions, and per-developer environments.
- Landing pattern: developer-friendly AWS abstraction, “idea to app” framing, then full-stack features.
- Lesson for GuildServer: explain what the platform hides and what it still lets teams control.

### Cloudflare Pages + Workers

- Current emphasis: previews, collaboration, Access controls, analytics, global edge speed, SSL, HTTP/3, scalability, and security.
- Landing pattern: team workflow first, then infrastructure benefits.
- Lesson for GuildServer: preview links, custom domains, TLS, and logs should feel like default parts of deployment.

### Netlify

- Current emphasis: AI or Git to instant production, deploy previews, functions, database, observability, security, edge network, and multiple ways to start.
- Landing pattern: “start your way” with AI, Git, CLI, drag/drop paths, followed by workflow and use cases.
- Lesson for GuildServer: show multiple entry paths, but keep GitHub as the primary path.

### Render

- Current emphasis: cloud for builders, web services, private services, workers, cron jobs, Postgres, key-value, autoscaling, private networking, persistent disks, IaC, preview environments, zero-downtime deploys.
- Landing pattern: broad service catalog, migration hooks, production service types.
- Lesson for GuildServer: app, worker, database, and VPS should feel like parts of one service graph.

### Railway

- Current emphasis: deploy anything without complexity, visual infrastructure canvas, auto-config, instant networking, scaling, logs, metrics, alerts, PR previews, rollbacks.
- Landing pattern: strong visual workspace metaphor and “zero setup” language.
- Lesson for GuildServer: make infrastructure visible at a glance, not hidden behind jargon.

### Heroku

- Current emphasis: managed runtime, developer experience, app-centric delivery, data services, add-ons, operational experience, metrics, autoscaling, threshold alerts, compliance.
- Landing pattern: mature platform trust, app-centric language, ecosystem and operational support.
- Lesson for GuildServer: “app-centric” is still the clearest mental model for developers.

### Fly.io

- Current emphasis: globally distributed apps and machines, running closer to users, direct operational control, fast deploys, multi-region primitives.
- Landing pattern: technical but direct, oriented toward builders who care about runtime placement.
- Lesson for GuildServer: private or VPS-backed infrastructure can be a strength if presented as control and visibility, not complexity.

## GuildServer public positioning direction

Recommended tagline:

> Deploy apps without the infrastructure drag.

Supporting line:

> GuildServer gives teams a clean path from repository to live service: build the app, run the container, attach the domain, watch the logs, and keep moving.

Why this fits:

- It speaks to the user’s pain: infrastructure slows down shipping.
- It does not copy any competitor.
- It fits GitHub deploys, Docker images, databases, and VPS-backed workloads.
- It is broad enough for future autoscaling, previews, and managed databases.

## Product gaps to prioritize internally

1. GitHub import should require the fewest possible decisions: repo, branch, app name, deploy.
2. Deploy failures should be classified as clone, build, runtime, health check, or missing configuration.
3. PR preview deployments need automatic creation, comments, permissions, and cleanup.
4. Database UX needs supported-engine clarity, backups, restores, connection strings, and app linking.
5. Autoscaling should begin with simple min/max replicas and visible cost impact.
6. Secrets need environment scopes, safe editing, audit trail, and rotation guidance.
7. Observability should combine logs, metrics, container state, deploy event timeline, and recommended fix.

## Sources

- Vercel homepage: https://vercel.com/
- DigitalOcean App Platform: https://www.digitalocean.com/products/app-platform
- AWS Amplify: https://aws.amazon.com/amplify/
- Cloudflare Pages: https://pages.cloudflare.com/
- Netlify homepage: https://www.netlify.com/
- Render homepage: https://render.com/
- Railway homepage: https://railway.com/
- Heroku platform: https://www.heroku.com/platform/
- Fly.io docs/pricing and product pages: https://fly.io/docs/
