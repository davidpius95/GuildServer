# Proxmox Infrastructure Integration via Proxmox VE API

## Context

**Problem**: GuildServer currently deploys all apps to the local Docker daemon only. Users want to use their Proxmox servers as deployment infrastructure, so when a user deploys a service or app, GuildServer provisions resources from the Proxmox server(s).

**Goal**: Allow admins to register Proxmox VE nodes, then deploy user apps inside LXC containers (with Docker inside) on those nodes. Uses the **Proxmox VE REST API** for all Proxmox operations — no SSH needed.

**Architecture**: Proxmox API → Create LXC container → Docker daemon inside LXC (exposed on TCP :2375) → Deploy app containers via `dockerode` over TCP.

**User decisions**:
- Deploy mode: **LXC + Docker** (Docker runs inside LXC containers on Proxmox)
- Scale: **Multiple Proxmox servers** supported
- Local Docker: **Keep both** — local Docker stays as "local" target, Proxmox is an additional target
- Networking: **Standard bridge (vmbr0)**

---

## Phase 1: Database — `infrastructureNodes` Table

**File**: `packages/database/src/schema/index.ts`

Add new enum and table:

```
nodeStatusEnum: "online" | "offline" | "maintenance" | "error"

infrastructureNodes table:
- id: UUID (PK)
- name: VARCHAR(255) — friendly name ("Proxmox-Main")
- type: VARCHAR(50) — "proxmox" (extensible for future bare-metal, etc.)
- host: VARCHAR(255) — Proxmox API URL (e.g., "https://192.168.1.100:8006")
- tokenId: TEXT — Proxmox API token ID (e.g., "root@pam!guildserver")
- tokenSecret: TEXT — Proxmox API token secret
- defaultNode: VARCHAR(255) — Proxmox node name (e.g., "pve", "proxmox1")
- defaultStorage: VARCHAR(255) — Storage pool for LXC (e.g., "local-lvm")
- defaultBridge: VARCHAR(255) — Network bridge (default "vmbr0")
- templateId: VARCHAR(255) — CT template for LXC (e.g., "local:vztmpl/ubuntu-22.04-standard_22.04-1_amd64.tar.zst")
- status: nodeStatusEnum — current health status
- metadata: JSONB — extra config (available memory, CPU cores, etc.)
- organizationId: UUID (FK → organizations, nullable for global nodes)
- lastHealthCheck: TIMESTAMP
- createdAt, updatedAt
```

Add columns to `applications` table:
- `nodeId: UUID` (FK → infrastructureNodes, nullable) — which node to deploy on
- `deployTarget: VARCHAR(50)` default "local" — "local" | "proxmox"

Add columns to `deployments` table:
- `nodeId: UUID` (FK → infrastructureNodes, nullable) — which node was used
- `proxmoxVmId: INTEGER` (nullable) — the LXC VMID on Proxmox

Add Drizzle relations and indexes. Then `pnpm --filter @guildserver/database db:push`.

---

## Phase 2: Proxmox API Service

**New file**: `apps/api/src/services/proxmox.ts`

A service that wraps the Proxmox VE REST API. **No npm dependencies needed** — uses native `fetch()` against the Proxmox API.

### Proxmox API Authentication
Uses API token auth (not username/password): every request includes header `Authorization: PVEAPIToken=<tokenId>=<tokenSecret>`. TLS verification is skipped for self-signed certs (common in Proxmox).

### Key Functions

