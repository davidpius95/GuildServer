/**
 * Delivery to each kind of notification channel.
 *
 * Every provider validates its target before sending, never follows
 * redirects, times out, and reports failures with messages that contain no
 * credentials (webhook URLs and bot tokens are credentials). Whether a failure
 * is worth retrying is part of the error.
 */
import { createHmac } from "crypto";
import { UnsafeUrlError, assertSafeOutboundUrl, type Resolver } from "../../utils/outbound-url";
import type { Severity } from "./events";

export const CHANNEL_TYPES = ["email", "webhook", "discord", "slack", "telegram"] as const;
export type ChannelType = (typeof CHANNEL_TYPES)[number];

/** Stored encrypted. */
export interface ChannelSecret {
  url?: string;
  signingSecret?: string;
  botToken?: string;
}

/** Stored in the clear. */
export interface ChannelConfig {
  recipients?: string[];
  chatId?: string;
}

export interface OutgoingMessage {
  event: string;
  title: string;
  message: string;
  severity: Severity;
  url?: string;
  occurredAt: string;
  data?: Record<string, unknown>;
}

export interface Mailer {
  sendMail(options: { from: string; to: string[]; subject: string; text: string; html: string }): Promise<unknown>;
}

export interface ProviderDeps {
  fetch: typeof fetch;
  mailer: Mailer | null;
  env: NodeJS.ProcessEnv;
  resolve?: Resolver;
  now?: () => number;
  timeoutMs?: number;
}

export class DeliveryError extends Error {
  constructor(message: string, readonly retryable: boolean) {
    super(message);
    this.name = "DeliveryError";
  }
}

export const NOTIFY_OUTBOUND_POLICY = {
  allowPrivateEnv: "GS_NOTIFY_ALLOW_PRIVATE_ENDPOINTS",
  allowLoopbackEnv: "GS_NOTIFY_ALLOW_LOOPBACK_ENDPOINTS",
};

// Slack and Discord targets are pinned to the vendors' own hosts, so a tenant
// cannot use those channel types to reach anything else.
const SLACK_URL = /^https:\/\/hooks\.slack\.com\/(?:services|workflows|triggers)\/[A-Za-z0-9_\-/]+$/;
const DISCORD_URL = /^https:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+$/;
// Telegram's host is fixed; the token and chat id become part of the request,
// so both are held to their documented shapes.
const TELEGRAM_TOKEN = /^\d{5,20}:[A-Za-z0-9_-]{30,60}$/;
const TELEGRAM_CHAT = /^(?:-?\d{1,20}|@[A-Za-z][A-Za-z0-9_]{4,31})$/;
const EMAIL = /^[^\s@<>()",;:\\]+@[^\s@<>()",;:\\]+\.[^\s@<>()",;:\\]+$/;
const MAX_RECIPIENTS = 20;

const COLORS: Record<Severity, number> = {
  success: 0x22c55e,
  info: 0x3b82f6,
  warning: 0xf59e0b,
  critical: 0xef4444,
};

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Slack treats <...> as links and mentions (<!channel>); escaping disarms them. */
function escapeSlack(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Only http(s) links are ever rendered. */
function safeLink(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : undefined;
  } catch {
    return undefined;
  }
}

export function signWebhook(signingSecret: string, timestamp: string, body: string): string {
  return `sha256=${createHmac("sha256", signingSecret).update(`${timestamp}.${body}`).digest("hex")}`;
}

/** Check a channel's target before it is saved and before every send. */
export async function validateChannelTarget(
  type: ChannelType,
  config: ChannelConfig,
  secret: ChannelSecret,
  deps: Pick<ProviderDeps, "env" | "resolve" | "mailer">,
): Promise<void> {
  switch (type) {
    case "slack":
      if (!secret.url || !SLACK_URL.test(secret.url)) {
        throw new DeliveryError("A Slack channel needs an incoming webhook URL on https://hooks.slack.com/", false);
      }
      return;
    case "discord":
      if (!secret.url || !DISCORD_URL.test(secret.url)) {
        throw new DeliveryError("A Discord channel needs a webhook URL of the form https://discord.com/api/webhooks/<id>/<token>", false);
      }
      return;
    case "telegram":
      if (!secret.botToken || !TELEGRAM_TOKEN.test(secret.botToken)) {
        throw new DeliveryError("The Telegram bot token is not in the expected <id>:<secret> form", false);
      }
      if (!config.chatId || !TELEGRAM_CHAT.test(config.chatId)) {
        throw new DeliveryError("The Telegram chat must be a numeric chat id or an @channel name", false);
      }
      return;
    case "email": {
      const recipients = config.recipients ?? [];
      if (recipients.length === 0 || recipients.length > MAX_RECIPIENTS || !recipients.every((r) => EMAIL.test(r))) {
        throw new DeliveryError(`An email channel needs between 1 and ${MAX_RECIPIENTS} valid recipient addresses`, false);
      }
      if (!deps.mailer) {
        throw new DeliveryError("Email is not configured on this server (SMTP_HOST is not set)", false);
      }
      return;
    }
    case "webhook":
      if (!secret.url) throw new DeliveryError("A webhook channel needs a URL", false);
      try {
        await assertSafeOutboundUrl(secret.url, NOTIFY_OUTBOUND_POLICY, deps.env, deps.resolve);
      } catch (error) {
        if (error instanceof UnsafeUrlError) throw new DeliveryError(error.message, false);
        throw error;
      }
      if (secret.signingSecret !== undefined && secret.signingSecret.length < 16) {
        throw new DeliveryError("A webhook signing secret must be at least 16 characters", false);
      }
      return;
    default:
      throw new DeliveryError("Unknown channel type", false);
  }
}

async function postJson(url: string, payload: string, headers: Record<string, string>, deps: ProviderDeps, label: string): Promise<void> {
  let response: Response;
  try {
    response = await deps.fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": "GuildServer-Notifications/1.0", ...headers },
      body: payload,
      redirect: "manual",
      signal: AbortSignal.timeout(deps.timeoutMs ?? 10_000),
    });
  } catch (error: any) {
    // The underlying error can quote the URL, which may carry a token; say
    // only what kind of failure it was.
    const timedOut = error?.name === "TimeoutError" || error?.name === "AbortError";
    throw new DeliveryError(`${label} ${timedOut ? "timed out" : "could not be reached"}`, true);
  }
  if (response.status >= 200 && response.status < 300) return;
  if (response.status >= 300 && response.status < 400) {
    throw new DeliveryError(`${label} answered with a redirect (HTTP ${response.status}), which is not followed`, false);
  }
  const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
  throw new DeliveryError(`${label} answered HTTP ${response.status}`, retryable);
}

