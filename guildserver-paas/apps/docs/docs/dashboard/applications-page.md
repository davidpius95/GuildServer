---
title: "Applications"
sidebar_position: 2
---

# Applications

The Applications page (`/dashboard/applications`) is where you create, search, deploy, and manage all of your applications. It presents a responsive card grid with real-time status information and inline actions.

## Page Layout

The page consists of three main sections:

1. **Header** -- page title, description, and a "New Application" button
2. **Search bar** -- full-text search across application names
3. **Application grid** -- responsive card layout (2 columns on medium screens, 3 on large screens)

Application data is fetched from the `application.list` tRPC endpoint, scoped to the current project, and refreshes automatically every **30 seconds**.

## Application Cards

Each card displays the following information:

| Field | Description |
|---|---|
| **Name** | Application name, rendered as a link to the [Application Detail](./app-detail.md) page. Hovering prefetches the detail data for instant navigation. |
| **Status badge** | Color-coded badge: green for `running`, blue for `deploying`/`building`, red for `failed`, yellow for `stopped`. |
| **Source type badge** | Either "Docker" (with container icon) or the source type name (with Git branch icon). |
| **URL** | The primary active domain, rendered as an external link. Only shown if the app has a verified domain. |
| **Image / Repo** | For Docker apps: `image:tag`. For Git apps: the repository URL. |
| **Last updated** | Formatted timestamp of the most recent update. |

### Inline Actions

Each card includes three action buttons at the bottom:

- **Deploy** -- triggers an immediate deployment. Uses optimistic updates to show "deploying" status before the API responds.
- **Restart** -- restarts the running container.
- **Delete** -- opens a confirmation dialog. The dialog warns that the action will permanently stop and remove the container.

:::warning
Deleting an application is irreversible. The container, associated deployments, and configuration will be permanently removed. Consider stopping the app first if you only need to pause it.
:::

## Search and Filtering

The search bar filters applications by name (case-insensitive). The filter applies client-side against the full list of applications returned by the API.

When no applications match the current search, a contextual empty state appears with a "Clear search" button.

## Create Application Modal

Clicking "New Application" (or navigating to `/dashboard/applications?action=create`) opens a responsive modal. On desktop browsers it renders as a **Dialog**; on mobile devices it renders as a **Drawer** that slides up from the bottom.

### Application Name

Every application requires a unique name. Enter it in the "Application Name" field (e.g., `my-awesome-app`).

### Source Type Selection

A toggle lets you choose between two deployment modes:

#### Docker Image Mode

When "Docker Image" is selected, you provide:

| Field | Default | Description |
|---|---|---|
| **Docker Image** | `nginx` | The image name from any Docker registry. |
| **Tag** | `alpine` | The image tag to pull. |

#### Git Repository Mode

When "Git Repository" is selected, behavior depends on whether GitHub is connected:

**With GitHub connected (OAuth with repo scope):**

- A **repository browser** lists your GitHub repositories with search, similar to Vercel
- Selecting a repo populates the repository URL and default branch automatically
- A **branch selector** dropdown loads all branches from the selected repository
- Private repos are labeled with a "Private" badge
- You can also enter a repository URL manually

**Without GitHub connected:**

- A prompt suggests connecting GitHub for easier repo selection, with a "Connect" button
- You can still manually enter the repository URL and branch name

:::tip
Connect your GitHub account in [Settings > Integrations](./settings.md) to enable the repository browser. You need to grant the `repo` scope for full access to private repositories.
:::

### Environment Variables

An expandable **Environment Variables** section (collapsed by default) lets you define key-value pairs that will be injected into the container at deploy time. You can add multiple entries, and empty keys are automatically filtered out during creation.

### Creating the Application

Clicking "Create Application" sends the configuration to the `application.create` endpoint. The request includes:

- `name` -- the application name
- `projectId` -- the current project context
- `sourceType` -- either `docker` or `github`
- `buildType` -- defaults to `dockerfile`
- Docker-specific fields: `dockerImage`, `dockerTag`
- Git-specific fields: `repository`, `branch`
- `environment` -- the key-value env var map

On success, the modal closes, the form resets, and the application list refreshes.

## Empty State

When no applications exist and no search filter is active, the page displays an empty state with:

- A rocket icon
- The message "No applications yet"
- A description: "Get started by deploying your first application from Docker or Git."
- A "New Application" call-to-action button

## Optimistic Updates

The applications page uses optimistic updates for a responsive experience:

- **Deploy**: immediately sets the app status to "deploying" in the UI before the API confirms
- **Delete**: immediately removes the card from the grid, rolling back if the API returns an error

## Related Pages

- [Application Detail](./app-detail.md) -- per-app configuration, logs, and deployment history
- [Deployments](./deployments-page.md) -- cross-application deployment history
- [Templates](./templates.md) -- deploy pre-configured applications with one click
