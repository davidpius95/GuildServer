/**
 * Management of personal access tokens for the public REST API.
 *
 * Reachable only through /trpc, which authenticates dashboard JWTs and nothing
 * else (see trpc/context.ts). A PAT therefore cannot mint, list or revoke
 * tokens: holding one credential must never be enough to create another.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, desc, eq } from "drizzle-orm";
import { apiTokens, members } from "@guildserver/database";
import { createTRPCRouter, protectedProcedure } from "../trpc/trpc";
import {
  API_TOKEN_SCOPES,
  ApiTokenValidationError,
  createApiToken,
  revokeApiToken,
  toPublicApiToken,
} from "../services/api-tokens";

/** Scopes a plain `member` may grant. write/admin need an owner or admin. */
const MEMBER_GRANTABLE_SCOPES = new Set(["read", "deploy"]);

// Token management is for dashboard sessions only. Over HTTP, createContext
// authenticates JWTs alone, so a PAT never gets here; but the REST layer builds
// its own context (carrying apiToken) for appRouter.createCaller. Refusing that
// context means no REST handler can let one credential mint, list or revoke
// another.
const dashboardProcedure = protectedProcedure.use(({ ctx, next }) => {
  if ((ctx as { apiToken?: unknown }).apiToken) {
    throw new TRPCError({ code: "FORBIDDEN", message: "API tokens cannot manage API tokens" });
  }
  return next();
});

const dateInput = z
  .union([z.date(), z.string().datetime({ offset: true })])
  .transform((value) => (value instanceof Date ? value : new Date(value)));

async function membershipOf(ctx: any, organizationId: string) {
  return ctx.db.query.members.findFirst({
    where: and(eq(members.organizationId, organizationId), eq(members.userId, ctx.user.id)),
  });
}

export const apiTokenRouter = createTRPCRouter({
  create: dashboardProcedure
    .input(
      z.object({
        organizationId: z.string().uuid(),
        name: z.string().trim().min(1).max(255),
        scopes: z.array(z.enum(API_TOKEN_SCOPES)).min(1),
        projectIds: z.array(z.string().uuid()).min(1).nullable().optional(),
        expiresAt: dateInput.nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const member = await membershipOf(ctx, input.organizationId);
      if (!member) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You don't have access to this organization" });
      }

      // The service accepts a past expiry (such a token is dead on arrival);
      // a person asking for one has made a mistake, so say so.
      if (input.expiresAt && input.expiresAt.getTime() <= Date.now()) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "expiresAt must be in the future" });
      }

      if (member.role === "member") {
        const denied = input.scopes.filter((scope) => !MEMBER_GRANTABLE_SCOPES.has(scope));
        if (denied.length > 0) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: `Only an organization owner or admin can grant the ${denied
              .map((s) => `"${s}"`)
              .join(", ")} scope`,
          });
        }
      }

      try {
        const { token, record } = await createApiToken({
          organizationId: input.organizationId,
          userId: ctx.user.id,
          name: input.name,
          scopes: input.scopes,
          projectIds: input.projectIds ?? null,
          expiresAt: input.expiresAt ?? null,
        });
        // The plaintext leaves the server exactly once, here.
        return { token, ...toPublicApiToken(record) };
      } catch (error) {
        if (error instanceof ApiTokenValidationError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
        }
        throw error;
      }
    }),

  /**
   * Owners and admins see every token in the organization; a plain member sees
   * only the tokens they created. No response ever carries the hash.
   */
  list: dashboardProcedure
    .input(z.object({ organizationId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const member = await membershipOf(ctx, input.organizationId);
      if (!member) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You don't have access to this organization" });
      }

      const canSeeAll = member.role === "owner" || member.role === "admin";
      const rows = await ctx.db
        .select()
        .from(apiTokens)
        .where(
          canSeeAll
            ? eq(apiTokens.organizationId, input.organizationId)
            : and(eq(apiTokens.organizationId, input.organizationId), eq(apiTokens.userId, ctx.user.id)),
        )
        .orderBy(desc(apiTokens.createdAt));

      return rows.map(toPublicApiToken);
    }),

  /**
   * Allowed for an owner or admin of the token's organization, or the token's
   * creator (even after leaving the organization: revoking only removes access).
   */
  revoke: dashboardProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const token = await ctx.db.query.apiTokens.findFirst({ where: eq(apiTokens.id, input.id) });
      if (!token) {
        throw new TRPCError({ code: "NOT_FOUND", message: "API token not found" });
      }

      const isCreator = token.userId === ctx.user.id;
      if (!isCreator) {
        const member = await membershipOf(ctx, token.organizationId);
        if (!member) {
          // Outside the organization: do not confirm the token exists.
          throw new TRPCError({ code: "NOT_FOUND", message: "API token not found" });
        }
        if (member.role !== "owner" && member.role !== "admin") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Only an organization owner or admin, or the token's creator, can revoke this token",
          });
        }
      }

      await revokeApiToken(token.id);
      return { success: true, id: token.id };
    }),
});
