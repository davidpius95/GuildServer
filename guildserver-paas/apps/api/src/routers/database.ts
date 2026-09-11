import * as path from "path";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "../trpc/trpc";
import { databases, projects, members, databaseBackups, applications, environmentVariables, s3Storages } from "@guildserver/database";
import { eq, and, desc, inArray } from "drizzle-orm";
import { DatabaseBackupService } from "../services/db-backup";
import { provisionDatabaseContainer, removeDatabaseVolume } from "../services/database-provision";
import { restartContainer, removeExistingContainers } from "../services/docker/container";
import { addBackupJob, addRestoreJob, syncBackupSchedule } from "../queues/backups";
import { encryptSecret } from "../utils/crypto";
import { logger } from "../utils/logger";

const databasePublicHost =
  process.env.DATABASE_PUBLIC_HOST ||
  process.env.BASE_DOMAIN ||
  (() => {
    try {
      return process.env.APP_URL ? new URL(process.env.APP_URL).hostname : undefined;
    } catch {
      return undefined;
    }
  })() ||
  "localhost";

const backupSettingsSchema = z.object({
  backupEnabled: z.boolean().optional(),
  backupFrequency: z.enum(["hourly", "daily", "weekly"]).optional(),
  backupHour: z.number().int().min(0).max(23).optional(),
  backupRetentionDays: z.number().int().min(1).max(365).optional(),
  /** Off-site destination for this database's backups; null keeps them local. */
  backupStorageId: z.string().uuid().nullable().optional(),
});

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
  backupEnabled: z.boolean().optional(),
  backupFrequency: z.enum(["hourly", "daily", "weekly"]).optional(),
  backupHour: z.number().int().min(0).max(23).optional(),
  backupRetentionDays: z.number().int().min(1).max(365).optional(),
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

  listByOrg: protectedProcedure
    .input(z.object({ organizationId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      // Check if user has access to the organization
      const member = await ctx.db.query.members.findFirst({
        where: and(
          eq(members.organizationId, input.organizationId),
          eq(members.userId, ctx.user.id)
        ),
      });

      if (!member) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You don't have access to this organization",
        });
      }

      // Get all projects in the organization
      const orgProjects = await ctx.db.query.projects.findMany({
        where: eq(projects.organizationId, input.organizationId),
        columns: { id: true },
      });

      if (orgProjects.length === 0) {
        return [];
      }

      const projectIds = orgProjects.map((p) => p.id);

      const orgDatabases = await ctx.db.query.databases.findMany({
        where: inArray(databases.projectId, projectIds),
        orderBy: [desc(databases.createdAt)],
        with: {
          project: true,
        },
      });

      return orgDatabases;
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
          cpuLimit: input.cpuLimit !== undefined ? String(input.cpuLimit) : undefined,
          dockerImage: input.dockerImage || defaultImages[input.type],
          status: "provisioning",
        })
        .returning();

      // Provision and start a real container for the database.
      try {
        const { hostPort, containerId, volumeName } = await provisionDatabaseContainer({
          databaseId: newDatabase.id,
          name: newDatabase.name,
          type: input.type,
          dockerImage: newDatabase.dockerImage,
          databaseName: input.databaseName,
          username: input.username,
          password: input.password,
        });
        const [updated] = await ctx.db
          .update(databases)
          .set({
            externalPort: hostPort,
            hostPort,
            containerId,
            volumeName,
            status: "running",
            updatedAt: new Date(),
          })
          .where(eq(databases.id, newDatabase.id))
          .returning();

        // Register the automatic-backup schedule if the user enabled it.
        if (updated.backupEnabled) {
          await syncBackupSchedule(updated).catch((err) =>
            logger.error(`Failed to sync backup schedule for ${updated.id}: ${err.message}`),
          );
        }
        return updated;
      } catch (err: any) {
        logger.error(`Database provisioning failed for ${newDatabase.id}: ${err.message}`);
        await ctx.db
          .update(databases)
          .set({ status: "error", updatedAt: new Date() })
          .where(eq(databases.id, newDatabase.id));
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Database created but failed to start: ${err.message}`,
        });
      }
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

      if (updates.externalPort !== undefined && updates.externalPort !== (database.hostPort || database.externalPort)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "The published port is assigned when the database is created. Use the internal connection for apps; restarting cannot change port mappings." });
      }

      const [updatedDatabase] = await ctx.db
        .update(databases)
        .set({
          ...updates,
          cpuLimit: updates.cpuLimit !== undefined ? String(updates.cpuLimit) : undefined,
          updatedAt: new Date(),
        })
        .where(eq(databases.id, id))
        .returning();

      return updatedDatabase;
    }),

  updateBackupSettings: protectedProcedure
    .input(backupSettingsSchema.extend({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { id, ...settings } = input;

      const database = await ctx.db.query.databases.findFirst({
        where: eq(databases.id, id),
        with: {
          project: {
            with: { organization: { with: { members: { where: eq(members.userId, ctx.user.id) } } } },
          },
        },
      });

      if (!database || database.project.organization.members.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Database not found or access denied" });
      }

      if (settings.backupStorageId) {
        const storage = await ctx.db.query.s3Storages.findFirst({ where: eq(s3Storages.id, settings.backupStorageId) });
        // Another organization's storage is treated exactly like a missing one.
        if (!storage || !database.project || storage.organizationId !== database.project.organizationId) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Backup storage not found" });
        }
      }

      const [updated] = await ctx.db
        .update(databases)
        .set({ ...settings, updatedAt: new Date() })
        .where(eq(databases.id, id))
        .returning();

      // Re-register / remove the automatic-backup schedule to match new settings.
      await syncBackupSchedule(updated).catch((err) =>
        logger.error(`Failed to sync backup schedule for ${id}: ${err.message}`),
      );

      return updated;
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid(), destroyData: z.boolean().optional() }))
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

      // Cancel any automatic-backup schedule for this database.
      await syncBackupSchedule({ ...database, backupEnabled: false }).catch((err) =>
        logger.warn(`Failed to remove backup schedule for ${input.id}: ${err.message}`),
      );

      // Remove the running container before deleting the record.
      try {
        await removeExistingContainers(input.id);
      } catch (err: any) {
        logger.warn(`Failed to remove container for database ${input.id}: ${err.message}`);
      }

      // Only destroy the persistent data volume when explicitly requested.
      if (input.destroyData) {
        await removeDatabaseVolume(input.id);
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

      const restarted = await restartContainer(input.id);
      if (!restarted) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No running container found for this database.",
        });
      }
      await ctx.db
        .update(databases)
        .set({ status: "running", updatedAt: new Date() })
        .where(eq(databases.id, input.id));
      return { success: true, message: "Database restarted successfully" };
    }),

  connectToApp: protectedProcedure
    .input(z.object({ id: z.string().uuid(), applicationId: z.string().uuid(), replaceExisting: z.boolean().default(false) }))
    .mutation(async ({ ctx, input }) => {
      const database = await ctx.db.query.databases.findFirst({
        where: eq(databases.id, input.id),
        with: { project: { with: { organization: { with: { members: { where: eq(members.userId, ctx.user.id) } } } } } },
      });
      const app = await ctx.db.query.applications.findFirst({
        where: eq(applications.id, input.applicationId),
        with: { project: { with: { organization: { with: { members: { where: eq(members.userId, ctx.user.id) } } } } } },
      });
      if (!database?.project?.organization?.members.length || !app?.project?.organization?.members.length) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Database or application not found or access denied" });
      }
      if (app.projectId !== database.projectId || (app.deploymentTarget && app.deploymentTarget !== "docker-local") || app.providerId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Select an app in the same project running on this server." });
      }
      const key = database.type === "redis" ? "REDIS_URL" : "DATABASE_URL";
      const existing = await ctx.db.query.environmentVariables.findFirst({
        where: and(eq(environmentVariables.applicationId, app.id), eq(environmentVariables.key, key), eq(environmentVariables.scope, "production")),
      });
      if ((existing || (app.environment as Record<string, string> | null)?.[key]) && !input.replaceExisting) {
        throw new TRPCError({ code: "CONFLICT", message: `${key} already exists. Choose Replace existing connection to change it.` });
      }
      const value = encryptSecret(generateConnectionString(database.type, `gs-db-${database.id.slice(0, 12)}`, getDefaultPort(database.type), database.databaseName, database.username, database.password))!;
      if (existing) {
        await ctx.db.update(environmentVariables).set({ value, isSecret: true, updatedAt: new Date() }).where(eq(environmentVariables.id, existing.id));
      } else {
        await ctx.db.insert(environmentVariables).values({ applicationId: app.id, key, value, isSecret: true, scope: "production" });
      }
      return { success: true, key, redeployRequired: true };
    }),

  getConnectionInfo: protectedProcedure
    .input(z.object({ id: z.string().uuid(), target: z.enum(["internal", "external"]).default("internal") }))
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

      // Generate connection strings based on database type.
      // In production this must be the reachable host, not the API container.
      const host = input.target === "internal" ? `gs-db-${database.id.slice(0, 12)}` : databasePublicHost;
      const port = input.target === "internal" ? getDefaultPort(database.type) : (database.hostPort || database.externalPort || getDefaultPort(database.type));
      
      const connectionInfo = {
        host,
        port,
        target: input.target,
        database: database.databaseName,
        username: database.username,
        // Don't return password in plain text
        connectionString: generateConnectionString(database.type, host, port, database.databaseName, database.username),
      };

      return connectionInfo;
    }),

  backup: protectedProcedure
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

      // Create the record immediately (UI shows "in_progress"), then run the
      // real dump asynchronously on the backup worker.
      const backup = await DatabaseBackupService.triggerBackup(input.id, "manual");
      await addBackupJob(input.id, backup.id, "manual");
      return backup;
    }),

  listBackups: protectedProcedure
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
          code: "NOT_FOUND",
          message: "Project not found or access denied",
        });
      }

      const projectDatabases = await ctx.db.query.databases.findMany({
        where: eq(databases.projectId, input.projectId),
      });

      const dbIds = projectDatabases.map(db => db.id);
      if (dbIds.length === 0) return [];

      const backups = await ctx.db.query.databaseBackups.findMany({
        where: inArray(databaseBackups.databaseId, dbIds),
        orderBy: [desc(databaseBackups.createdAt)],
      });

      return backups.map(backup => ({
        ...backup,
        databaseName: projectDatabases.find(db => db.id === backup.databaseId)?.name || "Unknown",
      }));
    }),

  listBackupsByOrg: protectedProcedure
    .input(z.object({ organizationId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      // Check if user has access to the organization
      const member = await ctx.db.query.members.findFirst({
        where: and(
          eq(members.organizationId, input.organizationId),
          eq(members.userId, ctx.user.id)
        ),
      });

      if (!member) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You don't have access to this organization",
        });
      }

      // Get all projects in the organization
      const orgProjects = await ctx.db.query.projects.findMany({
        where: eq(projects.organizationId, input.organizationId),
        columns: { id: true },
      });

      if (orgProjects.length === 0) {
        return [];
      }

      const projectIds = orgProjects.map((p) => p.id);

      const orgDatabases = await ctx.db.query.databases.findMany({
        where: inArray(databases.projectId, projectIds),
      });

      const dbIds = orgDatabases.map(db => db.id);
      if (dbIds.length === 0) return [];

      const backups = await ctx.db.query.databaseBackups.findMany({
        where: inArray(databaseBackups.databaseId, dbIds),
        orderBy: [desc(databaseBackups.createdAt)],
      });

      return backups.map(backup => ({
        ...backup,
        databaseName: orgDatabases.find(db => db.id === backup.databaseId)?.name || "Unknown",
      }));
    }),

  restore: protectedProcedure
    .input(z.object({ backupId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const backup = await ctx.db.query.databaseBackups.findFirst({
        where: eq(databaseBackups.id, input.backupId),
      });

      if (!backup) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Backup not found",
        });
      }

      // Check if user has access to the database
      const database = await ctx.db.query.databases.findFirst({
        where: eq(databases.id, backup.databaseId),
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

      // Restore can be slow; run it on the worker.
      await addRestoreJob(input.backupId);
      return { success: true, message: "Restore started" };
    }),

  downloadBackup: protectedProcedure
    .input(z.object({ backupId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const backup = await ctx.db.query.databaseBackups.findFirst({
        where: eq(databaseBackups.id, input.backupId),
      });

      if (!backup) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Backup not found",
        });
      }

      // Check if user has access to the database
      const database = await ctx.db.query.databases.findFirst({
        where: eq(databases.id, backup.databaseId),
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

      if (backup.status !== "completed") {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Backup is not complete" });
      }
      // The file itself is served by GET /downloads/backup/:id, which verifies
      // its checksum and can fetch the off-site copy. This used to return the
      // absolute host path of the dump, revealing the server's filesystem layout.
      return {
        fileName: path.basename(backup.filePath || backup.remoteKey || `${backup.id}.backup`),
        downloadPath: `/downloads/backup/${backup.id}`,
      };
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

function generateConnectionString(type: string, host: string, port: number, database: string, username: string, password = "***"): string {
  username = encodeURIComponent(username);
  database = encodeURIComponent(database);
  const secret = password === "***" ? password : encodeURIComponent(password);
  switch (type) {
    case "postgresql":
      return `postgresql://${username}:${secret}@${host}:${port}/${database}`;
    case "mysql":
    case "mariadb":
      return `mysql://${username}:${secret}@${host}:${port}/${database}`;
    case "mongodb":
      return `mongodb://${username}:${secret}@${host}:${port}/${database}?authSource=admin`;
    case "redis":
      return `redis://:${secret}@${host}:${port}`;
    default:
      return `${type}://${username}:${secret}@${host}:${port}/${database}`;
  }
}
