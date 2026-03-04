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
  index,
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

// Infrastructure provider enums
export const providerTypeEnum = pgEnum("provider_type", [
  "docker-local",
  "docker-remote",
  "proxmox",
  "kubernetes",
  "aws-ecs",
  "gcp-cloudrun",
  "azure-aci",
  "hetzner",
  "digitalocean",
]);
export const providerStatusEnum = pgEnum("provider_status", [
  "pending",
  "connected",
  "error",
  "disabled",
]);

// Billing enums
export const planSlugEnum = pgEnum("plan_slug", ["hobby", "pro", "enterprise"]);
export const subscriptionStatusEnum = pgEnum("subscription_status", [
  "active",
  "trialing",
  "past_due",
  "canceled",
  "paused",
  "incomplete"
]);
export const invoiceStatusEnum = pgEnum("invoice_status", [
  "draft",
  "open",
  "paid",
  "void",
  "uncollectible"
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
  stripeCustomerId: varchar("stripe_customer_id", { length: 255 }),
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

// OAuth Accounts (linked provider identities for social login + GitHub repo access)
export const oauthAccounts = pgTable("oauth_accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  provider: varchar("provider", { length: 50 }).notNull(), // "github" | "google"
  providerAccountId: varchar("provider_account_id", { length: 255 }).notNull(),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  tokenExpiresAt: timestamp("token_expires_at"),
  scope: text("scope"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  userIdIdx: index("oauth_accounts_user_id_idx").on(table.userId),
  providerAccountIdx: index("oauth_accounts_provider_account_idx").on(table.provider, table.providerAccountId),
}));

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
}, (table) => ({
  userIdIdx: index("members_user_id_idx").on(table.userId),
  organizationIdIdx: index("members_organization_id_idx").on(table.organizationId),
  userOrgIdx: index("members_user_org_idx").on(table.userId, table.organizationId),
}));

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
}, (table) => ({
  organizationIdIdx: index("projects_organization_id_idx").on(table.organizationId),
}));

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
  containerPort: integer("container_port"),
  
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
  mainBranch: varchar("main_branch", { length: 255 }).default("main"),
  previewTtlHours: integer("preview_ttl_hours").default(72),

  // Infrastructure provider (multi-cloud)
  providerId: uuid("provider_id").references(() => computeProviders.id, { onDelete: "set null" }),
  deploymentTarget: varchar("deployment_target", { length: 50 }).default("docker-local"),

  // Status
  status: varchar("status", { length: 50 }).default("inactive"),

  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  projectIdIdx: index("applications_project_id_idx").on(table.projectId),
  statusIdx: index("applications_status_idx").on(table.status),
  providerIdIdx: index("applications_provider_id_idx").on(table.providerId),
}));

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
}, (table) => ({
  projectIdIdx: index("databases_project_id_idx").on(table.projectId),
}));

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

  // Rollback support (Phase 3)
  imageTag: text("image_tag"),
  deploymentType: varchar("deployment_type", { length: 50 }).default("standard"),
  triggeredBy: varchar("triggered_by", { length: 255 }),
  sourceDeploymentId: uuid("source_deployment_id"),

  // Preview deployments (Phase 4)
  isPreview: boolean("is_preview").default(false),
  previewBranch: varchar("preview_branch", { length: 255 }),

  // Timing
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),

  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  applicationIdIdx: index("deployments_application_id_idx").on(table.applicationId),
  statusIdx: index("deployments_status_idx").on(table.status),
  createdAtIdx: index("deployments_created_at_idx").on(table.createdAt),
}));

// =====================
// DOMAINS & CERTIFICATES
// =====================

export const domainStatusEnum = pgEnum("domain_status", [
  "pending",
  "verifying",
  "active",
  "failed",
  "expired",
]);

export const certificateStatusEnum = pgEnum("certificate_status", [
  "pending",
  "provisioning",
  "active",
  "renewal",
  "failed",
  "expired",
]);

export const envScopeEnum = pgEnum("env_scope", [
  "production",
  "preview",
  "development",
]);

