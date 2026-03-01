import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure, adminProcedure } from "../trpc/trpc";
import { users, members, organizations } from "@guildserver/database";
import { eq, desc, like, or } from "drizzle-orm";

const updateUserSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).optional(),
  role: z.enum(["admin", "user"]).optional(),
});

export const userRouter = createTRPCRouter({
  list: adminProcedure
    .input(
      z.object({
        search: z.string().optional(),
        limit: z.number().default(50),
        offset: z.number().default(0),
      })
    )
    .query(async ({ ctx, input }) => {
      const whereClause = input.search
        ? or(
            like(users.name, `%${input.search}%`),
            like(users.email, `%${input.search}%`)
          )
        : undefined;

      const userList = await ctx.db.query.users.findMany({
        where: whereClause,
        orderBy: [desc(users.createdAt)],
        limit: input.limit,
        offset: input.offset,
        columns: {
          id: true,
          email: true,
          name: true,
          role: true,
          avatar: true,
          lastLogin: true,
          twoFactorEnabled: true,
          createdAt: true,
        },
        with: {
          memberships: {
            with: {
              organization: {
                columns: {
                  id: true,
                  name: true,
                  slug: true,
                },
              },
            },
          },
        },
      });

      return userList;
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      // Users can only view their own profile unless they're admin
      if (input.id !== ctx.user.id && !ctx.isAdmin) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You can only view your own profile",
        });
      }

      const user = await ctx.db.query.users.findFirst({
        where: eq(users.id, input.id),
        columns: {
          id: true,
          email: true,
          name: true,
          role: true,
          avatar: true,
          lastLogin: true,
          twoFactorEnabled: true,
          preferences: true,
          createdAt: true,
          updatedAt: true,
        },
        with: {
          memberships: {
            with: {
              organization: {
                columns: {
                  id: true,
                  name: true,
                  slug: true,
                  logo: true,
                },
              },
            },
          },
        },
      });

      if (!user) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "User not found",
        });
      }

      return user;
    }),

  update: adminProcedure
    .input(updateUserSchema)
    .mutation(async ({ ctx, input }) => {
      const { id, ...updates } = input;

      // Check if user exists
      const existingUser = await ctx.db.query.users.findFirst({
        where: eq(users.id, id),
      });

      if (!existingUser) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "User not found",
        });
      }

      const [updatedUser] = await ctx.db
        .update(users)
        .set({
          ...updates,
          updatedAt: new Date(),
        })
        .where(eq(users.id, id))
        .returning({
          id: users.id,
          email: users.email,
          name: users.name,
          role: users.role,
          updatedAt: users.updatedAt,
        });

      return updatedUser;
    }),

  delete: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      // Prevent admin from deleting their own account
      if (input.id === ctx.user.id) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "You cannot delete your own account",
        });
      }

      // Check if user exists
      const existingUser = await ctx.db.query.users.findFirst({
        where: eq(users.id, input.id),
      });

      if (!existingUser) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "User not found",
        });
      }

      await ctx.db.delete(users).where(eq(users.id, input.id));

      return { success: true };
    }),

  getActivity: protectedProcedure
    .input(
      z.object({
        userId: z.string().uuid().optional(),
        limit: z.number().default(20),
      })
    )
    .query(async ({ ctx, input }) => {
      const targetUserId = input.userId || ctx.user.id;

      // Users can only view their own activity unless they're admin
      if (targetUserId !== ctx.user.id && !ctx.isAdmin) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You can only view your own activity",
        });
      }

      // TODO: Implement actual activity tracking
      // This would typically come from audit logs or activity tracking
      const mockActivity = [
        {
          id: "1",
          action: "login",
          timestamp: new Date(),
          metadata: { ip: "192.168.1.1" },
        },
        {
          id: "2",
          action: "deploy_application",
          timestamp: new Date(Date.now() - 3600000),
          metadata: { applicationName: "frontend-app" },
        },
        {
          id: "3",
          action: "create_project",
          timestamp: new Date(Date.now() - 7200000),
          metadata: { projectName: "My Project" },
        },
      ];

      return mockActivity;
    }),

  getStats: adminProcedure.query(async ({ ctx }) => {
    // Get user statistics
    const totalUsers = await ctx.db.$count(users);
    
    const activeUsers = await ctx.db.query.users.findMany({
      where: (users, { gte }) => gte(users.lastLogin, new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)),
      columns: { id: true },
    });

    const adminUsers = await ctx.db.query.users.findMany({
      where: eq(users.role, "admin"),
      columns: { id: true },
    });

    return {
      total: totalUsers,
      active: activeUsers.length,
      admins: adminUsers.length,
      regular: totalUsers - adminUsers.length,
    };
  }),

  impersonate: adminProcedure
    .input(z.object({ userId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      // Check if target user exists
      const targetUser = await ctx.db.query.users.findFirst({
        where: eq(users.id, input.userId),
        columns: {
          id: true,
          email: true,
          name: true,
          role: true,
        },
      });

      if (!targetUser) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "User not found",
        });
      }

      // Don't allow impersonating another admin
      if (targetUser.role === "admin") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Cannot impersonate another admin",
        });
      }

      // TODO: Implement impersonation token generation
      // This would create a special JWT token that includes original admin user info
      
      return {
        user: targetUser,
        impersonationToken: "mock-impersonation-token",
      };
    }),
});