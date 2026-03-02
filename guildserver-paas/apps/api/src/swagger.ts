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
    securitySchemes: {
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