// Domains
export const domains = pgTable("domains", {
  id: uuid("id").primaryKey().defaultRandom(),
  domain: varchar("domain", { length: 255 }).notNull(),
  applicationId: uuid("application_id").references(() => applications.id, { onDelete: "cascade" }),

  // Domain configuration
  isPrimary: boolean("is_primary").default(false),
  isAutoGenerated: boolean("is_auto_generated").default(false),

  // DNS verification
  verificationToken: varchar("verification_token", { length: 255 }),
  verificationMethod: varchar("verification_method", { length: 50 }).default("cname"), // cname, txt
  verified: boolean("verified").default(false),

  // Status
  status: domainStatusEnum("status").default("pending"),

  // SSL/TLS
  certificateId: uuid("certificate_id"),
  forceHttps: boolean("force_https").default(true),

  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  applicationIdIdx: index("domains_application_id_idx").on(table.applicationId),
  domainIdx: index("domains_domain_idx").on(table.domain),
}));

// SSL Certificates
export const certificates = pgTable("certificates", {
  id: uuid("id").primaryKey().defaultRandom(),
  domain: varchar("domain", { length: 255 }).notNull(),

  // Certificate data
  certificateChain: text("certificate_chain"),
  privateKey: text("private_key"),
  issuer: varchar("issuer", { length: 255 }).default("lets-encrypt"),

  // Status & lifecycle
  status: certificateStatusEnum("status").default("pending"),
  issuedAt: timestamp("issued_at"),
  expiresAt: timestamp("expires_at"),
  lastRenewalAt: timestamp("last_renewal_at"),
  autoRenew: boolean("auto_renew").default(true),

  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Environment Variables (scoped per environment)
export const environmentVariables = pgTable("environment_variables", {
  id: uuid("id").primaryKey().defaultRandom(),
  applicationId: uuid("application_id").references(() => applications.id, { onDelete: "cascade" }),

  key: varchar("key", { length: 255 }).notNull(),
  value: text("value").notNull(),

  // Scope: production, preview, development
  scope: envScopeEnum("scope").default("production"),

  // Encryption
  isSecret: boolean("is_secret").default(false),

  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  applicationIdIdx: index("env_vars_application_id_idx").on(table.applicationId),
}));

// Webhook Deliveries (Phase 5)
export const webhookDeliveries = pgTable("webhook_deliveries", {
  id: uuid("id").primaryKey().defaultRandom(),
  applicationId: uuid("application_id").references(() => applications.id, { onDelete: "cascade" }),
  provider: varchar("provider", { length: 50 }).notNull(),
  eventType: varchar("event_type", { length: 100 }),
  payload: jsonb("payload"),
  headers: jsonb("headers"),
  statusCode: integer("status_code"),
  response: text("response"),
  delivered: boolean("delivered").default(false),
  error: text("error"),
  processingTimeMs: integer("processing_time_ms"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  applicationIdIdx: index("idx_webhook_deliveries_app").on(table.applicationId),
  createdAtIdx: index("idx_webhook_deliveries_created").on(table.createdAt),
}));

// =====================
// NOTIFICATION TABLES
// =====================

export const notifications = pgTable("notifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  type: varchar("type", { length: 100 }).notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  message: text("message").notNull(),
  metadata: jsonb("metadata").default({}),
  read: boolean("read").default(false),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  userIdx: index("idx_notifications_user").on(table.userId),
  readIdx: index("idx_notifications_read").on(table.userId, table.read),
}));

