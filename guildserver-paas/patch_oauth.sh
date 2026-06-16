#!/bin/bash
cat << 'INNER_EOF' > oauth_append.ts

// ---------- GitLab OAuth ----------

oauthRouter.get("/gitlab", (req: Request, res: Response) => {
  const clientId = process.env.GITLAB_CLIENT_ID;
  if (!clientId) {
    return res.status(500).json({ error: "GitLab OAuth not configured. Set GITLAB_CLIENT_ID env var." });
  }

  const stateObj = {
    csrf: crypto.randomBytes(32).toString("hex"),
    returnTo: req.query.returnTo ? String(req.query.returnTo) : undefined,
  };
  const state = Buffer.from(JSON.stringify(stateObj)).toString("base64url");
  setStateCookie(res, state);

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: `${API_URL}/auth/gitlab/callback`,
    response_type: "code",
    state,
    scope: "read_api read_user read_repository",
  });

  res.redirect(`https://gitlab.com/oauth/authorize?${params}`);
});

oauthRouter.get("/gitlab/callback", async (req: Request, res: Response) => {
  try {
    const { code, state } = req.query;
    const cookies = parseCookies(req.headers.cookie);

    if (!state || state !== cookies.oauth_state) {
      logger.warn("GitLab OAuth: state mismatch");
      return res.redirect(`${FRONTEND_URL}/auth/login?error=invalid_state`);
    }
    clearStateCookie(res);

    if (!code) {
      return res.redirect(`${FRONTEND_URL}/auth/login?error=no_code`);
    }

    // Exchange code for tokens
    const tokenResponse = await fetch("https://gitlab.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: process.env.GITLAB_CLIENT_ID,
        client_secret: process.env.GITLAB_CLIENT_SECRET,
        code,
        grant_type: "authorization_code",
        redirect_uri: `${API_URL}/auth/gitlab/callback`,
      }),
    });

    const tokenData = (await tokenResponse.json()) as any;
    if (tokenData.error || !tokenData.access_token) {
      logger.error("GitLab token exchange failed", { error: tokenData.error || tokenData.error_description });
      return res.redirect(`${FRONTEND_URL}/auth/login?error=token_exchange_failed`);
    }

    // Get user info
    const userResponse = await fetch("https://gitlab.com/api/v4/user", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const userData = (await userResponse.json()) as any;

    if (!userData.email) {
      return res.redirect(`${FRONTEND_URL}/auth/login?error=no_email`);
    }

    const result = await findOrCreateOAuthUser({
      provider: "gitlab",
      providerAccountId: String(userData.id),
      email: userData.email,
      name: userData.name || userData.username || userData.email.split("@")[0],
      avatar: userData.avatar_url,
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      tokenExpiresAt: tokenData.expires_in
        ? new Date(Date.now() + tokenData.expires_in * 1000)
        : undefined,
      scope: tokenData.scope || "read_api read_user read_repository",
    });

    let returnTo = "";
    try {
      const stateObj = JSON.parse(Buffer.from(state as string, "base64url").toString());
      if (stateObj.returnTo) returnTo = stateObj.returnTo;
    } catch (e) {}

    const jwtToken = jwt.sign(
      { userId: result.user.id, email: result.user.email },
      process.env.JWT_SECRET!,
      { expiresIn: process.env.JWT_EXPIRES_IN || "7d" }
    );

    await db.update(users).set({ lastLogin: new Date() }).where(eq(users.id, result.user.id));

    logger.info(`GitLab OAuth: ${result.isNew ? "new user" : "existing user"} ${userData.email}`);
    const redirectUrl = returnTo
      ? `${FRONTEND_URL}/auth/callback?token=${jwtToken}&returnTo=${encodeURIComponent(returnTo)}`
      : `${FRONTEND_URL}/auth/callback?token=${jwtToken}`;
    res.redirect(redirectUrl);
  } catch (error: any) {
    logger.error("GitLab OAuth callback error", { error: error.message, stack: error.stack });
    res.redirect(`${FRONTEND_URL}/auth/login?error=oauth_failed`);
  }
});

// ---------- Bitbucket OAuth ----------

