import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "../trpc/trpc";
import { oauthAccounts } from "@guildserver/database";
import { eq, and } from "drizzle-orm";
import { listGithubRepos, listGithubBranches, listGitlabRepos, listGitlabBranches, listBitbucketRepos, listBitbucketBranches } from "../services/git-provider";
import { getValidAccessToken, isAuthFailure } from "../services/oauth-tokens";
import { checkConnectionHealth } from "../services/git-connection-health";
import crypto from "crypto";
import { createLinkToken, LINK_TOKEN_TTL_SECONDS, rememberInstallState } from "../services/oauth-link";
import { installationUrl, installationsForOrganization } from "../services/github-installations";
import { requireOrganizationMember } from "../trpc/org-access";

export const githubRouter = createTRPCRouter({
  // Check if the current user has GitHub/GitLab/Bitbucket connected
  getConnectionStatus: protectedProcedure
    .input(
      z
        .object({
          provider: z.enum(["github", "gitlab", "bitbucket"]).optional(),
          organizationId: z.string().uuid().optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const provider = input?.provider || "github";
      if (input?.organizationId) await requireOrganizationMember(ctx, input.organizationId);
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

    // A stored row only proves the user connected once; ask the provider
    // whether it still accepts the token, so the UI can prompt a reconnect.
    const health = account ? await checkConnectionHealth(ctx.user.id, provider) : null;

    // Installation state is per organization, not per user: it is what lets a
    // deploy outlive the person who connected the repository.
    const installations = input?.organizationId
      ? await installationsForOrganization(input.organizationId)
      : [];

    return {
      connected: !!account,
      health,
      needsReconnect: health === "reconnect_required",
      appConfigured: !!installationUrl(),
      installations: installations.map((row) => ({
        accountLogin: row.accountLogin,
        repositorySelection: row.repositorySelection,
        suspended: !!row.suspendedAt,
      })),
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
  /**
   * Begin linking GitHub to the signed-in user.
   *
   * Returns a short-lived, single-use token the browser POSTs to
   * /auth/github/link. Sign-in's email matching cannot be used for this: the
   * GitHub App cannot read private emails, so it created duplicate accounts.
   */
  createLinkIntent: protectedProcedure.mutation(async ({ ctx }) => ({
    token: createLinkToken(ctx.user.id, "github"),
    expiresInSeconds: LINK_TOKEN_TTL_SECONDS,
  })),

  /**
   * Begin installing the GitHub App on the customer's own account.
   *
   * GitHub's post-install redirect carries no identity, so the nonce minted
   * here is what tells the callback who installed it and for which
   * organization. Only a member of that organization may start the install.
   */
  createInstallIntent: protectedProcedure
    .input(z.object({ organizationId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await requireOrganizationMember(ctx, input.organizationId);

      const base = installationUrl();
      if (!base) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "No GitHub App is configured on this server.",
        });
      }

      const nonce = crypto.randomBytes(32).toString("hex");
      if (!(await rememberInstallState(nonce, ctx.user.id, input.organizationId))) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Could not start the installation. Please try again.",
        });
      }

      return { url: `${base}?state=${nonce}` };
    }),

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
