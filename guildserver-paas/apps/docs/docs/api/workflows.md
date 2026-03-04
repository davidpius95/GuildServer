---
sidebar_position: 16
title: Workflows API
description: Workflow template and execution management endpoints.
---

# Workflows API

All endpoints in this section are available through the `workflow` tRPC router. Access them via the tRPC client or the REST-style tRPC HTTP endpoint.

**Base path:** `/trpc/workflow.<procedure>`

## Procedures

### `listTemplates`

- **Type:** query
- **Description:** List workflow templates.
- **Input:** { organizationId }
- **Returns:** WorkflowTemplate[]

### `createTemplate`

- **Type:** mutation
- **Description:** Create a new workflow template.
- **Input:** { name, description?, definition, organizationId }
- **Returns:** WorkflowTemplate

### `updateTemplate`

- **Type:** mutation
- **Description:** Update a workflow template.
- **Input:** { id, name?, definition?, status? }
- **Returns:** WorkflowTemplate

### `executeWorkflow`

- **Type:** mutation
- **Description:** Start a workflow execution.
- **Input:** { templateId, context? }
- **Returns:** WorkflowExecution

### `listExecutions`

- **Type:** query
- **Description:** List workflow executions.
- **Input:** { templateId?, organizationId? }
- **Returns:** WorkflowExecution[]

### `approveStep`

- **Type:** mutation
- **Description:** Approve a pending approval request.
- **Input:** { approvalRequestId, comments? }

### `rejectStep`

- **Type:** mutation
- **Description:** Reject a pending approval request.
- **Input:** { approvalRequestId, comments? }


## Authentication

All endpoints require a valid JWT token in the Authorization header unless otherwise noted.
