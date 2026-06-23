// GuildServer BaaS — Database Schema
// Owns:   baas_nodes, baas_projects, baas_backups, baas_custom_hostnames, baas_metrics
// Reads:  organizations, users, members, compute_providers  (same DB as PaaS — referenced but not created here)

import { relations } from "drizzle-orm";
import {
  pgTable, pgEnum, uuid, varchar, text, timestamp, boolean,
  integer, decimal, jsonb, inet, index,
} from "drizzle-orm/pg-core";

// ── Enums ──────────────────────────────────────────────────────────────────────

export const baasProjectStatusEnum = pgEnum("baas_project_status", [
  "provisioning", "active", "paused", "error", "deleting",
]);
export const baasNodeRoleEnum   = pgEnum("baas_node_role",   ["edge", "compute", "storage"]);
export const baasNodeStatusEnum = pgEnum("baas_node_status", ["online", "offline", "maintenance", "error"]);
export const backupStatusEnum   = pgEnum("backup_status",    ["pending", "in_progress", "completed", "failed"]);
export const domainStatusEnum   = pgEnum("domain_status",    ["pending", "verifying", "active", "failed", "expired"]);

// ── Shared reference tables (owned by PaaS, read by BaaS via same DB) ─────────
// Minimal column set — only what BaaS actually queries.

export const organizations = pgTable("organizations", {
  id:        uuid("id").primaryKey(),
  name:      varchar("name", { length: 255 }).notNull(),
  slug:      varchar("slug", { length: 255 }).notNull(),
  ownerId:   uuid("owner_id").notNull(),
  product:   varchar("product", { length: 16 }).default("paas"),
  createdAt: timestamp("created_at"),
  updatedAt: timestamp("updated_at"),
});

export const users = pgTable("users", {
  id:       uuid("id").primaryKey(),
  email:    varchar("email", { length: 255 }).notNull(),
  name:     varchar("name", { length: 255 }),
  password: text("password"),
  role:     varchar("role", { length: 32 }).default("user"),
});

export const members = pgTable("members", {
  id:             uuid("id").primaryKey(),
  userId:         uuid("user_id"),
  organizationId: uuid("organization_id"),
  role:           varchar("role", { length: 32 }).notNull(),
});

export const computeProviders = pgTable("compute_providers", {
  id:   uuid("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  type: varchar("type", { length: 64 }).notNull(),
});

// ── BaaS-owned tables ──────────────────────────────────────────────────────────

// Fleet node registry — each mini-PC (or pod) registered as a BaaS compute node
export const baasNodes = pgTable("baas_nodes", {
  id:   uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 255 }).notNull(),
  hostname:   varchar("hostname",    { length: 255 }).notNull(),
  internalIp: inet("internal_ip").notNull(),
  externalIp: inet("external_ip"),
  role:   baasNodeRoleEnum("role").notNull().default("compute"),
  status: baasNodeStatusEnum("status").notNull().default("offline"),

  // Capacity
  vcpuTotal:      integer("vcpu_total").notNull(),
  ramMbTotal:     integer("ram_mb_total").notNull(),
  storageGbTotal: integer("storage_gb_total").notNull(),

  // Live utilization (updated by health-reconciler)
  vcpuUsed:      integer("vcpu_used").default(0),
  ramMbUsed:     integer("ram_mb_used").default(0),
  storageGbUsed: integer("storage_gb_used").default(0),

  // SSH access
  sshUser:       varchar("ssh_user", { length: 64 }).default("root"),
  sshPort:       integer("ssh_port").default(22),
  sshPrivateKey: text("ssh_private_key"),

  providerId: uuid("provider_id"),   // → compute_providers.id
  podName:    varchar("pod_name", { length: 128 }),
  location:   varchar("location",  { length: 255 }),

  lastHeartbeat: timestamp("last_heartbeat"),
  metadata:      jsonb("metadata").default({}),
  createdAt:     timestamp("created_at").defaultNow(),
  updatedAt:     timestamp("updated_at").defaultNow(),
}, (t) => ({
  statusIdx: index("baas_nodes_status_idx").on(t.status),
  roleIdx:   index("baas_nodes_role_idx").on(t.role),
}));