export function renderEmailHtml(message: Pick<OutgoingMessage, "title" | "message">, link: string | undefined, env: NodeJS.ProcessEnv): string {
  const base = safeLink(env.APP_URL) ?? "http://localhost:3000";
  const settings = new URL("/dashboard/settings", base).toString();
  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: #1a1a2e; color: #e0e0e0; padding: 20px; border-radius: 8px;">
        <h2 style="margin: 0 0 12px; color: #ffffff;">${escapeHtml(message.title)}</h2>
        <p style="margin: 0 0 16px; color: #b0b0b0; line-height: 1.5;">${escapeHtml(message.message)}</p>
        ${link ? `<a href="${escapeHtml(link)}" style="display: inline-block; background: #6366f1; color: white; padding: 10px 20px; border-radius: 6px; text-decoration: none; font-weight: 500;">View Details</a>` : ""}
      </div>
      <p style="color: #888; font-size: 12px; margin-top: 16px; text-align: center;">
        GuildServer PaaS — <a href="${escapeHtml(settings)}" style="color: #6366f1;">Manage notification preferences</a>
      </p>
    </div>
  `;
}

export async function sendToChannel(
  type: ChannelType,
  config: ChannelConfig,
  secret: ChannelSecret,
  message: OutgoingMessage,
  deps: ProviderDeps,
): Promise<void> {
  await validateChannelTarget(type, config, secret, deps);
  const link = safeLink(message.url);

  switch (type) {
    case "slack": {
      const title = escapeSlack(clip(message.title, 150));
      const blocks: unknown[] = [
        { type: "section", text: { type: "mrkdwn", text: `*${title}*\n${escapeSlack(clip(message.message, 2800))}` } },
      ];
      if (link) {
        blocks.push({ type: "actions", elements: [{ type: "button", text: { type: "plain_text", text: "View Details" }, url: link }] });
      }
      const color = `#${COLORS[message.severity].toString(16).padStart(6, "0")}`;
      return postJson(secret.url!, JSON.stringify({ text: title, attachments: [{ color, blocks }] }), {}, deps, "Slack");
    }
    case "discord":
      return postJson(
        secret.url!,
        JSON.stringify({
          username: "GuildServer",
          // Never let event text ping @everyone, roles or users.
          allowed_mentions: { parse: [] },
          embeds: [
            {
              title: clip(message.title, 256),
              description: clip(message.message, 4000),
              url: link,
              color: COLORS[message.severity],
              timestamp: message.occurredAt,
            },
          ],
        }),
        {},
        deps,
        "Discord",
      );
    case "telegram": {
      // Plain text: no parse_mode, so event text cannot inject markup.
      const text = clip([message.title, message.message, link].filter(Boolean).join("\n\n"), 4000);
      return postJson(
        `https://api.telegram.org/bot${secret.botToken}/sendMessage`,
        JSON.stringify({ chat_id: config.chatId, text, disable_web_page_preview: true }),
        {},
        deps,
        "Telegram",
      );
    }
    case "webhook": {
      const payload = JSON.stringify({
        event: message.event,
        title: message.title,
        message: message.message,
        severity: message.severity,
        url: link ?? null,
        occurredAt: message.occurredAt,
        data: message.data ?? {},
      });
      const timestamp = String(Math.floor((deps.now?.() ?? Date.now()) / 1000));
      const headers: Record<string, string> = {
        "X-GuildServer-Event": message.event,
        "X-GuildServer-Timestamp": timestamp,
      };
      // Receivers verify HMAC-SHA256(secret, "<timestamp>.<raw body>").
      if (secret.signingSecret) headers["X-GuildServer-Signature"] = signWebhook(secret.signingSecret, timestamp, payload);
      return postJson(secret.url!, payload, headers, deps, "Webhook");
    }
    case "email": {
      try {
        await deps.mailer!.sendMail({
          from: deps.env.EMAIL_FROM || "noreply@guildserver.com",
          to: config.recipients!,
          subject: clip(message.title, 200),
          text: [message.message, link].filter(Boolean).join("\n\n"),
          html: renderEmailHtml(message, link, deps.env),
        });
      } catch (error: any) {
        const code = typeof error?.responseCode === "number" ? error.responseCode : undefined;
        // SMTP 4xx is temporary, 5xx permanent; no code means the server was not reached.
        const retryable = code === undefined || (code >= 400 && code < 500);
        throw new DeliveryError(code ? `The mail server refused the message (SMTP ${code})` : "The mail server could not be reached", retryable);
      }
      return;
    }
  }
}
