import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "../trpc/trpc";
import { oauthAccounts } from "@guildserver/database";
import { eq, and } from "drizzle-orm";
import { listGithubRepos, listGithubBranches } from "../services/git-provider";

export const githubRouter = createTRPCRouter({
  // Check if the current user has GitHub connected and what scope
  getConnectionStatus: protectedProcedure.query(async ({ ctx }) => {
    const account = await ctx.db.query.oauthAccounts.findFirst({
      where: and(
        eq(oauthAccounts.userId, ctx.user.id),
        eq(oauthAccounts.provider, "github")
      ),
      columns: {
        id: true,
        scope: true,
        createdAt: true,
      },
    });

    return {
      connected: !!account,
      hasRepoScope: account?.scope?.includes("repo") ?? false,
      scope: account?.scope ?? null,
      connectedAt: account?.createdAt ?? null,
    };
  }),

  // List all connected OAuth accounts for the current user
  getConnectedAccounts: protectedProcedure.query(async ({ ctx }) => {
    const accounts = await ctx.db.query.oauthAccounts.findMany({
      where: eq(oauthAccounts.userId, ctx.user.id),
      columns: {
        id: true,
        provider: true,
        scope: true,
        createdAt: true,
      },
    });
    return accounts;
  }),

  // List user's GitHub repositories (uses stored access token)
  listRepos: protectedProcedure.query(async ({ ctx }) => {
    const account = await ctx.db.query.oauthAccounts.findFirst({
      where: and(
        eq(oauthAccounts.userId, ctx.user.id),
        eq(oauthAccounts.provider, "github")
      ),
    });

    if (!account?.accessToken) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "GitHub account not connected. Connect GitHub in Settings → Connected Accounts.",
      });
    }

    try {
      return await listGithubRepos(account.accessToken);
    } catch (error: any) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: `Failed to fetch GitHub repos: ${error.message}`,
      });
    }
  }),

  // List branches for a specific GitHub repository
  listBranches: protectedProcedure
    .input(z.object({ owner: z.string(), repo: z.string() }))
    .query(async ({ ctx, input }) => {
      const account = await ctx.db.query.oauthAccounts.findFirst({
        where: and(
          eq(oauthAccounts.userId, ctx.user.id),
          eq(oauthAccounts.provider, "github")
        ),
      });

      if (!account?.accessToken) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "GitHub account not connected.",
        });
      }

      try {
        return await listGithubBranches(account.accessToken, input.owner, input.repo);
      } catch (error: any) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to fetch branches: ${error.message}`,
        });
      }
    }),

  // Disconnect GitHub account
  disconnect: protectedProcedure
    .input(z.object({ provider: z.enum(["github", "google"]) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(oauthAccounts)
        .where(
          and(
            eq(oauthAccounts.userId, ctx.user.id),
            eq(oauthAccounts.provider, input.provider)
          )
        );
      return { success: true };
    }),
});
