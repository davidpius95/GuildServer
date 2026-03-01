// GuildServer Database Schema
// Core platform entities with enterprise features

import { relations } from "drizzle-orm";
import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  boolean,
  integer,
  jsonb,
  decimal,
  pgEnum,
  inet,
  interval,
  date,
} from "drizzle-orm/pg-core";

// =====================
// ENUMS
// =====================

// Core enums
export const userRoleEnum = pgEnum("user_role", ["admin", "user"]);
export const memberRoleEnum = pgEnum("member_role", ["owner", "admin", "member"]);
export const sourceTypeEnum = pgEnum("source_type", [
  "github",
  "gitlab", 
  "bitbucket",
  "gitea",
  "docker",
  "git",
  "drop"
]);
export const buildTypeEnum = pgEnum("build_type", [
  "dockerfile",
  "nixpacks",
  "heroku",
  "paketo", 
  "static",
  "railpack"
]);

// Enterprise enums
export const clusterStatusEnum = pgEnum("cluster_status", [
  "active",
  "inactive", 
  "error",
  "pending",
  "maintenance"
]);
export const ssoProviderTypeEnum = pgEnum("sso_provider_type", [
  "saml",
  "oidc", 
  "ldap",
  "azure-ad",
  "google",
  "github"
]);
export const workflowStatusEnum = pgEnum("workflow_status", [
  "draft",
  "active",
  "inactive", 
  "archived"
]);
export const executionStatusEnum = pgEnum("execution_status", [
  "pending",
  "running",
  "paused",
  "completed",
  "failed",
  "cancelled"
]);
export const approvalStatusEnum = pgEnum("approval_status", [
  "pending",
  "approved",
  "rejected", 
  "expired"
]);

// =====================
// CORE TABLES
// =====================

// Organizations (Multi-tenancy)
export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 255 }).notNull(),
  slug: varchar("slug", { length: 255 }).notNull().unique(),
  logo: text("logo"),
  description: text("description"),
  metadata: jsonb("metadata").default({}),
  ownerId: uuid("owner_id").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Users
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  name: varchar("name", { length: 255 }),
  password: text("password"),
  avatar: text("avatar"),
  role: userRoleEnum("role").default("user"),
  emailVerified: timestamp("email_verified"),
  
  // Enterprise features
  twoFactorSecret: text("two_factor_secret"),
  twoFactorEnabled: boolean("two_factor_enabled").default(false),
  lastLogin: timestamp("last_login"),
  
  // System settings
  preferences: jsonb("preferences").default({}),
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Organization membership
export const members = pgTable("members", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
  role: memberRoleEnum("role").notNull(),
  
  // Granular permissions
  permissions: jsonb("permissions").default({}),
  
  // Access control
  projectsAccess: text("projects_access").array().default([]),
  applicationsAccess: text("applications_access").array().default([]),
  
  joinedAt: timestamp("joined_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Projects
export const projects = pgTable("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
  
  // Project settings
  environment: jsonb("environment").default({}),
  settings: jsonb("settings").default({}),
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Applications
export const applications = pgTable("applications", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 255 }).notNull(),
  appName: varchar("app_name", { length: 255 }).notNull(),
  description: text("description"),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
  
  // Source configuration
  sourceType: sourceTypeEnum("source_type"),
  repository: text("repository"),
  branch: varchar("branch", { length: 255 }).default("main"),
  buildPath: text("build_path"),
  dockerfile: text("dockerfile"),
  
  // Build configuration
  buildType: buildTypeEnum("build_type"),
  buildArgs: jsonb("build_args").default({}),
  environment: jsonb("environment").default({}),
  
  // Docker configuration
  dockerImage: text("docker_image"),
  dockerTag: varchar("docker_tag", { length: 255 }).default("latest"),
  
  // Resource limits
  memoryReservation: integer("memory_reservation"),
  memoryLimit: integer("memory_limit"),
  cpuReservation: decimal("cpu_reservation"),
  cpuLimit: decimal("cpu_limit"),
  
  // Deployment settings
  replicas: integer("replicas").default(1),
  autoDeployment: boolean("auto_deployment").default(false),
  
  // Preview deployments
  previewDeployments: boolean("preview_deployments").default(false),
  
  // Status
  status: varchar("status", { length: 50 }).default("inactive"),
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Databases
export const databases = pgTable("databases", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 255 }).notNull(),
  type: varchar("type", { length: 50 }).notNull(), // postgresql, mysql, mongodb, redis
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
  
  // Database configuration
  databaseName: varchar("database_name", { length: 255 }).notNull(),
  username: varchar("username", { length: 255 }).notNull(),
  password: text("password").notNull(),
  
  // Docker configuration
  dockerImage: text("docker_image"),
  command: text("command"),
  environment: jsonb("environment").default({}),
  
  // Resource limits
  memoryLimit: integer("memory_limit"),
  cpuLimit: decimal("cpu_limit"),
  
  // External access
  externalPort: integer("external_port"),
  
  // Status
  status: varchar("status", { length: 50 }).default("inactive"),
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Deployments
export const deployments = pgTable("deployments", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: varchar("title", { length: 255 }),
  description: text("description"),
  status: varchar("status", { length: 50 }).default("pending"),
  
  // Deployment target
  applicationId: uuid("application_id").references(() => applications.id, { onDelete: "cascade" }),
  databaseId: uuid("database_id").references(() => databases.id, { onDelete: "cascade" }),
  
  // Deployment details
  gitCommitSha: varchar("git_commit_sha", { length: 255 }),
  buildLogs: text("build_logs"),
  deploymentLogs: text("deployment_logs"),
  
  // Timing
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  
  createdAt: timestamp("created_at").defaultNow(),
});

