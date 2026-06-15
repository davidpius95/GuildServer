import { logger } from "../utils/logger";

/**
 * Registers a GitHub webhook for the given repository
 * @param repository The repository full name (e.g., "owner/repo")
 * @param accessToken The GitHub OAuth access token of the user
 * @param webhookUrl The URL of the platform's webhook endpoint
 * @param secret The secret used to sign the webhook payloads
 */
export async function registerGithubWebhook(
  repository: string,
  accessToken: string,
  webhookUrl: string,
  secret: string
): Promise<boolean> {
  try {
    // 1. Check if the webhook already exists
    const listResponse = await fetch(`https://api.github.com/repos/${repository}/hooks`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/vnd.github.v3+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });

    if (!listResponse.ok) {
      const errorText = await listResponse.text();
      logger.error(`Failed to fetch webhooks for ${repository}`, { error: errorText });
      return false;
    }

    const hooks = (await listResponse.json()) as any[];
    const hookExists = hooks.some((hook) => hook.config.url === webhookUrl);

    if (hookExists) {
      logger.info(`Webhook already exists for ${repository}`);
      return true;
    }

    // 2. Create the webhook
    const createResponse = await fetch(`https://api.github.com/repos/${repository}/hooks`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/vnd.github.v3+json",
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({
        name: "web",
        active: true,
        events: ["push"],
        config: {
          url: webhookUrl,
          content_type: "json",
          secret: secret,
          insecure_ssl: "0",
        },
      }),
    });

    if (!createResponse.ok) {
      const errorText = await createResponse.text();
      logger.error(`Failed to create webhook for ${repository}`, { error: errorText });
      return false;
    }

    logger.info(`Successfully created webhook for ${repository}`);
    return true;
  } catch (error: any) {
    logger.error(`Error registering GitHub webhook: ${error.message}`, { error });
    return false;
  }
}
