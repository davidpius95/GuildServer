import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "../trpc/trpc";
import { oauthAccounts } from "@guildserver/database";
import { eq, and } from "drizzle-orm";
import { listGithubRepos, listGithubBranches, listGitlabRepos, listGitlabBranches, listBitbucketRepos, listBitbucketBranches } from "../services/git-provider";
import { getValidAccessToken, isAuthFailure } from "../services/oauth-tokens";

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

      // Refreshes transparently when the stored token has expired, instead of
      // failing with the provider's raw 401 and forcing a manual reconnect.
      let token: string;
      try {
        token = await getValidAccessToken(ctx.user.id, provider);
      } catch {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Your ${provider} connection has expired. Reconnect to continue.`,
        });
      }

      try {
        if (provider === "gitlab") return await listGitlabRepos(token);
        if (provider === "bitbucket") return await listBitbucketRepos(token);
        return await listGithubRepos(token);
      } catch (error: any) {
        // A 401 here means the grant was revoked provider-side, which no
        // refresh can fix — tell the user to reconnect rather than dumping the
        // provider's raw JSON error into the UI.
        if (isAuthFailure(error)) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: `Your ${provider} connection is no longer valid. Reconnect to continue.`,
          });
        }
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Could not load ${provider} repositories. Please try again.`,
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

      let token: string;
      try {
        token = await getValidAccessToken(ctx.user.id, provider);
      } catch {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Your ${provider} connection has expired. Reconnect to continue.`,
        });
      }

      try {
        if (provider === "gitlab") return await listGitlabBranches(token, input.owner, input.repo);
        if (provider === "bitbucket") return await listBitbucketBranches(token, input.owner, input.repo);
        return await listGithubBranches(token, input.owner, input.repo);
      } catch (error: any) {
        if (isAuthFailure(error)) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: `Your ${provider} connection is no longer valid. Reconnect to continue.`,
          });
        }
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Could not load branches. Please try again.",
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