// =====================
// KUBERNETES TABLES
// =====================

export const kubernetesClusters = pgTable("kubernetes_clusters", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 255 }).notNull(),
  kubeconfig: text("kubeconfig").notNull(),
  endpoint: text("endpoint").notNull(),
  version: varchar("version", { length: 50 }),
  provider: varchar("provider", { length: 100 }),
  region: varchar("region", { length: 100 }),
  status: clusterStatusEnum("status").default("pending"),
  metadata: jsonb("metadata").default({}),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const k8sDeployments = pgTable("k8s_deployments", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 255 }).notNull(),
  namespace: varchar("namespace", { length: 255 }).default("default"),
  clusterId: uuid("cluster_id").references(() => kubernetesClusters.id, { onDelete: "cascade" }),
  applicationId: uuid("application_id").references(() => applications.id, { onDelete: "cascade" }),
  helmChartName: varchar("helm_chart_name", { length: 255 }),
  helmChartVersion: varchar("helm_chart_version", { length: 50 }),
  values: jsonb("values").default({}),
  status: varchar("status", { length: 50 }).default("pending"),
  replicas: integer("replicas").default(1),
  readyReplicas: integer("ready_replicas").default(0),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// =====================
// ENTERPRISE AUTHENTICATION
// =====================

export const ssoProviders = pgTable("sso_providers", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 255 }).notNull(),
  providerType: ssoProviderTypeEnum("provider_type").notNull(),
  configuration: jsonb("configuration").notNull(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
  enabled: boolean("enabled").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// =====================
// WORKFLOW MANAGEMENT
// =====================

export const workflowTemplates = pgTable("workflow_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  definition: jsonb("definition").notNull(),
  version: varchar("version", { length: 50 }).default("1.0.0"),
  status: workflowStatusEnum("status").default("draft"),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const workflowExecutions = pgTable("workflow_executions", {
  id: uuid("id").primaryKey().defaultRandom(),
  templateId: uuid("template_id").references(() => workflowTemplates.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }),
  status: executionStatusEnum("status").default("pending"),
  currentStep: integer("current_step").default(0),
  context: jsonb("context").default({}),
  errorMessage: text("error_message"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  triggeredBy: uuid("triggered_by").references(() => users.id),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").defaultNow(),
});

export const approvalRequests = pgTable("approval_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  workflowExecutionId: uuid("workflow_execution_id").references(() => workflowExecutions.id, { onDelete: "cascade" }),
  stepId: varchar("step_id", { length: 255 }).notNull(),
  approverId: uuid("approver_id").references(() => users.id),
  approverType: varchar("approver_type", { length: 50 }).default("user"),
  status: approvalStatusEnum("status").default("pending"),
  comments: text("comments"),
  requestedAt: timestamp("requested_at").defaultNow(),
  respondedAt: timestamp("responded_at"),
  expiresAt: timestamp("expires_at"),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
});

// =====================
// MONITORING & METRICS
// =====================

export const metrics = pgTable("metrics", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 255 }).notNull(),
  type: varchar("type", { length: 50 }).notNull(), // counter, gauge, histogram
  value: decimal("value").notNull(),
  labels: jsonb("labels").default({}),
  timestamp: timestamp("timestamp").defaultNow(),
  applicationId: uuid("application_id").references(() => applications.id, { onDelete: "cascade" }),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
});