| Function | Proxmox API Endpoint | Purpose |
|----------|---------------------|---------|
| `testConnection(node)` | `GET /api2/json/version` | Verify API connectivity |
| `getNodeStatus(node)` | `GET /api2/json/nodes/{node}/status` | CPU, memory, disk usage |
| `listLxcContainers(node)` | `GET /api2/json/nodes/{node}/lxc` | List all LXC containers |
| `createLxcContainer(node, opts)` | `POST /api2/json/nodes/{node}/lxc` | Create new LXC with Docker-ready config |
| `startLxcContainer(node, vmid)` | `POST /api2/json/nodes/{node}/lxc/{vmid}/status/start` | Start LXC |
| `stopLxcContainer(node, vmid)` | `POST /api2/json/nodes/{node}/lxc/{vmid}/status/stop` | Stop LXC |
| `deleteLxcContainer(node, vmid)` | `DELETE /api2/json/nodes/{node}/lxc/{vmid}` | Delete LXC |
| `getLxcStatus(node, vmid)` | `GET /api2/json/nodes/{node}/lxc/{vmid}/status/current` | Get LXC status + resource usage |
| `execInLxc(node, vmid, cmd)` | `POST /api2/json/nodes/{node}/lxc/{vmid}/exec` (or via vncterm API) | Run commands inside LXC |
| `getNextVmId(node)` | `GET /api2/json/cluster/nextid` | Get next available VMID |
| `waitForTask(node, upid)` | `GET /api2/json/nodes/{node}/tasks/{upid}/status` | Poll task until completion |
| `listStorages(node)` | `GET /api2/json/nodes/{node}/storage` | List available storage pools |
| `listTemplates(node)` | `GET /api2/json/nodes/{node}/aplinfo` | List available CT templates |

### LXC Creation Config

When creating an LXC for app deployment, use these settings:
```
{
  ostemplate: node.templateId,      // Ubuntu 22.04 template
  hostname: `gs-app-${appName}`,
  memory: 1024,                     // 1GB RAM (configurable)
  swap: 512,
  cores: 2,                         // (configurable)
  rootfs: `${storage}:8`,           // 8GB disk
  net0: `name=eth0,bridge=${bridge},ip=dhcp`,
  unprivileged: 0,                  // Privileged — required for Docker
  features: "nesting=1,keyctl=1",   // Required for Docker inside LXC
  start: 1,                         // Auto-start after creation
  onboot: 1,
}
```

### Docker Setup Inside LXC

After LXC creation and start, run setup commands via the Proxmox exec API:
1. `apt-get update && apt-get install -y docker.io`
2. Configure Docker daemon to listen on TCP: write `/etc/docker/daemon.json` with `{"hosts": ["unix:///var/run/docker.sock", "tcp://0.0.0.0:2375"]}`
3. `systemctl restart docker`
4. Verify: `docker info`

The Docker daemon is then reachable from GuildServer at `http://<lxc-ip>:2375`.

---

## Phase 3: Node Docker Client Pool

**New file**: `apps/api/src/services/node-docker.ts`

Manages `dockerode` client instances for each registered infrastructure node.

| Function | Purpose |
|----------|---------|
| `getDockerClient(nodeId)` | Returns cached `dockerode` instance connected via TCP to the LXC's Docker daemon |
| `getLocalDockerClient()` | Returns the local Docker client (existing behavior) |
| `resolveDockerClient(app)` | Given an app, returns the right Docker client (local or remote based on `deployTarget`) |
| `removeClient(nodeId)` | Remove cached client on node deletion |

Each remote client connects via: `new Docker({ host: lxcIpAddress, port: 2375, protocol: 'http' })`.

### Integration with existing `docker.ts`

Modify the existing functions in `docker.ts` to accept an **optional `dockerClient?: Docker`** parameter. When provided, use that client instead of the local singleton. This keeps backward compatibility — all existing code continues to work unchanged (uses local Docker), while remote deploys pass in the remote client.

Functions to parameterize:
- `ensureNetwork(dockerClient?)`
- `pullImage(image, tag, userId, deploymentId, dockerClient?)`
- `removeExistingContainers(appId, opts?, dockerClient?)`
- `deployContainer(opts, dockerClient?)`
- `getAppContainer(appId, dockerClient?)`
- `getAppContainerInfo(appId, dockerClient?)`
- `getContainerLogs(appId, lines, dockerClient?)`
- `getContainerStats(appId, dockerClient?)`
- `restartContainer(appId, dockerClient?)`
- `stopContainer(appId, dockerClient?)`