// One BaaS project = one complete Supabase stack running on a compute node
export const baasProjects = pgTable("baas_projects", {
  id:             uuid("id").primaryKey().defaultRandom(),
  name:           varchar("name", { length: 255 }).notNull(),
  slug:           varchar("slug", { length: 255 }).notNull().unique(),
  organizationId: uuid("organization_id").notNull(),
  nodeId:         uuid("node_id"),

  // Secrets (encrypt at rest in production)
  dbPassword:     text("db_password").notNull(),
  jwtSecret:      text("jwt_secret").notNull(),
  anonKey:        text("anon_key").notNull(),
  serviceRoleKey: text("service_role_key").notNull(),

  // Database
  dbHost: varchar("db_host", { length: 255 }),
  dbPort: integer("db_port").default(5432),
  dbName: varchar("db_name", { length: 255 }).notNull(),
  dbUser: varchar("db_user", { length: 255 }).notNull(),

  // Public endpoints (set after provisioning)
  apiUrl:      text("api_url"),
  realtimeUrl: text("realtime_url"),
  storageUrl:  text("storage_url"),
  studioUrl:   text("studio_url"),

  // Port allocation on compute node (10-port window, e.g. 9000–9010)
  hostPortBase: integer("host_port_base"),

  // Resource limits (used for Postgres auto-tuning)
  vcpuLimit:      decimal("vcpu_limit").default("1"),
  ramMbLimit:     integer("ram_mb_limit").default(2048),
  storageGbLimit: integer("storage_gb_limit").default(8),

  status:        baasProjectStatusEnum("status").default("provisioning"),
  statusMessage: text("status_message"),
  containerIds:  jsonb("container_ids").default({}),

  // Backup config
  backupEnabled:        boolean("backup_enabled").default(true),
  backupRetentionDays:  integer("backup_retention_days").default(7),

  // ── Auto-pause / wake-on-demand ─────────────────────────────────────────────
  // null = never auto-pause; >0 = pause after N minutes of zero DB connections
  idleTimeoutMinutes: integer("idle_timeout_minutes").default(30),
  lastActivityAt:     timestamp("last_activity_at"),
  autoWakeEnabled:    boolean("auto_wake_enabled").default(true),

  // ── WAL archiving / PITR ────────────────────────────────────────────────────
  walArchiveEnabled: boolean("wal_archive_enabled").default(false),
  // Absolute path on compute node where WAL segments are archived
  walArchivePath:    text("wal_archive_path"),
  pitrEnabled:       boolean("pitr_enabled").default(false),

  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => ({
  orgIdIdx:   index("baas_projects_org_id_idx").on(t.organizationId),
  nodeIdIdx:  index("baas_projects_node_id_idx").on(t.nodeId),
  statusIdx:  index("baas_projects_status_idx").on(t.status),
}));

// pg_dump snapshots + WAL-based restores
export const baasBackups = pgTable("baas_backups", {
  id:         uuid("id").primaryKey().defaultRandom(),
  projectId:  uuid("project_id").notNull(),
  status:     backupStatusEnum("status").default("pending"),
  backupType: varchar("backup_type", { length: 20 }).default("automatic"), // manual | automatic | wal
  sizeBytes:  integer("size_bytes").default(0),
  filePath:   text("file_path"),
  // For WAL-based PITR: the timestamp the archive represents
  walTargetTime: timestamp("wal_target_time"),
  error:       text("error"),
  startedAt:   timestamp("started_at").defaultNow(),
  completedAt: timestamp("completed_at"),
  expiresAt:   timestamp("expires_at"),
  createdAt:   timestamp("created_at").defaultNow(),
}, (t) => ({
  projectIdIdx: index("baas_backups_project_id_idx").on(t.projectId),
  statusIdx:    index("baas_backups_status_idx").on(t.status),
}));

// Cloudflare for SaaS custom hostnames
export const baasCustomHostnames = pgTable("baas_custom_hostnames", {
  id:        uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull(),
  hostname:  varchar("hostname", { length: 255 }).notNull().unique(),

  cfCustomHostnameId:   varchar("cf_custom_hostname_id",  { length: 255 }),
  cfOwnershipTxtName:   text("cf_ownership_txt_name"),
  cfOwnershipTxtValue:  text("cf_ownership_txt_value"),
  cfSslStatus:          varchar("cf_ssl_status", { length: 64 }),

  status:   domainStatusEnum("status").default("pending"),
  verified: boolean("verified").default(false),

  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => ({
  projectIdIdx: index("baas_custom_hostnames_project_id_idx").on(t.projectId),
}));

// Per-project resource metrics collected by metrics-collector cron
export const baasMetrics = pgTable("baas_metrics", {
  id:        uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull(),

  collectedAt: timestamp("collected_at").defaultNow(),

  // Container resource usage (from docker stats)
  cpuPercent:   decimal("cpu_percent").default("0"),
  ramMbUsed:    integer("ram_mb_used").default(0),
  storageGbUsed: decimal("storage_gb_used").default("0"),

  // Database metrics (from pg_stat_database)
  activeConnections: integer("active_connections").default(0),
  dbSizeMb:          decimal("db_size_mb").default("0"),
  txCommitted:       integer("tx_committed").default(0),
  txRolledBack:      integer("tx_rolled_back").default(0),

  // Raw payload for future querying
  metadata: jsonb("metadata").default({}),
}, (t) => ({
  projectIdIdx:    index("baas_metrics_project_id_idx").on(t.projectId),
  collectedAtIdx:  index("baas_metrics_collected_at_idx").on(t.collectedAt),
  projectTimeIdx:  index("baas_metrics_project_time_idx").on(t.projectId, t.collectedAt),
}));

// ── Relations ──────────────────────────────────────────────────────────────────

export const baasNodesRelations = relations(baasNodes, ({ many }) => ({
  projects: many(baasProjects),
}));

export const baasProjectsRelations = relations(baasProjects, ({ one, many }) => ({
  node:            one(baasNodes,       { fields: [baasProjects.nodeId],         references: [baasNodes.id] }),
  organization:    one(organizations,   { fields: [baasProjects.organizationId], references: [organizations.id] }),
  backups:         many(baasBackups),
  customHostnames: many(baasCustomHostnames),
  metrics:         many(baasMetrics),
}));

export const baasBackupsRelations = relations(baasBackups, ({ one }) => ({
  project: one(baasProjects, { fields: [baasBackups.projectId], references: [baasProjects.id] }),
}));

export const baasCustomHostnamesRelations = relations(baasCustomHostnames, ({ one }) => ({
  project: one(baasProjects, { fields: [baasCustomHostnames.projectId], references: [baasProjects.id] }),
}));

export const baasMetricsRelations = relations(baasMetrics, ({ one }) => ({
  project: one(baasProjects, { fields: [baasMetrics.projectId], references: [baasProjects.id] }),
}));
