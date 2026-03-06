import { Router, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { eq, and } from "drizzle-orm";
import { db, users, oauthAccounts, organizations, members, projects, plans, subscriptions } from "@guildserver/database";
import { logger } from "../utils/logger";
import crypto from "crypto";

export const oauthRouter = Router();

const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";
const API_URL = process.env.API_URL || `http://localhost:${process.env.PORT || 4000}`;

// ---------- Cookie helpers (no cookie-parser dependency) ----------

function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!cookieHeader) return cookies;
  cookieHeader.split(";").forEach((pair) => {
    const [key, ...vals] = pair.trim().split("=");
    if (key) cookies[key.trim()] = decodeURIComponent(vals.join("="));
  });
  return cookies;
}

function setStateCookie(res: Response, state: string) {
  const secure = process.env.NODE_ENV === "production";
  res.setHeader(
    "Set-Cookie",
    `oauth_state=${state}; HttpOnly; Path=/; Max-Age=600; SameSite=Lax${secure ? "; Secure" : ""}`
  );
}

function clearStateCookie(res: Response) {
  res.setHeader(
    "Set-Cookie",
    `oauth_state=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`
  );
}

// ---------- GitHub OAuth ----------

oauthRouter.get("/github", (req: Request, res: Response) => {
  const clientId = process.env.GITHUB_CLIENT_ID;
  if (!clientId) {
    return res.status(500).json({ error: "GitHub OAuth not configured. Set GITHUB_CLIENT_ID env var." });
  }

  // If scope=repo is requested, include repo access (for GitHub integration)
  const scopes = req.query.scope === "repo" ? "user:email,repo" : "user:email";

  const state = crypto.randomBytes(32).toString("hex");
  setStateCookie(res, state);

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: `${API_URL}/auth/github/callback`,
    scope: scopes,
    state,
  });

  res.redirect(`https://github.com/login/oauth/authorize?${params}`);
});

oauthRouter.get("/github/callback", async (req: Request, res: Response) => {
  try {
    const { code, state } = req.query;
    const cookies = parseCookies(req.headers.cookie);

    // Verify state for CSRF protection
    if (!state || state !== cookies.oauth_state) {
      logger.warn("GitHub OAuth: state mismatch");
      return res.redirect(`${FRONTEND_URL}/auth/login?error=invalid_state`);
    }
    clearStateCookie(res);

    if (!code) {
      return res.redirect(`${FRONTEND_URL}/auth/login?error=no_code`);
    }

    // Exchange code for access token
    const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        client_id: process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        code,
      }),
    });

    const tokenData = (await tokenResponse.json()) as any;
    if (tokenData.error) {
      logger.error("GitHub token exchange failed", { error: tokenData.error });
      return res.redirect(`${FRONTEND_URL}/auth/login?error=token_exchange_failed`);
    }

    const { access_token, scope } = tokenData;

    // Fetch GitHub user profile
    const userResponse = await fetch("https://api.github.com/user", {
      headers: { Authorization: `token ${access_token}`, Accept: "application/vnd.github.v3+json" },
    });
    const githubUser = (await userResponse.json()) as any;

    // Fetch primary verified email if not public
    let email = githubUser.email;
    if (!email) {
      const emailsResponse = await fetch("https://api.github.com/user/emails", {
        headers: { Authorization: `token ${access_token}`, Accept: "application/vnd.github.v3+json" },
      });
      const emails = (await emailsResponse.json()) as any[];
      const primary = emails.find((e: any) => e.primary && e.verified);
      email = primary?.email || emails.find((e: any) => e.verified)?.email;
    }

    if (!email) {
      return res.redirect(`${FRONTEND_URL}/auth/login?error=no_email`);
    }

    // Find or create user
    const result = await findOrCreateOAuthUser({
      provider: "github",
      providerAccountId: String(githubUser.id),
      email,
      name: githubUser.name || githubUser.login,
      avatar: githubUser.avatar_url,
      accessToken: access_token,
      scope,
    });

    // Generate JWT
    const jwtToken = jwt.sign(
      { userId: result.user.id, email: result.user.email },
      process.env.JWT_SECRET!,
      { expiresIn: process.env.JWT_EXPIRES_IN || "7d" }
    );

    // Update last login
    await db.update(users).set({ lastLogin: new Date() }).where(eq(users.id, result.user.id));

    logger.info(`GitHub OAuth: ${result.isNew ? "new user" : "existing user"} ${email}`);
    res.redirect(`${FRONTEND_URL}/auth/callback?token=${jwtToken}`);
  } catch (error: any) {
    logger.error("GitHub OAuth callback error", { error: error.message, stack: error.stack });
    res.redirect(`${FRONTEND_URL}/auth/login?error=oauth_failed`);
  }
});

// ---------- Google OAuth ----------

oauthRouter.get("/google", (req: Request, res: Response) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    return res.status(500).json({ error: "Google OAuth not configured. Set GOOGLE_CLIENT_ID env var." });
  }

  const state = crypto.randomBytes(32).toString("hex");
  setStateCookie(res, state);

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: `${API_URL}/auth/google/callback`,
    response_type: "code",
    scope: "openid email profile",
    state,
    access_type: "offline",
    prompt: "consent",
  });

  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

