import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "../trpc/trpc";
import { oauthAccounts } from "@guildserver/database";
import { eq, and } from "drizzle-orm";
import { listGithubRepos, listGithubBranches, listGitlabRepos, listGitlabBranches, listBitbucketRepos, listBitbucketBranches } from "../services/git-provider";

export const githubRouter = createTRPCRouter({
  // Check if the current user has GitHub/GitLab/Bitbucket connected
  getConnectionStatus: protectedProcedure
    .input(z.object({ provider: z.enum(["github", "gitlab", "bitbucket"]).optional() }).optional())
    .query(async ({ ctx, input }) => {
      const provider = input?.provider || "github";
      const account = await ctx.db.query.oauthAccounts.findFirst({
        where: and(
          eq(oauthAccounts.userId, ctx.user.id),
          eq(oauthAccounts.provider, provider)
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

  // List user's repositories (uses stored access token)
  listRepos: protectedProcedure
    .input(z.object({ provider: z.enum(["github", "gitlab", "bitbucket"]).optional() }).optional())
    .query(async ({ ctx, input }) => {
      const provider = input?.provider || "github";
      const account = await ctx.db.query.oauthAccounts.findFirst({
        where: and(
          eq(oauthAccounts.userId, ctx.user.id),
          eq(oauthAccounts.provider, provider)
        ),
      });

      if (!account?.accessToken) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `${provider} account not connected.`,
        });
      }

      try {
        if (provider === "gitlab") return await listGitlabRepos(account.accessToken);
        if (provider === "bitbucket") return await listBitbucketRepos(account.accessToken);
        return await listGithubRepos(account.accessToken);
      } catch (error: any) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to fetch ${provider} repos: ${error.message}`,
        });
      }
    }),

  // List branches for a specific repository
  listBranches: protectedProcedure
    .input(z.object({ 
      owner: z.string(), 
      repo: z.string(),
      provider: z.enum(["github", "gitlab", "bitbucket"]).optional()
    }))
    .query(async ({ ctx, input }) => {
      const provider = input.provider || "github";
      const account = await ctx.db.query.oauthAccounts.findFirst({
        where: and(
          eq(oauthAccounts.userId, ctx.user.id),
          eq(oauthAccounts.provider, provider)
        ),
      });

      if (!account?.accessToken) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `${provider} account not connected.`,
        });
      }

      try {
        if (provider === "gitlab") return await listGitlabBranches(account.accessToken, input.owner, input.repo);
        if (provider === "bitbucket") return await listBitbucketBranches(account.accessToken, input.owner, input.repo);
        return await listGithubBranches(account.accessToken, input.owner, input.repo);
      } catch (error: any) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to fetch branches: ${error.message}`,
        });
      }
    }),

  // Disconnect OAuth account
  disconnect: protectedProcedure
    .input(z.object({ provider: z.enum(["github", "gitlab", "bitbucket", "google"]) }))
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