export const notificationPreferences = pgTable("notification_preferences", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  event: varchar("event", { length: 100 }).notNull(),
  emailEnabled: boolean("email_enabled").default(true),
  slackEnabled: boolean("slack_enabled").default(false),
  inAppEnabled: boolean("in_app_enabled").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const slackConfigs = pgTable("slack_configs", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  webhookUrl: text("webhook_url").notNull(),
  channelName: varchar("channel_name", { length: 255 }),
  enabled: boolean("enabled").default(true),
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
// COMPUTE PROVIDERS (Multi-Cloud Infrastructure)
// =====================

export const computeProviders = pgTable("compute_providers", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 255 }).notNull(),
  type: providerTypeEnum("type").notNull(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }),

  // Connection config (encrypted JSON — credentials stored here)
  config: jsonb("config").default({}).notNull(),

  // Location / region info
  region: varchar("region", { length: 100 }),

  // Default provider for the org (auto-selected for new apps)
  isDefault: boolean("is_default").default(false),

  // Connection status
  status: providerStatusEnum("status").default("pending"),
  lastHealthCheck: timestamp("last_health_check"),
  healthMessage: text("health_message"),

  // Extra metadata (e.g., node info, capacity, version)
  metadata: jsonb("metadata").default({}),

  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  organizationIdIdx: index("compute_providers_organization_id_idx").on(table.organizationId),
  typeIdx: index("compute_providers_type_idx").on(table.type),
  defaultIdx: index("compute_providers_default_idx").on(table.organizationId, table.isDefault),
}));

// =====================
// BILLING & SUBSCRIPTIONS
// =====================

// Plans (pricing tiers — seeded, not user-created)
export const plans = pgTable("plans", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 255 }).notNull(),
  slug: planSlugEnum("slug").notNull().unique(),
  description: text("description"),
  priceMonthly: integer("price_monthly"), // cents (0 = free, null = custom/enterprise)
  priceYearly: integer("price_yearly"),   // cents
  stripePriceIdMonthly: varchar("stripe_price_id_monthly", { length: 255 }),
  stripePriceIdYearly: varchar("stripe_price_id_yearly", { length: 255 }),
  limits: jsonb("limits").default({}).notNull(),
  // { maxApps, maxDatabases, maxDeployments, maxBandwidthGb, maxBuildMinutes, maxMemoryMb, maxCpuCores, maxDomainsPerApp, maxTeamMembers, auditRetentionDays }
  features: jsonb("features").default({}).notNull(),
  // { previewDeployments, teamCollaboration, customDomains, prioritySupport, sso, spendManagement, webhooks, apiAccess }
  sortOrder: integer("sort_order").default(0),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Subscriptions (links an organization to a plan)
export const subscriptions = pgTable("subscriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  planId: uuid("plan_id").notNull().references(() => plans.id),
  status: subscriptionStatusEnum("status").default("active").notNull(),
  stripeCustomerId: varchar("stripe_customer_id", { length: 255 }),
  stripeSubscriptionId: varchar("stripe_subscription_id", { length: 255 }),
  currentPeriodStart: timestamp("current_period_start"),
  currentPeriodEnd: timestamp("current_period_end"),
  cancelAtPeriodEnd: boolean("cancel_at_period_end").default(false),
  trialStart: timestamp("trial_start"),
  trialEnd: timestamp("trial_end"),
  seats: integer("seats").default(1),
  usageCreditCents: integer("usage_credit_cents").default(0), // monthly credit (e.g. 1000 = $10)
  spendLimitCents: integer("spend_limit_cents"), // nullable = unlimited
  metadata: jsonb("metadata").default({}),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  orgIdIdx: index("subscriptions_org_id_idx").on(table.organizationId),
  stripeSubIdx: index("subscriptions_stripe_sub_idx").on(table.stripeSubscriptionId),
}));

// Invoices (mirrors Stripe invoices locally)
export const invoices = pgTable("invoices", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  subscriptionId: uuid("subscription_id").references(() => subscriptions.id),
  stripeInvoiceId: varchar("stripe_invoice_id", { length: 255 }),
  number: varchar("number", { length: 100 }),
  status: invoiceStatusEnum("status").default("draft"),
  amountDueCents: integer("amount_due_cents").default(0),
  amountPaidCents: integer("amount_paid_cents").default(0),
  currency: varchar("currency", { length: 10 }).default("usd"),
  periodStart: timestamp("period_start"),
  periodEnd: timestamp("period_end"),
  invoiceUrl: text("invoice_url"),
  pdfUrl: text("pdf_url"),
  paidAt: timestamp("paid_at"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  orgIdIdx: index("invoices_org_id_idx").on(table.organizationId),
  stripeInvIdx: index("invoices_stripe_inv_idx").on(table.stripeInvoiceId),
  createdAtIdx: index("invoices_created_at_idx").on(table.createdAt),
}));