Similarly update `container-manager.ts` functions.

---

## Phase 4: Node Scheduler

**New file**: `apps/api/src/services/node-scheduler.ts`

Decides which node to deploy on. Simple **least-connections** strategy:

| Function | Purpose |
|----------|---------|
| `selectNode(orgId?)` | Pick the node with fewest running containers |
| `getNodeLoad(nodeId)` | Query Proxmox API for node CPU/memory usage |

Logic:
1. Query `infrastructureNodes` where status = "online"
2. For each, get current LXC count + resource usage via Proxmox API
3. Return the node with the most available resources
4. If no healthy nodes, fall back to local Docker

---

## Phase 5: Deployment Pipeline Changes

**File**: `apps/api/src/queues/setup.ts`

Modify the deployment worker to support Proxmox targets:

```
1. Fetch app from DB (already done)
2. NEW: Check app.deployTarget
   - If "proxmox":
     a. Resolve target node (app.nodeId or auto-select via scheduler)
     b. Check if an LXC already exists for this app (stored in deployment metadata)
     c. If no LXC: create one via Proxmox API, wait for it to start, install Docker
     d. Get Docker client for LXC IP
     e. Pass remote dockerClient to buildImage() and deployContainer()
   - If "local" (default): use existing local Docker flow (unchanged)
3. Build image (locally or on remote Docker)
4. Deploy container (locally or on remote Docker)
5. Store proxmoxVmId in deployment record
```

**File**: `apps/api/src/services/builder.ts`

Modify `buildImage()` to accept optional `dockerClient` parameter for remote builds. The Docker build context (tar stream) is sent to the remote daemon.

---

## Phase 6: tRPC Router — Infrastructure Management

**New file**: `apps/api/src/routers/infrastructure.ts`

Admin-only tRPC router:

| Procedure | Purpose |
|-----------|---------|
| `infrastructure.list` | List all registered nodes with status |
| `infrastructure.getById` | Get node details + live resource stats from Proxmox API |
| `infrastructure.create` | Register a new Proxmox node (validates connection first) |
| `infrastructure.update` | Update node settings |
| `infrastructure.delete` | Remove node (checks no active deployments) |
| `infrastructure.testConnection` | Test Proxmox API connectivity + return version info |
| `infrastructure.getNodeResources` | Live CPU/memory/disk from Proxmox API |
| `infrastructure.listLxcContainers` | List LXC containers on a node |
| `infrastructure.listStorages` | List storage pools (for setup wizard) |
| `infrastructure.listTemplates` | List available CT templates |
| `infrastructure.setMaintenance` | Toggle maintenance mode (stops new deploys to this node) |

**Register in**: `apps/api/src/trpc/router.ts` — add `infrastructure: infrastructureRouter`

---

## Phase 7: Frontend — Infrastructure Management Page

**New file**: `apps/web/src/app/dashboard/infrastructure/page.tsx`

Admin page for managing Proxmox nodes:

- **Node list**: cards showing each node with name, host, status (green/red dot), CPU/memory bars
- **Add node modal**: form fields for name, host URL, API token ID, API token secret, Proxmox node name, storage, bridge, CT template. "Test Connection" button that calls `infrastructure.testConnection`.
- **Node detail view**: live resource usage (CPU%, memory%, disk%), list of LXC containers, action buttons (maintenance toggle, edit, delete)
- **Empty state**: prompt to add first Proxmox node

### Sidebar Navigation
Add "Infrastructure" link in the dashboard sidebar (admin only), with a server icon.

---

## Phase 8: Frontend — Deploy Target Selection

**File**: `apps/web/src/app/dashboard/applications/page.tsx`