// =====================
// AUDIT LOGS
// =====================

export const auditLogs = pgTable("audit_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
  action: varchar("action", { length: 100 }).notNull(),
  resourceType: varchar("resource_type", { length: 100 }).notNull(),
  resourceId: uuid("resource_id"),
  resourceName: varchar("resource_name", { length: 255 }),
  metadata: jsonb("metadata").default({}),
  ipAddress: inet("ip_address"),
  userAgent: text("user_agent"),
  timestamp: timestamp("timestamp").defaultNow(),
  sessionId: varchar("session_id", { length: 255 }),
});

// =====================
// RELATIONS
// =====================

export const organizationsRelations = relations(organizations, ({ many, one }) => ({
  members: many(members),
  projects: many(projects),
  clusters: many(kubernetesClusters),
  ssoProviders: many(ssoProviders),
  workflowTemplates: many(workflowTemplates),
  auditLogs: many(auditLogs),
  owner: one(users, {
    fields: [organizations.ownerId],
    references: [users.id],
  }),
}));

export const usersRelations = relations(users, ({ many }) => ({
  memberships: many(members),
  createdWorkflows: many(workflowTemplates),
  approvalRequests: many(approvalRequests),
  auditLogs: many(auditLogs),
}));

export const membersRelations = relations(members, ({ one }) => ({
  user: one(users, {
    fields: [members.userId],
    references: [users.id],
  }),
  organization: one(organizations, {
    fields: [members.organizationId],
    references: [organizations.id],
  }),
}));

export const projectsRelations = relations(projects, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [projects.organizationId],
    references: [organizations.id],
  }),
  applications: many(applications),
  databases: many(databases),
}));

export const applicationsRelations = relations(applications, ({ one, many }) => ({
  project: one(projects, {
    fields: [applications.projectId],
    references: [projects.id],
  }),
  deployments: many(deployments),
  k8sDeployments: many(k8sDeployments),
  metrics: many(metrics),
}));

export const databasesRelations = relations(databases, ({ one, many }) => ({
  project: one(projects, {
    fields: [databases.projectId],
    references: [projects.id],
  }),
  deployments: many(deployments),
}));

export const workflowTemplatesRelations = relations(workflowTemplates, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [workflowTemplates.organizationId],
    references: [organizations.id],
  }),
  creator: one(users, {
    fields: [workflowTemplates.createdBy],
    references: [users.id],
  }),
  executions: many(workflowExecutions),
}));

export const workflowExecutionsRelations = relations(workflowExecutions, ({ one, many }) => ({
  template: one(workflowTemplates, {
    fields: [workflowExecutions.templateId],
    references: [workflowTemplates.id],
  }),
  approvalRequests: many(approvalRequests),
}));