oauthRouter.get("/google/callback", async (req: Request, res: Response) => {
  try {
    const { code, state } = req.query;
    const cookies = parseCookies(req.headers.cookie);

    if (!state || state !== cookies.oauth_state) {
      logger.warn("Google OAuth: state mismatch");
      return res.redirect(`${FRONTEND_URL}/auth/login?error=invalid_state`);
    }
    clearStateCookie(res);

    if (!code) {
      return res.redirect(`${FRONTEND_URL}/auth/login?error=no_code`);
    }

    // Exchange code for tokens
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        code,
        redirect_uri: `${API_URL}/auth/google/callback`,
        grant_type: "authorization_code",
      }),
    });

    const tokenData = (await tokenResponse.json()) as any;
    if (tokenData.error) {
      logger.error("Google token exchange failed", { error: tokenData.error });
      return res.redirect(`${FRONTEND_URL}/auth/login?error=token_exchange_failed`);
    }

    // Decode the ID token to get user info (base64url-encoded JWT payload)
    const idTokenParts = tokenData.id_token.split(".");
    const payload = JSON.parse(Buffer.from(idTokenParts[1], "base64url").toString());
    const { sub, email, name, picture } = payload;

    if (!email) {
      return res.redirect(`${FRONTEND_URL}/auth/login?error=no_email`);
    }

    const result = await findOrCreateOAuthUser({
      provider: "google",
      providerAccountId: sub,
      email,
      name: name || email.split("@")[0],
      avatar: picture,
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      tokenExpiresAt: tokenData.expires_in
        ? new Date(Date.now() + tokenData.expires_in * 1000)
        : undefined,
      scope: "openid email profile",
    });

    const jwtToken = jwt.sign(
      { userId: result.user.id, email: result.user.email },
      process.env.JWT_SECRET!,
      { expiresIn: process.env.JWT_EXPIRES_IN || "7d" }
    );

    await db.update(users).set({ lastLogin: new Date() }).where(eq(users.id, result.user.id));

    logger.info(`Google OAuth: ${result.isNew ? "new user" : "existing user"} ${email}`);
    res.redirect(`${FRONTEND_URL}/auth/callback?token=${jwtToken}`);
  } catch (error: any) {
    logger.error("Google OAuth callback error", { error: error.message, stack: error.stack });
    res.redirect(`${FRONTEND_URL}/auth/login?error=oauth_failed`);
  }
});

// ---------- Shared helper: find or create user from OAuth data ----------

async function findOrCreateOAuthUser(params: {
  provider: string;
  providerAccountId: string;
  email: string;
  name: string;
  avatar?: string;
  accessToken: string;
  refreshToken?: string;
  tokenExpiresAt?: Date;
  scope?: string;
}): Promise<{ user: any; isNew: boolean }> {
  // 1. Check if this OAuth account already exists (returning user)
  const existingAccount = await db.query.oauthAccounts.findFirst({
    where: and(
      eq(oauthAccounts.provider, params.provider),
      eq(oauthAccounts.providerAccountId, params.providerAccountId)
    ),
    with: { user: true },
  });

  if (existingAccount) {
    // Update access token (may have been refreshed)
    await db
      .update(oauthAccounts)
      .set({
        accessToken: params.accessToken,
        refreshToken: params.refreshToken || existingAccount.refreshToken,
        tokenExpiresAt: params.tokenExpiresAt,
        scope: params.scope,
        updatedAt: new Date(),
      })
      .where(eq(oauthAccounts.id, existingAccount.id));

    return { user: existingAccount.user, isNew: false };
  }

  // 2. Check if a user with this email exists (link accounts)
  const existingUser = await db.query.users.findFirst({
    where: eq(users.email, params.email),
  });

  if (existingUser) {
    // Link new OAuth account to existing user
    await db.insert(oauthAccounts).values({
      userId: existingUser.id,
      provider: params.provider,
      providerAccountId: params.providerAccountId,
      accessToken: params.accessToken,
      refreshToken: params.refreshToken,
      tokenExpiresAt: params.tokenExpiresAt,
      scope: params.scope,
    });

    // Update avatar if user doesn't have one
    if (!existingUser.avatar && params.avatar) {
      await db.update(users).set({ avatar: params.avatar }).where(eq(users.id, existingUser.id));
    }

    return { user: existingUser, isNew: false };
  }

  // 3. Create brand new user + OAuth account + default organization
  const [newUser] = await db
    .insert(users)
    .values({
      email: params.email,
      name: params.name,
      avatar: params.avatar,
      password: null, // OAuth-only user, no password
      role: "user",
      emailVerified: new Date(), // Provider verified the email
    })
    .returning();

  await db.insert(oauthAccounts).values({
    userId: newUser.id,
    provider: params.provider,
    providerAccountId: params.providerAccountId,
    accessToken: params.accessToken,
    refreshToken: params.refreshToken,
    tokenExpiresAt: params.tokenExpiresAt,
    scope: params.scope,
  });

  // Create a default organization for the new user (like Vercel's personal team)
  const orgName = `${params.name}'s Team`;
  const orgSlug = params.email
    .split("@")[0]
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-");

  const [newOrg] = await db
    .insert(organizations)
    .values({
      name: orgName,
      slug: orgSlug,
      ownerId: newUser.id,
    })
    .returning();

  await db.insert(members).values({
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
  await db.insert(projects).values({
    name: "Default Project",
    organizationId: newOrg.id,
  });

  // Auto-assign Hobby (free) plan to the new organization
  const hobbyPlan = await db.query.plans.findFirst({
    where: eq(plans.slug, "hobby"),
  });

  if (hobbyPlan) {
    const now = new Date();
    const periodEnd = new Date(now);
    periodEnd.setMonth(periodEnd.getMonth() + 1);

    await db.insert(subscriptions).values({
      organizationId: newOrg.id,
      planId: hobbyPlan.id,
      status: "active",
      currentPeriodStart: now,
      currentPeriodEnd: periodEnd,
      seats: 1,
    });
    logger.info(`Assigned Hobby plan to organization '${orgName}'`);
  }

  logger.info(`Created default organization '${orgName}' with default project for new OAuth user ${params.email}`);

  return { user: newUser, isNew: true };
}
