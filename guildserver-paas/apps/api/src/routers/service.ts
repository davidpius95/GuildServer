/**
 * Compose stacks ("services") as a first-class resource.
 *
 * Authorization follows `routers/application.ts` exactly: every procedure
 * resolves the stack's project, walks to its organization, and requires a
 * `members` row for the calling user. There is no code path here that reaches a
 * stack by id alone — an unscoped `findFirst(eq(services.id, input.id))` is how
 * one tenant reads, redeploys or deletes another tenant's stack, so the
 * org-scoped lookup is factored into a single helper that every procedure uses.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq, and, desc } from "drizzle-orm";
import {
  services,
  serviceContainers,
  serviceVolumes,
  projects,
  members,
  deployments,
} from "@guildserver/database";
import { createTRPCRouter, protectedProcedure } from "../trpc/trpc";
import { deploymentQueue } from "../queues/deployment";
import { ComposeParseError, parseCompose } from "../services/compose/parse";
import { ComposeNormalizeError, normalizeCompose, slugify } from "../services/compose/normalize";
import {
  getStackLogs,
  reconcileContainers,
  removeStack,
  restartStack,
  stopStack,
} from "../services/compose/deploy";

// ---------------------------------------------------------------------------
// Authorization
// ---------------------------------------------------------------------------

/**
 * Fetch a stack the caller is actually entitled to.
 *
 * Returns the row or throws NOT_FOUND — deliberately the same error for "no
 * such stack" and "not yours", so the API does not confirm the existence of
 * another organization's resources.
 */
async function requireStackAccess(ctx: any, serviceId: string) {
  const service = await ctx.db.query.services.findFirst({ where: eq(services.id, serviceId) });

  // Two queries rather than a relational `with:` because `services` has no
  // drizzle relations declared, and inventing one here would mean editing the
  // shared schema module. The membership check is identical either way, and
  // failing closed on a null projectId is the important part: a stack with no
  // project has no organization and therefore nobody who may touch it.
  if (!service?.projectId) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Stack not found or access denied" });
  }

  const project = await ctx.db.query.projects.findFirst({
    where: eq(projects.id, service.projectId),
    with: {
      organization: {
        with: { members: { where: eq(members.userId, ctx.user.id) } },
      },
    },
  });

  if (!project || project.organization.members.length === 0) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Stack not found or access denied" });
  }
  return service;
}

async function requireProjectAccess(ctx: any, projectId: string) {
  const project = await ctx.db.query.projects.findFirst({
    where: eq(projects.id, projectId),
    with: {
      organization: {
        with: { members: { where: eq(members.userId, ctx.user.id) } },
      },
    },
  });

  if (!project || project.organization.members.length === 0) {
    throw new TRPCError({ code: "FORBIDDEN", message: "You don't have access to this project" });
  }
  return project;
}

/** Turn a parse/normalise failure into a BAD_REQUEST carrying every problem. */
function asUserFacingError(error: unknown): never {
  if (error instanceof ComposeParseError || error instanceof ComposeNormalizeError) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: error.message,
      cause: error,
    });
  }
  throw error;
}

// ---------------------------------------------------------------------------
// Input schemas
// ---------------------------------------------------------------------------

const domainMapSchema = z.record(z.array(z.string().min(1)));

const createServiceSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  projectId: z.string().uuid(),
  composeFile: z.string().min(1).max(512 * 1024),
  environment: z.record(z.string()).default({}),
  domains: domainMapSchema.default({}),
  providerId: z.string().uuid().optional().nullable(),
  templateId: z.string().max(255).optional(),
  templateVersion: z.string().max(64).optional(),
});

const updateServiceSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(255).optional(),
  description: z.string().optional(),
  composeFile: z.string().min(1).max(512 * 1024).optional(),
  environment: z.record(z.string()).optional(),
  domains: domainMapSchema.optional(),
});

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const serviceRouter = createTRPCRouter({
  /**
   * Validate a Compose file without saving it.
   *
   * Exists so the editor can show problems as the user types. Reachable by any
   * authenticated user: it touches no stored data, only the submitted text.
   */
  validate: protectedProcedure
    .input(z.object({ composeFile: z.string().min(1).max(512 * 1024) }))
    .query(({ input }) => {
      try {
        const parsed = parseCompose(input.composeFile);
        return {
          valid: true as const,
          problems: [] as string[],
          notes: parsed.notes,
          services: parsed.services.map((s) => ({
            name: s.name,
            image: s.image,
            ports: s.ports.map((p) => p.raw),
            volumes: s.volumes.map((v) => v.raw),
            dependsOn: s.dependsOn,
          })),
          volumes: parsed.volumes.map((v) => v.name),
        };
      } catch (error) {
        if (error instanceof ComposeParseError) {
          return { valid: false as const, problems: error.problems, notes: [], services: [], volumes: [] };
        }
        throw error;
      }
    }),

  create: protectedProcedure.input(createServiceSchema).mutation(async ({ ctx, input }) => {
    await requireProjectAccess(ctx, input.projectId);

    // Reject at save time, not deploy time. A stack that saves and then fails
    // every deploy with a parse error is worse than one that never saves.
    try {
      parseCompose(input.composeFile);
    } catch (error) {
      asUserFacingError(error);
    }

    const [created] = await ctx.db
      .insert(services)
      .values({
        name: input.name,
        serviceName: slugify(input.name),
        description: input.description,
        projectId: input.projectId,
        composeFile: input.composeFile,
        environment: input.environment,
        domains: input.domains,
        providerId: input.providerId ?? null,
        templateId: input.templateId ?? "custom",
        templateVersion: input.templateVersion,
        status: "inactive",
      })
      .returning();

    return created;
  }),

  update: protectedProcedure.input(updateServiceSchema).mutation(async ({ ctx, input }) => {
    await requireStackAccess(ctx, input.id);

    if (input.composeFile) {
      try {
        parseCompose(input.composeFile);
      } catch (error) {
        asUserFacingError(error);
      }
    }

    const { id, ...changes } = input;
    const [updated] = await ctx.db
      .update(services)
      .set({ ...changes, updatedAt: new Date() })
      .where(eq(services.id, id))
      .returning();

    return updated;
  }),

  list: protectedProcedure.input(z.object({ projectId: z.string().uuid() })).query(async ({ ctx, input }) => {
    await requireProjectAccess(ctx, input.projectId);

    const rows = await ctx.db.query.services.findMany({
      where: eq(services.projectId, input.projectId),
      orderBy: [desc(services.createdAt)],
    });

    const withCounts = await Promise.all(
      rows.map(async (row) => {
        const containers = await ctx.db
          .select()
          .from(serviceContainers)
          .where(eq(serviceContainers.serviceId, row.id));
        return {
          ...row,
          containerCount: containers.length,
          runningCount: containers.filter((c) => c.status === "running").length,
        };
      }),
    );

    return withCounts;
  }),

  getById: protectedProcedure.input(z.object({ id: z.string().uuid() })).query(async ({ ctx, input }) => {
    const service = await requireStackAccess(ctx, input.id);

    const [containers, volumes, history] = await Promise.all([
      ctx.db.select().from(serviceContainers).where(eq(serviceContainers.serviceId, input.id)),
      ctx.db.select().from(serviceVolumes).where(eq(serviceVolumes.serviceId, input.id)),
      ctx.db
        .select()
        .from(deployments)
        .where(eq(deployments.serviceId, input.id))
        .orderBy(desc(deployments.createdAt))
        .limit(10),
    ]);

    return {
      ...service,
      containers: containers.sort((a, b) => a.composeServiceName.localeCompare(b.composeServiceName)),
      volumes,
      deployments: history,
    };
  }),

  /**
   * Preview exactly what will be handed to Docker.
   *
   * Generated credentials are redacted: this endpoint exists so a user can see
   * the namespacing we applied, not so a stack's secrets leak into a UI panel.
   */
  preview: protectedProcedure.input(z.object({ id: z.string().uuid() })).query(async ({ ctx, input }) => {
    const service = await requireStackAccess(ctx, input.id);
    try {
      const normalized = normalizeCompose({
        service: {
          id: service.id,
          serviceName: service.serviceName,
          projectId: service.projectId,
          environment: (service.environment as Record<string, string>) ?? {},
          domains: (service.domains as Record<string, string[]>) ?? {},
        },
        composeFile: service.composeFile,
      });
      return {
        project: normalized.project,
        composeResolved: normalized.composeResolved,
        services: normalized.services.map((s) => ({
          composeServiceName: s.composeServiceName,
          containerName: s.containerName,
          image: s.image,
          domains: s.domains,
          routedPort: s.routedPort,
        })),
        volumes: normalized.volumes,
        networks: normalized.networks,
        generatedVariables: Object.keys(normalized.generatedEnvironment),
        notes: normalized.notes,
      };
    } catch (error) {
      asUserFacingError(error);
    }
  }),

  deploy: protectedProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    const service = await requireStackAccess(ctx, input.id);

    // Normalise before enqueueing so a broken file fails here, with the whole
    // problem list, rather than in a worker the user has to go and read logs for.
    try {
      normalizeCompose({
        service: {
          id: service.id,
          serviceName: service.serviceName,
          projectId: service.projectId,
          environment: (service.environment as Record<string, string>) ?? {},
          domains: (service.domains as Record<string, string[]>) ?? {},
        },
        composeFile: service.composeFile,
      });
    } catch (error) {
      asUserFacingError(error);
    }

    const [deployment] = await ctx.db
      .insert(deployments)
      .values({
        title: `Deploy ${service.name}`,
        description: `Stack deployment triggered by ${ctx.user.name || ctx.user.email}`,
        status: "pending",
        serviceId: service.id,
        startedAt: new Date(),
      })
      .returning();

    await deploymentQueue.add(
      "deploy-service",
      { deploymentId: deployment.id, serviceId: service.id, userId: ctx.user.id },
      { removeOnComplete: 50, removeOnFail: 20 },
    );

    return deployment;
  }),

  stop: protectedProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    await requireStackAccess(ctx, input.id);
    const result = await stopStack({ serviceId: input.id, userId: ctx.user.id });
    return { success: result.code === 0, output: result.stderr || result.stdout };
  }),

  restart: protectedProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    await requireStackAccess(ctx, input.id);
    const result = await restartStack({ serviceId: input.id, userId: ctx.user.id });
    return { success: result.code === 0, output: result.stderr || result.stdout };
  }),

  delete: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        /**
         * Volumes hold the stack's data, so deleting them is opt-in and the UI
         * must ask. Defaulting this to true would make "remove this stack from
         * the list" silently destroy a database.
         */
        removeVolumes: z.boolean().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireStackAccess(ctx, input.id);

      const result = await removeStack({
        serviceId: input.id,
        removeVolumes: input.removeVolumes,
        userId: ctx.user.id,
      });

      if (result.failedVolumes.length > 0) {
        // Keep the row: its `service_volumes` rows are the only record of which
        // volumes are ours, and dropping them turns a retryable failure into an
        // orphaned volume nobody can attribute.
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Stack containers were removed but ${result.failedVolumes.length} volume(s) could not be deleted: ${result.failedVolumes
            .map((v) => `${v.name} (${v.reason})`)
            .join(", ")}`,
        });
      }

      await ctx.db.delete(services).where(eq(services.id, input.id));
      return { success: true, ...result };
    }),

  logs: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        composeServiceName: z.string().min(1).max(255).optional(),
        tail: z.number().int().min(1).max(5000).default(200),
      }),
    )
    .query(async ({ ctx, input }) => {
      const service = await requireStackAccess(ctx, input.id);

      // The service name reaches a subprocess argv. `spawn` runs without a
      // shell so it cannot be injected, but an arbitrary string could still
      // read another compose service's logs if it were somehow in this project,
      // so it is checked against what this stack actually declares.
      if (input.composeServiceName) {
        const known = await ctx.db
          .select()
          .from(serviceContainers)
          .where(
            and(
              eq(serviceContainers.serviceId, service.id),
              eq(serviceContainers.composeServiceName, input.composeServiceName),
            ),
          );
        if (known.length === 0) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: `"${input.composeServiceName}" is not a service in this stack`,
          });
        }
      }

      const lines = await getStackLogs({
        serviceId: input.id,
        composeServiceName: input.composeServiceName,
        tail: input.tail,
      });
      return { logs: lines };
    }),

  status: protectedProcedure.input(z.object({ id: z.string().uuid() })).query(async ({ ctx, input }) => {
    const service = await requireStackAccess(ctx, input.id);

    const containers = await reconcileContainers({ serviceId: service.id });
    return {
      id: service.id,
      status: service.status,
      containers,
      missing: containers.filter((c) => c.status === "missing").map((c) => c.composeServiceName),
    };
  }),
});