oauthRouter.get("/bitbucket", (req: Request, res: Response) => {
  const clientId = process.env.BITBUCKET_CLIENT_ID;
  if (!clientId) {
    return res.status(500).json({ error: "Bitbucket OAuth not configured. Set BITBUCKET_CLIENT_ID env var." });
  }

  const stateObj = {
    csrf: crypto.randomBytes(32).toString("hex"),
    returnTo: req.query.returnTo ? String(req.query.returnTo) : undefined,
  };
  const state = Buffer.from(JSON.stringify(stateObj)).toString("base64url");
  setStateCookie(res, state);

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    state,
  });

  res.redirect(`https://bitbucket.org/site/oauth2/authorize?${params}`);
});

oauthRouter.get("/bitbucket/callback", async (req: Request, res: Response) => {
  try {
    const { code, state } = req.query;
    const cookies = parseCookies(req.headers.cookie);

    if (!state || state !== cookies.oauth_state) {
      logger.warn("Bitbucket OAuth: state mismatch");
      return res.redirect(`${FRONTEND_URL}/auth/login?error=invalid_state`);
    }
    clearStateCookie(res);

    if (!code) {
      return res.redirect(`${FRONTEND_URL}/auth/login?error=no_code`);
    }

    const authHeader = Buffer.from(`${process.env.BITBUCKET_CLIENT_ID}:${process.env.BITBUCKET_CLIENT_SECRET}`).toString("base64");

    // Exchange code for tokens
    const tokenResponse = await fetch("https://bitbucket.org/site/oauth2/access_token", {
      method: "POST",
      headers: { 
        "Content-Type": "application/x-www-form-urlencoded",
        "Authorization": `Basic ${authHeader}`
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: code as string,
      }),
    });

    const tokenData = (await tokenResponse.json()) as any;
    if (tokenData.error || !tokenData.access_token) {
      logger.error("Bitbucket token exchange failed", { error: tokenData.error || tokenData.error_description });
      return res.redirect(`${FRONTEND_URL}/auth/login?error=token_exchange_failed`);
    }

    // Get user info
    const userResponse = await fetch("https://api.bitbucket.org/2.0/user", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const userData = (await userResponse.json()) as any;

    const emailResponse = await fetch("https://api.bitbucket.org/2.0/user/emails", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const emailData = (await emailResponse.json()) as any;
    const primaryEmail = emailData.values?.find((e: any) => e.is_primary)?.email || emailData.values?.[0]?.email;

    if (!primaryEmail) {
      return res.redirect(`${FRONTEND_URL}/auth/login?error=no_email`);
    }

    const result = await findOrCreateOAuthUser({
      provider: "bitbucket",
      providerAccountId: userData.account_id || userData.uuid,
      email: primaryEmail,
      name: userData.display_name || userData.username || primaryEmail.split("@")[0],
      avatar: userData.links?.avatar?.href,
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      tokenExpiresAt: tokenData.expires_in
        ? new Date(Date.now() + tokenData.expires_in * 1000)
        : undefined,
      scope: tokenData.scopes,
    });

    let returnTo = "";
    try {
      const stateObj = JSON.parse(Buffer.from(state as string, "base64url").toString());
      if (stateObj.returnTo) returnTo = stateObj.returnTo;
    } catch (e) {}

    const jwtToken = jwt.sign(
      { userId: result.user.id, email: result.user.email },
      process.env.JWT_SECRET!,
      { expiresIn: process.env.JWT_EXPIRES_IN || "7d" }
    );

    await db.update(users).set({ lastLogin: new Date() }).where(eq(users.id, result.user.id));

    logger.info(`Bitbucket OAuth: ${result.isNew ? "new user" : "existing user"} ${primaryEmail}`);
    const redirectUrl = returnTo
      ? `${FRONTEND_URL}/auth/callback?token=${jwtToken}&returnTo=${encodeURIComponent(returnTo)}`
      : `${FRONTEND_URL}/auth/callback?token=${jwtToken}`;
    res.redirect(redirectUrl);
  } catch (error: any) {
    logger.error("Bitbucket OAuth callback error", { error: error.message, stack: error.stack });
    res.redirect(`${FRONTEND_URL}/auth/login?error=oauth_failed`);
  }
});
INNER_EOF

# Insert right before the shared helper comment
sed -i.bak '/\/\/ ---------- Shared helper: find or create user from OAuth data ----------/e cat oauth_append.ts' apps/api/src/routes/oauth.ts