In the create application modal, add a "Deploy Target" section:
- Radio buttons: "Local Docker" (default) | "Proxmox"
- If Proxmox selected: dropdown to choose specific node or "Auto (best available)"
- If no Proxmox nodes registered: show "No infrastructure nodes configured" with link to Infrastructure page
- The selected target is stored as `deployTarget` and `nodeId` on the application

**File**: `apps/web/src/app/dashboard/applications/[id]/page.tsx`

In app detail view, show which node the app is deployed on (node name + Proxmox host).

---

## Files Summary

| File | Action |
|------|--------|
| `packages/database/src/schema/index.ts` | Add `infrastructureNodes` table, add `nodeId`/`deployTarget` to `applications` and `deployments` |
| `apps/api/src/services/proxmox.ts` | **NEW** — Proxmox VE REST API client |
| `apps/api/src/services/node-docker.ts` | **NEW** — Docker client pool for remote nodes |
| `apps/api/src/services/node-scheduler.ts` | **NEW** — Node selection logic |
| `apps/api/src/services/docker.ts` | Add optional `dockerClient` parameter to all functions |
| `apps/api/src/services/builder.ts` | Add optional `dockerClient` parameter to `buildImage()` |
| `apps/api/src/services/container-manager.ts` | Add optional `dockerClient` parameter to sync/health functions |
| `apps/api/src/queues/setup.ts` | Add Proxmox target resolution + LXC provisioning logic |
| `apps/api/src/routers/infrastructure.ts` | **NEW** — tRPC admin router for node CRUD |
| `apps/api/src/trpc/router.ts` | Register `infrastructure` router |
| `apps/web/src/app/dashboard/infrastructure/page.tsx` | **NEW** — Infrastructure management page |
| `apps/web/src/app/dashboard/applications/page.tsx` | Add deploy target selector in create modal |
| `apps/web/src/app/dashboard/applications/[id]/page.tsx` | Show node info in app detail |

---

## Env Vars

```
# apps/api/.env  (per-node credentials stored in DB, not env)
# No new env vars required — Proxmox credentials are stored per-node in the DB
```

## Proxmox Server Preparation (User Action Required)

Before using a Proxmox server:

1. **Create API Token**: Datacenter → Permissions → API Tokens → Add
   - User: `root@pam` (or a dedicated user)
   - Token ID: `guildserver`
   - Uncheck "Privilege Separation" (so token inherits user permissions)
   - Save the token secret (shown once)

2. **Download CT Template**: Node → local storage → CT Templates → Templates → Download `ubuntu-22.04-standard`

3. **Network**: Ensure `vmbr0` bridge exists and has DHCP or static IP allocation

---

## Implementation Order

1. **Phase 1**: Database schema (foundation for everything else)
2. **Phase 2**: Proxmox API service (core integration)
3. **Phase 3**: Node Docker client pool + modify `docker.ts` to accept remote clients
4. **Phase 6**: tRPC infrastructure router (needed for frontend to manage nodes)
5. **Phase 7**: Frontend infrastructure page (so admin can register nodes)
6. **Phase 4**: Node scheduler
7. **Phase 5**: Deployment pipeline changes (wire it all together)
8. **Phase 8**: Frontend deploy target selection

---

## Verification

1. **Add Proxmox node**: Infrastructure page → Add → enter Proxmox API URL + token → "Test Connection" shows green → Save
2. **Node status**: Infrastructure page shows node online with CPU/memory stats
3. **Create app with Proxmox target**: Create app → select "Proxmox" target → deploy → see LXC created on Proxmox → Docker container running inside LXC → app accessible via URL
4. **Local still works**: Create app → select "Local Docker" (default) → deploys to local Docker as before
5. **Logs stream**: Deployment logs show Proxmox LXC creation, Docker setup, and app deployment phases
6. **Multiple nodes**: Add 2+ nodes → scheduler picks the least loaded one
7. **Node maintenance**: Set node to maintenance → new deploys route elsewhere → existing apps unaffected
