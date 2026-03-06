import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "../trpc/trpc";
import { kubernetesClusters, k8sDeployments, members } from "@guildserver/database";
import { eq, and, desc, or } from "drizzle-orm";

const createClusterSchema = z.object({
  name: z.string().min(1),
  kubeconfig: z.string().min(1),
  endpoint: z.string().url(),
  version: z.string().optional(),
  provider: z.string().optional(),
  region: z.string().optional(),
  organizationId: z.string().uuid(),
});

const updateClusterSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).optional(),
  version: z.string().optional(),
  provider: z.string().optional(),
  region: z.string().optional(),
});

const deployToK8sSchema = z.object({
  clusterId: z.string().uuid(),
  applicationId: z.string().uuid(),
  namespace: z.string().default("default"),
  helmChartName: z.string().optional(),
  helmChartVersion: z.string().optional(),
  values: z.record(z.any()).default({}),
});

export const kubernetesRouter = createTRPCRouter({
  listClusters: protectedProcedure
    .input(z.object({ organizationId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      // Check if user is a member of the organization
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

      const clusters = await ctx.db.query.kubernetesClusters.findMany({
        where: eq(kubernetesClusters.organizationId, input.organizationId),
        orderBy: [desc(kubernetesClusters.createdAt)],
        columns: {
          id: true,
          name: true,
          endpoint: true,
          version: true,
          provider: true,
          region: true,
          status: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      return clusters;
    }),

  getClusterById: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const cluster = await ctx.db.query.kubernetesClusters.findFirst({
        where: eq(kubernetesClusters.id, input.id),
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

      if (!cluster || cluster.organization.members.length === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Cluster not found or access denied",
        });
      }

      return {
        ...cluster,
        kubeconfig: "***", // Don't return sensitive kubeconfig
      };
    }),

  createCluster: protectedProcedure
    .input(createClusterSchema)
    .mutation(async ({ ctx, input }) => {
      // Check if user is a member of the organization with admin permissions
      const member = await ctx.db.query.members.findFirst({
        where: and(
          eq(members.organizationId, input.organizationId),
          eq(members.userId, ctx.user.id)
        ),
      });

      if (!member || (member.role !== "owner" && member.role !== "admin")) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You don't have permission to create clusters",
        });
      }

      // TODO: Validate kubeconfig by testing connection
      
      const [newCluster] = await ctx.db
        .insert(kubernetesClusters)
        .values({
          name: input.name,
          kubeconfig: input.kubeconfig,
          endpoint: input.endpoint,
          version: input.version,
          provider: input.provider,
          region: input.region,
          organizationId: input.organizationId,
          status: "pending", // Will be updated after validation
        })
        .returning();

      return newCluster;
    }),

  updateCluster: protectedProcedure
    .input(updateClusterSchema)
    .mutation(async ({ ctx, input }) => {
      const { id, ...updates } = input;

      // Check if user has access to update the cluster
      const cluster = await ctx.db.query.kubernetesClusters.findFirst({
        where: eq(kubernetesClusters.id, id),
        with: {
          organization: {
            with: {
              members: {
                where: and(
                  eq(members.userId, ctx.user.id),
                  or(eq(members.role, "owner"), eq(members.role, "admin"))
                ),
              },
            },
          },
        },
      });

      if (!cluster || cluster.organization.members.length === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Cluster not found or access denied",
        });
      }

      const [updatedCluster] = await ctx.db
        .update(kubernetesClusters)
        .set({
          ...updates,
          updatedAt: new Date(),
        })
        .where(eq(kubernetesClusters.id, id))
        .returning();

      return updatedCluster;
    }),

  deleteCluster: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      // Check if user has access to delete the cluster
      const cluster = await ctx.db.query.kubernetesClusters.findFirst({
        where: eq(kubernetesClusters.id, input.id),
        with: {
          organization: {
            with: {
              members: {
                where: and(
                  eq(members.userId, ctx.user.id),
                  or(eq(members.role, "owner"), eq(members.role, "admin"))
                ),
              },
            },
          },
        },
      });

      if (!cluster || cluster.organization.members.length === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Cluster not found or access denied",
        });
      }

      await ctx.db.delete(kubernetesClusters).where(eq(kubernetesClusters.id, input.id));

      return { success: true };
    }),

  deployToCluster: protectedProcedure
    .input(deployToK8sSchema)
    .mutation(async ({ ctx, input }) => {
      const { clusterId, applicationId, namespace, helmChartName, helmChartVersion, values } = input;

      // Check if user has access to the cluster
      const cluster = await ctx.db.query.kubernetesClusters.findFirst({
        where: eq(kubernetesClusters.id, clusterId),
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

      if (!cluster || cluster.organization.members.length === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Cluster not found or access denied",
        });
      }

      // TODO: Check if user has access to the application

      const [deployment] = await ctx.db
        .insert(k8sDeployments)
        .values({
          name: `app-${applicationId.substring(0, 8)}`,
          namespace,
          clusterId,
          applicationId,
          helmChartName,
          helmChartVersion,
          values,
          status: "pending",
        })
        .returning();

      // TODO: Add deployment to Kubernetes queue

      return deployment;
    }),

  listDeployments: protectedProcedure
    .input(z.object({ clusterId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      // Check if user has access to the cluster
      const cluster = await ctx.db.query.kubernetesClusters.findFirst({
        where: eq(kubernetesClusters.id, input.clusterId),
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

      if (!cluster || cluster.organization.members.length === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Cluster not found or access denied",
        });
      }

      const deployments = await ctx.db.query.k8sDeployments.findMany({
        where: eq(k8sDeployments.clusterId, input.clusterId),
        orderBy: [desc(k8sDeployments.createdAt)],
        with: {
          application: {
            columns: {
              id: true,
              name: true,
              appName: true,
            },
          },
        },
      });

      return deployments;
    }),

  getClusterStatus: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const cluster = await ctx.db.query.kubernetesClusters.findFirst({
        where: eq(kubernetesClusters.id, input.id),
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

      if (!cluster || cluster.organization.members.length === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Cluster not found or access denied",
        });
      }

      // TODO: Implement real cluster status checking
      // This would connect to the cluster and get real status
      const mockStatus = {
        status: "active",
        nodes: [
          {
            name: "node-1",
            status: "Ready",
            cpu: "2 cores",
            memory: "8Gi",
          },
          {
            name: "node-2", 
            status: "Ready",
            cpu: "2 cores",
            memory: "8Gi",
          },
        ],
        namespaces: [
          { name: "default", status: "Active" },
          { name: "kube-system", status: "Active" },
          { name: "guildserver", status: "Active" },
        ],
        version: cluster.version || "v1.29.0",
      };

      return mockStatus;
    }),

  getClusterMetrics: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const cluster = await ctx.db.query.kubernetesClusters.findFirst({
        where: eq(kubernetesClusters.id, input.id),
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

      if (!cluster || cluster.organization.members.length === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Cluster not found or access denied",
        });
      }

      // TODO: Implement real cluster metrics from Prometheus
      const mockMetrics = {
        cpuUsage: {
          current: 45.2,
          total: 100,
          data: Array.from({ length: 24 }, (_, i) => ({
            timestamp: new Date(Date.now() - (23 - i) * 60 * 60 * 1000),
            value: Math.random() * 60 + 20,
          })),
        },
        memoryUsage: {
          current: 6.8,
          total: 16,
          data: Array.from({ length: 24 }, (_, i) => ({
            timestamp: new Date(Date.now() - (23 - i) * 60 * 60 * 1000),
            value: Math.random() * 10 + 4,
          })),
        },
        podCount: {
          running: 15,
          pending: 2,
          failed: 0,
          total: 17,
        },
      };

      return mockMetrics;
    }),
});