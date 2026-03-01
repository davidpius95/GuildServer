import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "../trpc/trpc";
import { databases, projects, members } from "@guildserver/database";
import { eq, and, desc } from "drizzle-orm";

const createDatabaseSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["postgresql", "mysql", "mongodb", "redis", "mariadb"]),
  projectId: z.string().uuid(),
  databaseName: z.string().min(1),
  username: z.string().min(1),
  password: z.string().min(8),
  dockerImage: z.string().optional(),
  memoryLimit: z.number().optional(),
  cpuLimit: z.number().optional(),
  externalPort: z.number().optional(),
});

const updateDatabaseSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).optional(),
  memoryLimit: z.number().optional(),
  cpuLimit: z.number().optional(),
  externalPort: z.number().optional(),
});

export const databaseRouter = createTRPCRouter({
  list: protectedProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      // Check if user has access to the project
      const project = await ctx.db.query.projects.findFirst({
        where: eq(projects.id, input.projectId),
        with: {
          organization: {
            with: {
              members: {
                where: eq(members.userId, ctx.user.id),
              },
            },
          },
        },
      });

      if (!project || project.organization.members.length === 0) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You don't have access to this project",
        });
      }

      const projectDatabases = await ctx.db.query.databases.findMany({
        where: eq(databases.projectId, input.projectId),
        orderBy: [desc(databases.createdAt)],
      });

      return projectDatabases;
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const database = await ctx.db.query.databases.findFirst({
        where: eq(databases.id, input.id),
        with: {
          project: {
            with: {
              organization: {
                with: {
                  members: {
                    where: eq(members.userId, ctx.user.id),
                  },
                },
              },
            },
          },
        },
      });

      if (!database || database.project.organization.members.length === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Database not found or access denied",
        });
      }

      return database;
    }),

  create: protectedProcedure
    .input(createDatabaseSchema)
    .mutation(async ({ ctx, input }) => {
      // Check if user has access to the project
      const project = await ctx.db.query.projects.findFirst({
        where: eq(projects.id, input.projectId),
        with: {
          organization: {
            with: {
              members: {
                where: eq(members.userId, ctx.user.id),
              },
            },
          },
        },
      });

      if (!project || project.organization.members.length === 0) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You don't have access to this project",
        });
      }

      // Set default Docker image based on database type
      const defaultImages = {
        postgresql: "postgres:15",
        mysql: "mysql:8.0",
        mariadb: "mariadb:10.11",
        mongodb: "mongo:7.0",
        redis: "redis:7-alpine",
      };

      const [newDatabase] = await ctx.db
        .insert(databases)
        .values({
          ...input,
          dockerImage: input.dockerImage || defaultImages[input.type],
          environment: {
            [`${input.type.toUpperCase()}_DB`]: input.databaseName,
            [`${input.type.toUpperCase()}_USER`]: input.username,
            [`${input.type.toUpperCase()}_PASSWORD`]: input.password,
          },
        })
        .returning();

      return newDatabase;
    }),

  update: protectedProcedure
    .input(updateDatabaseSchema)
    .mutation(async ({ ctx, input }) => {
      const { id, ...updates } = input;

      // Check if user has access to the database
      const database = await ctx.db.query.databases.findFirst({
        where: eq(databases.id, id),
        with: {
          project: {
            with: {
              organization: {
                with: {
                  members: {
                    where: eq(members.userId, ctx.user.id),
                  },
                },
              },
            },
          },
        },
      });

      if (!database || database.project.organization.members.length === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Database not found or access denied",
        });
      }

      const [updatedDatabase] = await ctx.db
        .update(databases)
        .set({
          ...updates,
          updatedAt: new Date(),
        })
        .where(eq(databases.id, id))
        .returning();

      return updatedDatabase;
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      // Check if user has access to the database
      const database = await ctx.db.query.databases.findFirst({
        where: eq(databases.id, input.id),
        with: {
          project: {
            with: {
              organization: {
                with: {
                  members: {
                    where: eq(members.userId, ctx.user.id),
                  },
                },
              },
            },
          },
        },
      });

      if (!database || database.project.organization.members.length === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Database not found or access denied",
        });
      }

      await ctx.db.delete(databases).where(eq(databases.id, input.id));

      return { success: true };
    }),

  restart: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      // Check if user has access to the database
      const database = await ctx.db.query.databases.findFirst({
        where: eq(databases.id, input.id),
        with: {
          project: {
            with: {
              organization: {
                with: {
                  members: {
                    where: eq(members.userId, ctx.user.id),
                  },
                },
              },
            },
          },
        },
      });

      if (!database || database.project.organization.members.length === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Database not found or access denied",
        });
      }

      // TODO: Implement real database restart
      return { success: true, message: "Database restart initiated" };
    }),

  getConnectionInfo: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const database = await ctx.db.query.databases.findFirst({
        where: eq(databases.id, input.id),
        with: {
          project: {
            with: {
              organization: {
                with: {
                  members: {
                    where: eq(members.userId, ctx.user.id),
                  },
                },
              },
            },
          },
        },
      });

      if (!database || database.project.organization.members.length === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Database not found or access denied",
        });
      }

      // Generate connection strings based on database type
      const host = "localhost"; // In production, this would be the actual host
      const port = database.externalPort || getDefaultPort(database.type);
      
      const connectionInfo = {
        host,
        port,
        database: database.databaseName,
        username: database.username,
        // Don't return password in plain text
        connectionString: generateConnectionString(database.type, host, port, database.databaseName, database.username),
      };

      return connectionInfo;
    }),
});

function getDefaultPort(type: string): number {
  const defaultPorts = {
    postgresql: 5432,
    mysql: 3306,
    mariadb: 3306,
    mongodb: 27017,
    redis: 6379,
  };
  return defaultPorts[type as keyof typeof defaultPorts] || 5432;
}

function generateConnectionString(type: string, host: string, port: number, database: string, username: string): string {
  switch (type) {
    case "postgresql":
      return `postgresql://${username}:***@${host}:${port}/${database}`;
    case "mysql":
    case "mariadb":
      return `mysql://${username}:***@${host}:${port}/${database}`;
    case "mongodb":
      return `mongodb://${username}:***@${host}:${port}/${database}`;
    case "redis":
      return `redis://${username}:***@${host}:${port}`;
    default:
      return `${type}://${username}:***@${host}:${port}/${database}`;
  }
}