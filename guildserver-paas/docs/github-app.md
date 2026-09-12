# GitHub App: repository access that outlives one person's login

A user's OAuth token is tied to that user. When they revoke GuildServer's
access, lose their seat, or GitHub expires the token, every application they
connected stops deploying — the clone fails and, because a dead token in the
clone URL also breaks anonymous access, even public repositories fail.

A GitHub App's installation token belongs to the installation instead. It is
minted on demand, lasts an hour, and keeps working no matter who connected the
repository.

## What GuildServer does with it

When `GITHUB_APP_ID` and `GITHUB_APP_PRIVATE_KEY` are set, a deploy of a GitHub
repository:

1. signs a short-lived JWT with the App's private key (RS256), authenticating
   as the App rather than as any user;
2. asks GitHub which installation covers `owner/repo`;
3. exchanges that for an installation token, cached until shortly before it
   expires;
4. clones with that token.

If the App is not configured, is not installed on that repository, or GitHub
refuses, the deploy falls back to the connecting user's OAuth token — the
behaviour you have today. A misconfigured App cannot make deploys worse.

## Setting one up

1. **Create the App** — GitHub → Settings → Developer settings → GitHub Apps →
   New GitHub App. Repository permission **Contents: Read-only** is enough to
   clone; add **Metadata: Read-only** (GitHub adds it automatically).
2. **Generate a private key** and download the `.pem`.
3. **Install the App** on the account or organisation that owns the
   repositories you deploy, choosing all repositories or a specific list.
4. **Configure GuildServer** with the App's numeric ID and the key:

   ```bash
   GITHUB_APP_ID="123456"
   GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\nMIIEow...\n-----END RSA PRIVATE KEY-----"
   ```

   A key pasted with escaped `\n` newlines is handled; so is a real multi-line
   value. Keep it out of version control — on this deployment it belongs in
   `.env.production`, which is untracked and mode 600.
5. **Restart the API** so it picks the variables up. The next deploy of an
   installed repository logs `Using authenticated clone (GitHub App
   installation token)`.

## What this does not change

Signing in with GitHub, and the "Connect GitHub" flow in settings, still use
the OAuth app (`GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`). The App only
supplies credentials for cloning during a deploy.
