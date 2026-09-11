import type { Express } from "express";
import swaggerUi from "swagger-ui-express";

const swaggerDocument = {
  openapi: "3.0.3",
  info: {
    title: "GuildServer PaaS API",
    version: "1.0.0",
    description: "Enterprise-grade Platform-as-a-Service API. Primary API access is via tRPC at /trpc, with REST endpoints documented below.",
    contact: {
      name: "GuildServer Team",
    },
  },
  servers: [
    {
      url: "http://localhost:4000",
      description: "Development server",
    },
  ],
  paths: {
    "/api/v1/me": { get: { tags: ["REST v1"], summary: 'Describe the token', security: [{ apiToken: [] }], description: "Requires the `read` scope.", responses: { "200": { description: 'OK' }, "401": { $ref: "#/components/responses/ApiUnauthorized" }, "403": { $ref: "#/components/responses/ApiForbidden" }, "404": { $ref: "#/components/responses/ApiNotFound" }, "429": { $ref: "#/components/responses/ApiRateLimited" } } } },
    "/api/v1/projects": { get: { tags: ["REST v1"], summary: "List projects in the token's organization", security: [{ apiToken: [] }], description: "Requires the `read` scope.", responses: { "200": { description: 'OK' }, "401": { $ref: "#/components/responses/ApiUnauthorized" }, "403": { $ref: "#/components/responses/ApiForbidden" }, "404": { $ref: "#/components/responses/ApiNotFound" }, "429": { $ref: "#/components/responses/ApiRateLimited" } } } },
    "/api/v1/applications": { get: { tags: ["REST v1"], summary: 'List applications', security: [{ apiToken: [] }], description: "Requires the `read` scope.", parameters: [{ name: "projectId", in: "query", schema: { type: "string", format: "uuid" } }], responses: { "200": { description: 'OK' }, "401": { $ref: "#/components/responses/ApiUnauthorized" }, "403": { $ref: "#/components/responses/ApiForbidden" }, "404": { $ref: "#/components/responses/ApiNotFound" }, "429": { $ref: "#/components/responses/ApiRateLimited" } } } },
    "/api/v1/applications/{id}": { get: { tags: ["REST v1"], summary: 'Get an application', security: [{ apiToken: [] }], description: "Requires the `read` scope.", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }], responses: { "200": { description: 'OK' }, "401": { $ref: "#/components/responses/ApiUnauthorized" }, "403": { $ref: "#/components/responses/ApiForbidden" }, "404": { $ref: "#/components/responses/ApiNotFound" }, "429": { $ref: "#/components/responses/ApiRateLimited" } } } },
    "/api/v1/applications/{id}/deployments": { get: { tags: ["REST v1"], summary: "List an application's deployments", security: [{ apiToken: [] }], description: "Requires the `read` scope.", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }], responses: { "200": { description: 'OK' }, "401": { $ref: "#/components/responses/ApiUnauthorized" }, "403": { $ref: "#/components/responses/ApiForbidden" }, "404": { $ref: "#/components/responses/ApiNotFound" }, "429": { $ref: "#/components/responses/ApiRateLimited" } } }, post: { tags: ["REST v1"], summary: 'Deploy an application', security: [{ apiToken: [] }], description: "Requires the `deploy` scope.", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }], requestBody: { required: false, content: { "application/json": { schema: { type: "object", properties: { gitCommitSha: { type: "string" } } } } } }, responses: { "202": { description: 'Deployment queued' }, "401": { $ref: "#/components/responses/ApiUnauthorized" }, "403": { $ref: "#/components/responses/ApiForbidden" }, "404": { $ref: "#/components/responses/ApiNotFound" }, "429": { $ref: "#/components/responses/ApiRateLimited" } } } },
    "/api/v1/applications/{id}/logs": { get: { tags: ["REST v1"], summary: 'Get application logs', security: [{ apiToken: [] }], description: "Requires the `read` scope.", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }, { name: "tail", in: "query", schema: { type: "integer", minimum: 1, maximum: 5000, default: 100 } }], responses: { "200": { description: 'OK' }, "401": { $ref: "#/components/responses/ApiUnauthorized" }, "403": { $ref: "#/components/responses/ApiForbidden" }, "404": { $ref: "#/components/responses/ApiNotFound" }, "429": { $ref: "#/components/responses/ApiRateLimited" } } } },
    "/api/v1/applications/{id}/restart": { post: { tags: ["REST v1"], summary: 'Restart an application', security: [{ apiToken: [] }], description: "Requires the `deploy` scope.", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }], responses: { "200": { description: 'OK' }, "401": { $ref: "#/components/responses/ApiUnauthorized" }, "403": { $ref: "#/components/responses/ApiForbidden" }, "404": { $ref: "#/components/responses/ApiNotFound" }, "429": { $ref: "#/components/responses/ApiRateLimited" } } } },
    "/api/v1/applications/{id}/stop": { post: { tags: ["REST v1"], summary: 'Stop an application', security: [{ apiToken: [] }], description: "Requires the `deploy` scope.", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }], responses: { "200": { description: 'OK' }, "401": { $ref: "#/components/responses/ApiUnauthorized" }, "403": { $ref: "#/components/responses/ApiForbidden" }, "404": { $ref: "#/components/responses/ApiNotFound" }, "429": { $ref: "#/components/responses/ApiRateLimited" } } } },
    "/api/v1/deployments/{id}": { get: { tags: ["REST v1"], summary: 'Get a deployment', security: [{ apiToken: [] }], description: "Requires the `read` scope.", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }], responses: { "200": { description: 'OK' }, "401": { $ref: "#/components/responses/ApiUnauthorized" }, "403": { $ref: "#/components/responses/ApiForbidden" }, "404": { $ref: "#/components/responses/ApiNotFound" }, "429": { $ref: "#/components/responses/ApiRateLimited" } } } },
    "/api/v1/databases": { get: { tags: ["REST v1"], summary: 'List databases (credentials redacted)', security: [{ apiToken: [] }], description: "Requires the `read` scope.", responses: { "200": { description: 'OK' }, "401": { $ref: "#/components/responses/ApiUnauthorized" }, "403": { $ref: "#/components/responses/ApiForbidden" }, "404": { $ref: "#/components/responses/ApiNotFound" }, "429": { $ref: "#/components/responses/ApiRateLimited" } } } },
    "/api/v1/databases/{id}": { get: { tags: ["REST v1"], summary: 'Get a database (credentials redacted)', security: [{ apiToken: [] }], description: "Requires the `read` scope.", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }], responses: { "200": { description: 'OK' }, "401": { $ref: "#/components/responses/ApiUnauthorized" }, "403": { $ref: "#/components/responses/ApiForbidden" }, "404": { $ref: "#/components/responses/ApiNotFound" }, "429": { $ref: "#/components/responses/ApiRateLimited" } } } },
    "/api/v1/services": { get: { tags: ["REST v1"], summary: 'List Compose stacks', security: [{ apiToken: [] }], description: "Requires the `read` scope.", responses: { "200": { description: 'OK' }, "401": { $ref: "#/components/responses/ApiUnauthorized" }, "403": { $ref: "#/components/responses/ApiForbidden" }, "404": { $ref: "#/components/responses/ApiNotFound" }, "429": { $ref: "#/components/responses/ApiRateLimited" } } } },
    "/api/v1/services/{id}": { get: { tags: ["REST v1"], summary: 'Get a Compose stack', security: [{ apiToken: [] }], description: "Requires the `read` scope.", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }], responses: { "200": { description: 'OK' }, "401": { $ref: "#/components/responses/ApiUnauthorized" }, "403": { $ref: "#/components/responses/ApiForbidden" }, "404": { $ref: "#/components/responses/ApiNotFound" }, "429": { $ref: "#/components/responses/ApiRateLimited" } } } },
    "/api/v1/services/{id}/deployments": { post: { tags: ["REST v1"], summary: 'Deploy a Compose stack', security: [{ apiToken: [] }], description: "Requires the `deploy` scope.", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }], responses: { "202": { description: 'Deployment queued' }, "401": { $ref: "#/components/responses/ApiUnauthorized" }, "403": { $ref: "#/components/responses/ApiForbidden" }, "404": { $ref: "#/components/responses/ApiNotFound" }, "429": { $ref: "#/components/responses/ApiRateLimited" } } } },
    "/api/v1/domains": { get: { tags: ["REST v1"], summary: "List an application's domains", security: [{ apiToken: [] }], description: "Requires the `read` scope.", parameters: [{ name: "applicationId", in: "query", required: true, schema: { type: "string", format: "uuid" } }], responses: { "200": { description: 'OK' }, "401": { $ref: "#/components/responses/ApiUnauthorized" }, "403": { $ref: "#/components/responses/ApiForbidden" }, "404": { $ref: "#/components/responses/ApiNotFound" }, "429": { $ref: "#/components/responses/ApiRateLimited" } } } },
    "/health": {
      get: {
        tags: ["System"],
        summary: "Health check",
        description: "Returns the health status of the API server",
        responses: {
          "200": {
            description: "Server is healthy",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    status: { type: "string", example: "healthy" },
                    timestamp: { type: "string", format: "date-time" },
                    version: { type: "string", example: "1.0.0" },
                    environment: { type: "string", example: "development" },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/trpc/auth.register": {
      post: {
        tags: ["Auth"],
        summary: "Register a new user",
        description: "Creates a new user account (via tRPC batch)",
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  "0": {
                    type: "object",
                    properties: {
                      json: {
                        type: "object",
                        properties: {
                          email: { type: "string", format: "email" },
                          password: { type: "string", minLength: 8 },
                          name: { type: "string" },
                        },
                        required: ["email", "password", "name"],
                      },
                    },
                  },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Registration successful" },
          "400": { description: "Validation error" },
          "409": { description: "User already exists" },
        },
      },
    },
    "/trpc/auth.login": {
      post: {
        tags: ["Auth"],
        summary: "Login",
        description: "Authenticate user and receive JWT token (via tRPC batch)",
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  "0": {
                    type: "object",
                    properties: {
                      json: {
                        type: "object",
                        properties: {
                          email: { type: "string", format: "email" },
                          password: { type: "string" },
                        },
                        required: ["email", "password"],
                      },
                    },
                  },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Login successful, returns JWT token" },
          "401": { description: "Invalid credentials" },
        },
      },
    },
    "/trpc/organization.getAll": {
      get: {
        tags: ["Organizations"],
        summary: "List organizations",
        security: [{ bearerAuth: [] }],
        responses: {
          "200": { description: "List of organizations" },
          "401": { description: "Unauthorized" },
        },
      },
    },
    "/trpc/project.getAll": {
      get: {
        tags: ["Projects"],
        summary: "List projects",
        security: [{ bearerAuth: [] }],
        responses: {
          "200": { description: "List of projects" },
          "401": { description: "Unauthorized" },
        },
      },
    },
    "/trpc/application.getAll": {
      get: {
        tags: ["Applications"],
        summary: "List applications",
        security: [{ bearerAuth: [] }],
        responses: {
          "200": { description: "List of applications" },
          "401": { description: "Unauthorized" },
        },
      },
    },
    "/trpc/database.getAll": {
      get: {
        tags: ["Databases"],
        summary: "List databases",
        security: [{ bearerAuth: [] }],
        responses: {
          "200": { description: "List of managed databases" },
          "401": { description: "Unauthorized" },
        },
      },
    },
    "/trpc/deployment.getAll": {
      get: {
        tags: ["Deployments"],
        summary: "List deployments",
        security: [{ bearerAuth: [] }],
        responses: {
          "200": { description: "List of deployments" },
          "401": { description: "Unauthorized" },
        },
      },
    },
    "/trpc/kubernetes.getClusters": {
      get: {
        tags: ["Kubernetes"],
        summary: "List Kubernetes clusters",
        security: [{ bearerAuth: [] }],
        responses: {
          "200": { description: "List of Kubernetes clusters" },
          "401": { description: "Unauthorized" },
        },
      },
    },
    "/trpc/workflow.getAll": {
      get: {
        tags: ["Workflows"],
        summary: "List workflows",
        security: [{ bearerAuth: [] }],
        responses: {
          "200": { description: "List of workflow templates" },
          "401": { description: "Unauthorized" },
        },
      },
    },
    "/trpc/monitoring.getMetrics": {
      get: {
        tags: ["Monitoring"],
        summary: "Get metrics",
        security: [{ bearerAuth: [] }],
        responses: {
          "200": { description: "System metrics" },
          "401": { description: "Unauthorized" },
        },
      },
    },
    "/trpc/audit.getLogs": {
      get: {
        tags: ["Audit"],
        summary: "Get audit logs",
        security: [{ bearerAuth: [] }],
        responses: {
          "200": { description: "Audit log entries" },
          "401": { description: "Unauthorized" },
        },
      },
    },
    "/trpc/user.getProfile": {
      get: {
        tags: ["Users"],
        summary: "Get current user profile",
        security: [{ bearerAuth: [] }],
        responses: {
          "200": { description: "User profile" },
          "401": { description: "Unauthorized" },
        },
      },
    },
  },
  components: {
    schemas: { ApiError: { type: "object", required: ["error"], properties: { error: { type: "object", required: ["code", "message"], properties: { code: { type: "string", enum: ["UNAUTHORIZED", "FORBIDDEN", "NOT_FOUND", "BAD_REQUEST", "RATE_LIMITED", "INTERNAL"] }, message: { type: "string" } } } } } },
    responses: {
      ApiUnauthorized: { description: 'Missing, unknown, revoked or expired token', content: { "application/json": { schema: { $ref: "#/components/schemas/ApiError" } } } },
      ApiForbidden: { description: 'The token lacks the required scope', content: { "application/json": { schema: { $ref: "#/components/schemas/ApiError" } } } },
      ApiNotFound: { description: "Not found, or outside the token's organization or project restriction", content: { "application/json": { schema: { $ref: "#/components/schemas/ApiError" } } } },
      ApiRateLimited: { description: "Per-token rate limit exceeded", headers: { "Retry-After": { schema: { type: "integer" } } }, content: { "application/json": { schema: { $ref: "#/components/schemas/ApiError" } } } },
    },
    securitySchemes: {
      apiToken: { type: "http", scheme: "bearer", bearerFormat: "gs_pat_<43 base64url characters>", description: "A scoped personal access token. Scopes: read, deploy, write, admin (admin implies all; write and deploy each imply read)." },
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
      },
    },
  },
  tags: [
    { name: "System", description: "System health and status" },
    { name: "Auth", description: "Authentication and registration" },
    { name: "Organizations", description: "Organization management" },
    { name: "Projects", description: "Project management" },
    { name: "Applications", description: "Application deployment and management" },
    { name: "Databases", description: "Database management" },
    { name: "Deployments", description: "Deployment management" },
    { name: "Kubernetes", description: "Kubernetes cluster management" },
    { name: "Workflows", description: "Workflow templates and execution" },
    { name: "Monitoring", description: "System monitoring and metrics" },
    { name: "Audit", description: "Audit logging" },
    { name: "Users", description: "User management" },
  ],
};

export function setupSwagger(app: Express): void {
  app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerDocument, {
    customCss: ".swagger-ui .topbar { display: none }",
    customSiteTitle: "GuildServer PaaS API Docs",
  }));

  app.get("/api-docs.json", (_req, res) => {
    res.json(swaggerDocument);
  });
}