// Usage Records (metered usage per org per billing period)
export const usageRecords = pgTable("usage_records", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  metric: varchar("metric", { length: 100 }).notNull(), // "deployments" | "bandwidth_gb" | "build_minutes" | "storage_gb"
  value: decimal("value").default("0").notNull(),
  periodStart: date("period_start").notNull(),
  periodEnd: date("period_end").notNull(),
  reportedToStripe: boolean("reported_to_stripe").default(false),
  stripeUsageRecordId: varchar("stripe_usage_record_id", { length: 255 }),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  orgMetricIdx: index("usage_records_org_metric_idx").on(table.organizationId, table.metric),
  periodIdx: index("usage_records_period_idx").on(table.periodStart, table.periodEnd),
}));

// Payment Methods (cached card info from Stripe)
export const paymentMethods = pgTable("payment_methods", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  stripePaymentMethodId: varchar("stripe_payment_method_id", { length: 255 }).notNull(),
  type: varchar("type", { length: 50 }).default("card"),
  cardBrand: varchar("card_brand", { length: 50 }),
  cardLast4: varchar("card_last4", { length: 4 }),
  cardExpMonth: integer("card_exp_month"),
  cardExpYear: integer("card_exp_year"),
  isDefault: boolean("is_default").default(false),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  orgIdIdx: index("payment_methods_org_id_idx").on(table.organizationId),
}));

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
}, (table) => ({
  applicationIdIdx: index("metrics_application_id_idx").on(table.applicationId),
  organizationIdIdx: index("metrics_organization_id_idx").on(table.organizationId),
  timestampIdx: index("metrics_timestamp_idx").on(table.timestamp),
  appNameTimestampIdx: index("metrics_app_name_ts_idx").on(table.applicationId, table.name, table.timestamp),
  orgNameTimestampIdx: index("metrics_org_name_ts_idx").on(table.organizationId, table.name, table.timestamp),
}));

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
}, (table) => ({
  organizationIdIdx: index("audit_logs_organization_id_idx").on(table.organizationId),
  timestampIdx: index("audit_logs_timestamp_idx").on(table.timestamp),
}));

// =====================
// RELATIONS
// =====================

export const organizationsRelations = relations(organizations, ({ many, one }) => ({
  members: many(members),
  projects: many(projects),
  clusters: many(kubernetesClusters),
  computeProviders: many(computeProviders),
  ssoProviders: many(ssoProviders),
  workflowTemplates: many(workflowTemplates),
  auditLogs: many(auditLogs),
  subscriptions: many(subscriptions),
  invoices: many(invoices),
  usageRecords: many(usageRecords),
  paymentMethods: many(paymentMethods),
  owner: one(users, {
    fields: [organizations.ownerId],
    references: [users.id],
  }),
}));

export const usersRelations = relations(users, ({ many }) => ({
  memberships: many(members),
  oauthAccounts: many(oauthAccounts),
  createdWorkflows: many(workflowTemplates),
  approvalRequests: many(approvalRequests),
  auditLogs: many(auditLogs),
}));

export const oauthAccountsRelations = relations(oauthAccounts, ({ one }) => ({
  user: one(users, {
    fields: [oauthAccounts.userId],
    references: [users.id],
  }),
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
  provider: one(computeProviders, {
    fields: [applications.providerId],
    references: [computeProviders.id],
  }),
  deployments: many(deployments),
  k8sDeployments: many(k8sDeployments),
  metrics: many(metrics),
  domains: many(domains),
  environmentVariables: many(environmentVariables),
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
  triggeredByUser: one(users, {
    fields: [workflowExecutions.triggeredBy],
    references: [users.id],
  }),
  approvalRequests: many(approvalRequests),
}));

