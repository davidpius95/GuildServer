import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "../trpc/trpc";
import {
  applications,
  members,
  environmentVariables,
} from "@guildserver/database";
import { eq, and } from "drizzle-orm";
import crypto from "crypto";

// Simple encryption for secret values
const ENCRYPTION_KEY =
  process.env.ENV_ENCRYPTION_KEY || "dev-encryption-key-32-chars-long!";

function encrypt(text: string): string {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(
    "aes-256-cbc",
    Buffer.from(ENCRYPTION_KEY.padEnd(32).slice(0, 32)),
    iv
  );
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  return iv.toString("hex") + ":" + encrypted;
}

function decrypt(text: string): string {
  try {
    const [ivHex, encrypted] = text.split(":");
    if (!ivHex || !encrypted) return text;
    const iv = Buffer.from(ivHex, "hex");
    const decipher = crypto.createDecipheriv(
      "aes-256-cbc",
      Buffer.from(ENCRYPTION_KEY.padEnd(32).slice(0, 32)),
      iv
    );
    let decrypted = decipher.update(encrypted, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch {
    return text; // Return as-is if decryption fails
  }
}

// Helper to check app access
async function checkAppAccess(ctx: any, applicationId: string) {
  const app = await ctx.db.query.applications.findFirst({
    where: eq(applications.id, applicationId),
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

  if (!app || app.project.organization.members.length === 0) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Application not found or access denied",
    });
  }

  return app;
}

export const environmentRouter = createTRPCRouter({
  // List all environment variables for an application
  list: protectedProcedure
    .input(
      z.object({
        applicationId: z.string().uuid(),
        scope: z.enum(["production", "preview", "development"]).optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      await checkAppAccess(ctx, input.applicationId);

      const conditions = [
        eq(environmentVariables.applicationId, input.applicationId),
      ];
      if (input.scope) {
        conditions.push(eq(environmentVariables.scope, input.scope));
      }

      const vars = await ctx.db.query.environmentVariables.findMany({
        where: and(...conditions),
      });

      // Mask secret values (only show first 4 chars)
      return vars.map((v) => ({
        ...v,
        value: v.isSecret
          ? decrypt(v.value).slice(0, 4) + "••••••••"
          : v.value,
        rawValue: undefined, // Never expose raw encrypted values
      }));
    }),

  // Get the actual value of a specific env var (for deployment injection)
  getDecrypted: protectedProcedure
    .input(
      z.object({
        applicationId: z.string().uuid(),
        scope: z.enum(["production", "preview", "development"]).optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      await checkAppAccess(ctx, input.applicationId);

      const conditions = [
        eq(environmentVariables.applicationId, input.applicationId),
      ];
      if (input.scope) {
        conditions.push(eq(environmentVariables.scope, input.scope));
      }

      const vars = await ctx.db.query.environmentVariables.findMany({
        where: and(...conditions),
      });

      // Return decrypted values as key-value pairs
      const result: Record<string, string> = {};
      for (const v of vars) {
        result[v.key] = v.isSecret ? decrypt(v.value) : v.value;
      }
      return result;
    }),

  // Set (create or update) an environment variable
  set: protectedProcedure
    .input(
      z.object({
        applicationId: z.string().uuid(),
        key: z.string().min(1).max(255),
        value: z.string(),
        scope: z
          .enum(["production", "preview", "development"])
          .default("production"),
        isSecret: z.boolean().default(false),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await checkAppAccess(ctx, input.applicationId);

      const storedValue = input.isSecret ? encrypt(input.value) : input.value;

      // Check if the variable already exists for this app+key+scope
      const existing = await ctx.db.query.environmentVariables.findFirst({
        where: and(
          eq(environmentVariables.applicationId, input.applicationId),
          eq(environmentVariables.key, input.key),
          eq(environmentVariables.scope, input.scope)
        ),
      });

      if (existing) {
        // Update existing
        const [updated] = await ctx.db
          .update(environmentVariables)
          .set({
            value: storedValue,
            isSecret: input.isSecret,
            updatedAt: new Date(),
          })
          .where(eq(environmentVariables.id, existing.id))
          .returning();
        return { ...updated, value: input.isSecret ? "••••••••" : input.value };
      }

      // Create new
      const [created] = await ctx.db
        .insert(environmentVariables)
        .values({
          applicationId: input.applicationId,
          key: input.key,
          value: storedValue,
          scope: input.scope,
          isSecret: input.isSecret,
        })
        .returning();

      return { ...created, value: input.isSecret ? "••••••••" : input.value };
    }),

  // Bulk set environment variables (for .env file import)
  bulkSet: protectedProcedure
    .input(
      z.object({
        applicationId: z.string().uuid(),
        variables: z.array(
          z.object({
            key: z.string().min(1).max(255),
            value: z.string(),
            isSecret: z.boolean().default(false),
          })
        ),
        scope: z
          .enum(["production", "preview", "development"])
          .default("production"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await checkAppAccess(ctx, input.applicationId);

      const results = [];

      for (const variable of input.variables) {
        const storedValue = variable.isSecret
          ? encrypt(variable.value)
          : variable.value;

        // Upsert logic
        const existing = await ctx.db.query.environmentVariables.findFirst({
          where: and(
            eq(environmentVariables.applicationId, input.applicationId),
            eq(environmentVariables.key, variable.key),
            eq(environmentVariables.scope, input.scope)
          ),
        });

        if (existing) {
          const [updated] = await ctx.db
            .update(environmentVariables)
            .set({
              value: storedValue,
              isSecret: variable.isSecret,
              updatedAt: new Date(),
            })
            .where(eq(environmentVariables.id, existing.id))
            .returning();
          results.push(updated);
        } else {
          const [created] = await ctx.db
            .insert(environmentVariables)
            .values({
              applicationId: input.applicationId,
              key: variable.key,
              value: storedValue,
              scope: input.scope,
              isSecret: variable.isSecret,
            })
            .returning();
          results.push(created);
        }
      }

      return { count: results.length };
    }),

  // Delete an environment variable
  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid(), applicationId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await checkAppAccess(ctx, input.applicationId);

      const envVar = await ctx.db.query.environmentVariables.findFirst({
        where: and(
          eq(environmentVariables.id, input.id),
          eq(environmentVariables.applicationId, input.applicationId)
        ),
      });

      if (!envVar) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Environment variable not found",
        });
      }

      await ctx.db
        .delete(environmentVariables)
        .where(eq(environmentVariables.id, input.id));

      return { success: true };
    }),

  // Delete all environment variables for a scope
  deleteAll: protectedProcedure
    .input(
      z.object({
        applicationId: z.string().uuid(),
        scope: z.enum(["production", "preview", "development"]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await checkAppAccess(ctx, input.applicationId);

      await ctx.db
        .delete(environmentVariables)
        .where(
          and(
            eq(environmentVariables.applicationId, input.applicationId),
            eq(environmentVariables.scope, input.scope)
          )
        );

      return { success: true };
    }),
});
