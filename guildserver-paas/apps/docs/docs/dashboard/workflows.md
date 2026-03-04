---
title: "Workflows"
sidebar_position: 12
---

# Workflows

The Workflows page (`/dashboard/workflows`) lets you create, manage, and monitor automated workflows for CI/CD pipelines, maintenance routines, and security scanning. Workflows automate multi-step processes and run on triggers like code pushes or schedules.

## Page Layout

The page consists of:

1. **Header** -- title, description, and a "Create Workflow" button
2. **Search bar** -- filters workflows by name or description
3. **Tab system** with three tabs: Workflows, Recent Runs, and Templates

## Workflows Tab

### Workflow Grid

Workflows are displayed in a responsive card grid (2 columns on medium screens, 3 on large screens). Each card contains:

**Header section:**
- A **workflow icon** (Workflow component icon)
- The **workflow name**
- A **kebab menu** button for additional actions
- A **description** of the workflow purpose
- A **status badge** (green for active, yellow for paused)
- A **type badge** (e.g., "cicd", "maintenance", "security")

**Details section:**

| Field | Description |
|---|---|
| **Trigger** | How the workflow is initiated: `push`, `schedule`, or `pull_request`. |
| **Last Run** | Relative timestamp of the most recent execution. |
| **Success Rate** | Percentage of successful runs (e.g., "95%"). |
| **Avg Duration** | Average execution time (e.g., "4m 32s"). |

**Steps preview:**

The first three steps of the workflow are listed with status icons:

| Step Status | Icon |
|---|---|
| `success` | Green checkmark |
| `failed` / `error` | Red X circle |
| `running` | Blue spinning clock |
| `warning` | Yellow alert circle |
| `pending` | Gray clock |

If the workflow has more than 3 steps, a "+N more steps" note is shown.

**Action buttons:**
- **Run** -- manually triggers the workflow
- **View** -- opens the workflow detail view
- **Settings** -- opens workflow configuration (gear icon)

### Workflow Types

GuildServer supports three workflow categories:

| Type | Description | Typical Trigger |
|---|---|---|
| **CI/CD** | Build, test, and deploy applications through a pipeline with optional approval gates. | Push / Pull Request |
| **Maintenance** | Database backups, cleanup tasks, health verification, and notification routines. | Schedule |
| **Security** | Dependency scanning, container security audits, code quality checks, and report generation. | Schedule |

### Workflow Statuses

| Status | Color | Description |
|---|---|---|
| **Active** | Green | Workflow is enabled and will run on trigger. |
| **Paused** | Yellow | Workflow is disabled and will not run until resumed. |

### Empty State

When no workflows match the search or none exist, an empty state displays with a Workflow icon and a "Create Workflow" button.

## Recent Runs Tab

The Recent Runs tab shows a list of workflow executions with details:

Each run entry displays:

| Field | Description |
|---|---|
| **Status icon** | Color-coded icon matching the run outcome. |
| **Workflow name** | The name of the executed workflow. |
| **Trigger** | What initiated the run (e.g., "push", "schedule", "pull_request"). |
| **Started at** | Full timestamp of when the run began. |
| **Duration** | How long the run took. |
| **Commit info** | For code-triggered runs: branch name and commit message with SHA. |
| **Status badge** | Color-coded badge (green for success, blue for running, red for failed). |
| **View Logs** button | Opens detailed execution logs. |

:::info
Workflow runs include commit context when triggered by code events. This links each run to the specific code change that initiated it, aiding in debugging failed runs.
:::

## Templates Tab

The Templates tab provides pre-built workflow configurations that you can use as starting points:

| Template | Description |
|---|---|
| **Node.js CI/CD** | Complete CI/CD pipeline for Node.js applications with testing and deployment stages. |
| **Database Maintenance** | Automated database backup, cleanup, and health monitoring workflow. |
| **Security Scanning** | Comprehensive security scanning for dependencies and containers. |
| **Multi-Environment Deploy** | Deploy applications across multiple environments with approval gates. |
| **Kubernetes Deployment** | Deploy and manage applications on Kubernetes clusters. |
| **Custom Workflow** | Start from scratch and build your own custom workflow. |

Each template card has a "Use Template" button (or "Create Custom" for the blank template) that initializes a new workflow with the template configuration.

## Creating a Workflow

Click the "Create Workflow" button in the header to start building a new workflow. You can either:

- Start from a **template** in the Templates tab for a pre-configured starting point
- Create a **custom workflow** from scratch

Workflow configuration includes:
- **Name** and **description**
- **Trigger type** (push, schedule, or manual)
- **Steps** -- ordered list of actions with configurable parameters
- **Approval gates** -- optional manual approval points between steps

## Workflow Steps

Each workflow consists of ordered steps. Common step types include:

| Step | Purpose |
|---|---|
| Checkout Code | Clone the repository |
| Build Application | Compile and package the application |
| Run Tests | Execute the test suite |
| Deploy to Staging | Deploy to the staging environment |
| Approval Gate | Wait for manual approval before proceeding |
| Deploy to Production | Deploy to the production environment |
| Create Database Dump | Back up a database |
| Upload to Storage | Store artifacts or backups |
| Verify Backup | Validate backup integrity |
| Scan Dependencies | Check for known vulnerabilities |
| Container Security Scan | Audit container images |
| Code Quality Check | Run linting and static analysis |
| Generate Report | Create execution summary |
| Send Notification | Alert team via configured channels |

:::tip
Use approval gates between staging and production deployments to add a human review step. This prevents accidental production deployments and gives your team a chance to verify staging behavior.
:::

## Related Pages

- [Deployments](./deployments-page.md) -- view deployment history created by CI/CD workflows
- [Applications](./applications-page.md) -- applications targeted by workflow deployments
- [Monitoring](./monitoring.md) -- track workflow-related metrics and alerts
- [Settings](./settings.md) -- configure notification channels for workflow events
