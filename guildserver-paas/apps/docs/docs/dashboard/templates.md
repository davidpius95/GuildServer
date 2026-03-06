---
title: "Templates"
sidebar_position: 11
---

# Templates

The Templates page (`/dashboard/templates`) provides a curated catalog of pre-configured applications and services that you can deploy with one click. Templates cover Docker images for infrastructure services and Git-based framework starters built with Nixpacks.

## Page Layout

The page consists of:

1. **Header** -- title and description
2. **Search and filter bar** -- text search and category filter buttons
3. **Popular Templates** section (shown when no filters are active)
4. **All Templates** grid -- the full catalog with category and tag information
5. **Pre-deploy configuration dialog** -- environment variable editor before deployment

## Search and Filtering

### Text Search

A search input filters templates by name, description, or tags (case-insensitive).

### Category Filter

A row of buttons lets you filter by category. Clicking a category toggles it; clicking it again or clicking "All" shows all templates. Available categories are derived dynamically from the catalog:

| Category | Example Templates |
|---|---|
| **Web Servers** | Nginx, Caddy, Static HTML |
| **Databases** | PostgreSQL, MySQL, Redis, MongoDB, MariaDB |
| **CMS** | Ghost, WordPress, Directus, Strapi |
| **Frameworks** | Next.js, Astro, Django, Flask, Remix, Nuxt, Svelte, Vue.js, Vite, NestJS, Go Fiber, and more |
| **Monitoring** | Grafana, Uptime Kuma |
| **Storage** | MinIO |
| **Messaging** | RabbitMQ |
| **Automation** | n8n |
| **Analytics** | Plausible Analytics |
| **Developer Tools** | Gitea, Drone CI, Portainer |

## Popular Templates

When no search query or category filter is active, a featured section highlights popular templates in a 4-column grid. Popular templates are marked with a filled yellow star icon. The current popular templates include:

- Nginx
- PostgreSQL
- Redis
- Uptime Kuma
- Ghost
- Next.js
- Astro
- Django

Each popular template card shows the name, description, a badge (Docker image name or "Nixpacks" for Git templates), and a Deploy button.

## Template Types

### Docker Image Templates

Docker templates deploy a pre-built container image directly:

- **Image** specified as `image:tag` (e.g., `nginx:alpine`, `postgres:16-alpine`)
- **Container port** pre-configured for the service
- **Default environment variables** provided where needed (e.g., `POSTGRES_DB`, `POSTGRES_PASSWORD`)

### Git-Based Templates

Git templates clone a repository and build with Nixpacks:

- **Repository** -- points to the GuildServer examples repository on GitHub
- **Branch** -- typically `main`
- **Build path** -- subdirectory within the repository (e.g., `nextjs`, `Django-Example`, `astro`)
- **Build type** -- `nixpacks` for automatic language detection and build

Git templates are identified by a blue "Git" badge with a branch icon.

:::info
Git templates are built using Nixpacks, which automatically detects the programming language and framework to generate an optimized Docker image. No Dockerfile is required.
:::

## Template Card Details

Each template card in the main grid displays:

| Element | Description |
|---|---|
| **Icon** | A colored icon in a primary-tinted circle (globe, server, database, code, or boxes). |
| **Name** | The template name. |
| **Category** | Shown as a subtitle. |
| **Git badge** | Blue outline badge for Git-based templates. |
| **Star** | Filled yellow star for popular templates. |
| **Description** | Brief explanation of the template. |
| **Tags** | Outline badges for relevant tags (e.g., "web server", "proxy", "static"). |
| **Image / Build path** | Code-formatted source identifier (e.g., `nginx:alpine` or `nixpacks/nextjs`). |
| **Deploy button** | Triggers the pre-deploy configuration dialog. |

## Pre-Deploy Configuration

Clicking "Deploy" on any template opens a configuration dialog (modal overlay) instead of deploying immediately. This dialog shows:

- **Template name and description** with its icon
- **Source badge** (Docker image name or Nixpacks build type)
- **Port badge** showing the container port
- **Environment Variables editor** -- pre-populated with the template's default env vars. You can modify values, add new variables, or remove unneeded ones.
- **Cancel** and **Deploy** action buttons

:::tip
Always review the default environment variables before deploying. Placeholder values like `changeme` should be replaced with secure passwords, especially for database templates.
:::

## Deployment Process

When you click Deploy in the configuration dialog:

1. An application is created with a generated name (`template-id-timestamp`, e.g., `postgres-m4x9f2`)
2. For Docker templates: the image is pulled and a container is started
3. For Git templates: the repository is cloned, built with Nixpacks, and deployed
4. A deployment is triggered automatically after creation

A green success toast appears at the bottom-right with a "View" button that navigates to the [Application Detail](./app-detail.md) page for the newly created app.

## Empty State

When no templates match the search or category filter, an empty state appears with a dimmed search icon and the message: "No templates found. Try adjusting your search or filter."

## Related Pages

- [Applications](./applications-page.md) -- view and manage deployed template instances
- [Application Detail](./app-detail.md) -- configure environment variables and domains after deployment
- [Databases](./databases-page.md) -- manage database templates after deployment