export const deploymentsRelations = relations(deployments, ({ one }) => ({
  application: one(applications, {
    fields: [deployments.applicationId],
    references: [applications.id],
  }),
  database: one(databases, {
    fields: [deployments.databaseId],
    references: [databases.id],
  }),
}));

export const kubernetesClustersRelations = relations(kubernetesClusters, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [kubernetesClusters.organizationId],
    references: [organizations.id],
  }),
  k8sDeployments: many(k8sDeployments),
}));

export const k8sDeploymentsRelations = relations(k8sDeployments, ({ one }) => ({
  cluster: one(kubernetesClusters, {
    fields: [k8sDeployments.clusterId],
    references: [kubernetesClusters.id],
  }),
  application: one(applications, {
    fields: [k8sDeployments.applicationId],
    references: [applications.id],
  }),
}));

export const approvalRequestsRelations = relations(approvalRequests, ({ one }) => ({
  workflowExecution: one(workflowExecutions, {
    fields: [approvalRequests.workflowExecutionId],
    references: [workflowExecutions.id],
  }),
  approver: one(users, {
    fields: [approvalRequests.approverId],
    references: [users.id],
  }),
}));

export const metricsRelations = relations(metrics, ({ one }) => ({
  application: one(applications, {
    fields: [metrics.applicationId],
    references: [applications.id],
  }),
  organization: one(organizations, {
    fields: [metrics.organizationId],
    references: [organizations.id],
  }),
}));

export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  user: one(users, {
    fields: [auditLogs.userId],
    references: [users.id],
  }),
  organization: one(organizations, {
    fields: [auditLogs.organizationId],
    references: [organizations.id],
  }),
}));

export const domainsRelations = relations(domains, ({ one }) => ({
  application: one(applications, {
    fields: [domains.applicationId],
    references: [applications.id],
  }),
}));

export const webhookDeliveriesRelations = relations(webhookDeliveries, ({ one }) => ({
  application: one(applications, {
    fields: [webhookDeliveries.applicationId],
    references: [applications.id],
  }),
}));

export const environmentVariablesRelations = relations(environmentVariables, ({ one }) => ({
  application: one(applications, {
    fields: [environmentVariables.applicationId],
    references: [applications.id],
  }),
}));

export const notificationsRelations = relations(notifications, ({ one }) => ({
  user: one(users, {
    fields: [notifications.userId],
    references: [users.id],
  }),
}));

export const notificationPreferencesRelations = relations(notificationPreferences, ({ one }) => ({
  user: one(users, {
    fields: [notificationPreferences.userId],
    references: [users.id],
  }),
}));

export const slackConfigsRelations = relations(slackConfigs, ({ one }) => ({
  organization: one(organizations, {
    fields: [slackConfigs.organizationId],
    references: [organizations.id],
  }),
}));

// Billing relations
export const plansRelations = relations(plans, ({ many }) => ({
  subscriptions: many(subscriptions),
}));

export const subscriptionsRelations = relations(subscriptions, ({ one }) => ({
  organization: one(organizations, {
    fields: [subscriptions.organizationId],
    references: [organizations.id],
  }),
  plan: one(plans, {
    fields: [subscriptions.planId],
    references: [plans.id],
  }),
}));

export const invoicesRelations = relations(invoices, ({ one }) => ({
  organization: one(organizations, {
    fields: [invoices.organizationId],
    references: [organizations.id],
  }),
  subscription: one(subscriptions, {
    fields: [invoices.subscriptionId],
    references: [subscriptions.id],
  }),
}));

export const usageRecordsRelations = relations(usageRecords, ({ one }) => ({
  organization: one(organizations, {
    fields: [usageRecords.organizationId],
    references: [organizations.id],
  }),
}));

export const computeProvidersRelations = relations(computeProviders, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [computeProviders.organizationId],
    references: [organizations.id],
  }),
  applications: many(applications),
}));

export const paymentMethodsRelations = relations(paymentMethods, ({ one }) => ({
  organization: one(organizations, {
    fields: [paymentMethods.organizationId],
    references: [organizations.id],
  }),
}));