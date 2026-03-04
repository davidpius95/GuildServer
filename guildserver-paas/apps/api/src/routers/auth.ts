import { z } from "zod";
import { TRPCError } from "@trpc/server";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { createTRPCRouter, publicProcedure, protectedProcedure } from "../trpc/trpc";
import { users, organizations, members, projects, plans, subscriptions } from "@guildserver/database";
import { eq } from "drizzle-orm";
import { logger } from "../utils/logger";

const registerSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  password: z.string().min(8),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});

export const authRouter = createTRPCRouter({
  register: publicProcedure
    .input(registerSchema)
    .mutation(async ({ ctx, input }) => {
      const { email, name, password } = input;

      // Check if user already exists
      const existingUser = await ctx.db.query.users.findFirst({
        where: eq(users.email, email),
      });

      if (existingUser) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "User with this email already exists",
        });
      }

      // Hash password
      const hashedPassword = await bcrypt.hash(password, 12);

      // Create user
      const [newUser] = await ctx.db
        .insert(users)
        .values({
          email,
          name,
          password: hashedPassword,
          role: "user",
          emailVerified: new Date(), // Auto-verify for demo
        })
        .returning({
          id: users.id,
          email: users.email,
          name: users.name,
          role: users.role,
          createdAt: users.createdAt,
        });

      // Create a default organization for the new user (like Vercel's personal team)
      const orgName = `${name}'s Team`;
      const orgSlug = email
        .split("@")[0]
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, "-")
        .replace(/-+/g, "-");

      const [newOrg] = await ctx.db
        .insert(organizations)
        .values({
          name: orgName,
          slug: orgSlug,
          ownerId: newUser.id,
        })
        .returning();

      await ctx.db.insert(members).values({
        userId: newUser.id,
        organizationId: newOrg.id,
        role: "owner",
        permissions: {
          admin: true,
          projects: ["create", "read", "update", "delete"],
          applications: ["create", "read", "update", "delete", "deploy"],
          databases: ["create", "read", "update", "delete"],
          workflows: ["create", "read", "update", "delete", "execute"],
          kubernetes: ["create", "read", "update", "delete"],
        },
      });

      // Create a default project within the organization
      await ctx.db.insert(projects).values({
        name: "Default Project",
        organizationId: newOrg.id,
      });

      // Auto-assign Hobby (free) plan to the new organization
      const hobbyPlan = await ctx.db.query.plans.findFirst({
        where: eq(plans.slug, "hobby"),
      });

      if (hobbyPlan) {
        const now = new Date();
        const periodEnd = new Date(now);
        periodEnd.setMonth(periodEnd.getMonth() + 1);

        await ctx.db.insert(subscriptions).values({
          organizationId: newOrg.id,
          planId: hobbyPlan.id,
          status: "active",
          currentPeriodStart: now,
          currentPeriodEnd: periodEnd,
          seats: 1,
        });
      }

      logger.info(`Created default organization '${orgName}' with Hobby plan for new user ${email}`);

      // Generate JWT token
      const token = jwt.sign(
        { userId: newUser.id, email: newUser.email },
        process.env.JWT_SECRET!,
        { expiresIn: process.env.JWT_EXPIRES_IN || "7d" }
      );

      return {
        user: newUser,
        token,
      };
    }),

  login: publicProcedure
    .input(loginSchema)
    .mutation(async ({ ctx, input }) => {
      const { email, password } = input;

      // Find user
      const user = await ctx.db.query.users.findFirst({
        where: eq(users.email, email),
      });

      if (!user || !user.password) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Invalid email or password",
        });
      }

      // Verify password
      const isValidPassword = await bcrypt.compare(password, user.password);

      if (!isValidPassword) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Invalid email or password",
        });
      }

      // Update last login
      await ctx.db
        .update(users)
        .set({ lastLogin: new Date() })
        .where(eq(users.id, user.id));

      // Generate JWT token
      const token = jwt.sign(
        { userId: user.id, email: user.email },
        process.env.JWT_SECRET!,
        { expiresIn: process.env.JWT_EXPIRES_IN || "7d" }
      );

      return {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          createdAt: user.createdAt,
          lastLogin: user.lastLogin,
        },
        token,
      };
    }),

  me: protectedProcedure.query(async ({ ctx }) => {
    const user = await ctx.db.query.users.findFirst({
      where: eq(users.id, ctx.user.id),
      columns: {
        id: true,
        email: true,
        name: true,
        role: true,
        avatar: true,
        twoFactorEnabled: true,
        lastLogin: true,
        preferences: true,
        createdAt: true,
        updatedAt: true,
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

  updateProfile: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).optional(),
        avatar: z.string().url().optional(),
        preferences: z.record(z.any()).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [updatedUser] = await ctx.db
        .update(users)
        .set({
          ...input,
          updatedAt: new Date(),
        })
        .where(eq(users.id, ctx.user.id))
        .returning({
          id: users.id,
          email: users.email,
          name: users.name,
          avatar: users.avatar,
          preferences: users.preferences,
          updatedAt: users.updatedAt,
        });

      return updatedUser;
    }),

  changePassword: protectedProcedure
    .input(changePasswordSchema)
    .mutation(async ({ ctx, input }) => {
      const { currentPassword, newPassword } = input;

      // Get current user with password
      const user = await ctx.db.query.users.findFirst({
        where: eq(users.id, ctx.user.id),
      });

      if (!user || !user.password) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "User not found",
        });
      }

      // Verify current password
      const isValidPassword = await bcrypt.compare(currentPassword, user.password);

      if (!isValidPassword) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Current password is incorrect",
        });
      }

      // Hash new password
      const hashedNewPassword = await bcrypt.hash(newPassword, 12);

      // Update password
      await ctx.db
        .update(users)
        .set({
          password: hashedNewPassword,
          updatedAt: new Date(),
        })
        .where(eq(users.id, ctx.user.id));

      return { success: true };
    }),

  logout: protectedProcedure.mutation(async ({ ctx }) => {
    // In a real application, you might want to invalidate the token
    // For now, we'll just return success
    return { success: true };
  }),
});