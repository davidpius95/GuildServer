/**
 * Fan an event out to an organization's notification channels.
 *
 * Each (channel, occurrence) is claimed with an insert on a unique key before
 * anything is sent, so the same occurrence reported twice — by a retried job
 * or by two code paths — reaches each channel once. Transient failures are
 * retried in-process; the outcome is recorded on the delivery and the channel.
 */
import { randomUUID } from "crypto";
import { and, eq } from "drizzle-orm";
import { db, notificationChannels, notificationDeliveries } from "@guildserver/database";
import { decryptSecret } from "../../utils/crypto";
import { logger } from "../../utils/logger";
import { renderEvent, type NotificationEvent, type NotifyData } from "./events";
import { mailerFromEnv } from "./mailer";
import {
  DeliveryError,
  sendToChannel,
  type ChannelConfig,
  type ChannelSecret,
  type ChannelType,
  type OutgoingMessage,
  type ProviderDeps,
} from "./providers";

type ChannelRow = typeof notificationChannels.$inferSelect;

export interface DispatchOptions {
  dedupeKey?: string;
  deps?: Partial<ProviderDeps>;
  /** Delay before each retry; its length is the number of retries. */
  retryDelaysMs?: number[];
}

export interface DispatchResult {
  channelId: string;
  status: "sent" | "failed" | "duplicate";
}

const DEFAULT_RETRY_DELAYS_MS = [2_000, 10_000];

export function defaultProviderDeps(): ProviderDeps {
  return { fetch: globalThis.fetch.bind(globalThis), mailer: mailerFromEnv(), env: process.env };
}

export function channelSecret(row: Pick<ChannelRow, "secret">): ChannelSecret {
  if (!row.secret) return {};
  const plain = decryptSecret(row.secret);
  if (!plain) throw new DeliveryError("The channel's stored credentials could not be decrypted", false);
  return JSON.parse(plain) as ChannelSecret;
}

/** Remove anything credential-like from an error before it is stored or shown. */
export function redactDeliveryError(message: string, secret: ChannelSecret): string {
  let out = message;
  for (const value of [secret.url, secret.botToken, secret.signingSecret]) {
    if (value) out = out.split(value).join("[redacted]");
  }
  return out
    .replace(/bot\d+:[A-Za-z0-9_-]+/g, "bot[redacted]")
    .replace(/(hooks\.slack\.com\/)\S+/g, "$1[redacted]")
    .replace(/(discord(?:app)?\.com\/api\/webhooks\/)\S+/g, "$1[redacted]")
    .slice(0, 500);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A channel's events, whichever way the jsonb value was encoded when stored. */
export function subscribedEvents(channel: Pick<ChannelRow, "events">): string[] {
  let events: unknown = channel.events;
  if (typeof events === "string") {
    try {
      events = JSON.parse(events);
    } catch {
      return [];
    }
  }
  return Array.isArray(events) ? events.filter((e): e is string => typeof e === "string") : [];
}

export async function dispatchToOrganization(
  organizationId: string,
  event: NotificationEvent,
  data: NotifyData,
  options: DispatchOptions = {},
): Promise<DispatchResult[]> {
  // Subscriptions are matched here rather than with jsonb containment in SQL:
  // drizzle-orm 0.29 on postgres-js stores jsonb values as JSON-encoded
  // strings, and `@>` against a string scalar never matches.
  const candidates = await db
    .select()
    .from(notificationChannels)
    .where(and(eq(notificationChannels.organizationId, organizationId), eq(notificationChannels.enabled, true)));
  const channels = candidates.filter((channel) => subscribedEvents(channel).includes(event));
  if (channels.length === 0) return [];

  const { dedupeKey: occurrence, ...payloadData } = data;
  const dedupeKey = `${event}:${options.dedupeKey ?? occurrence ?? randomUUID()}`.slice(0, 255);
  const { title, message, severity } = renderEvent(event, data);
  const outgoing: OutgoingMessage = {
    event,
    title,
    message,
    severity,
    url: data.url ?? data.logsUrl,
    occurredAt: new Date().toISOString(),
    data: payloadData,
  };
  const deps: ProviderDeps = { ...defaultProviderDeps(), ...options.deps };
  const delays = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;

  return Promise.all(channels.map((channel) => deliver(channel, event, dedupeKey, outgoing, deps, delays)));
}

async function deliver(
  channel: ChannelRow,
  event: string,
  dedupeKey: string,
  message: OutgoingMessage,
  deps: ProviderDeps,
  delays: number[],
): Promise<DispatchResult> {
  const [claimed] = await db
    .insert(notificationDeliveries)
    .values({ channelId: channel.id, event, dedupeKey, status: "pending", attempts: 0 })
    .onConflictDoNothing({ target: [notificationDeliveries.channelId, notificationDeliveries.dedupeKey] })
    .returning({ id: notificationDeliveries.id });
  if (!claimed) return { channelId: channel.id, status: "duplicate" };

  let secret: ChannelSecret = {};
  let attempts = 0;
  let failure = "Unexpected error while sending";
  try {
    secret = channelSecret(channel);
    for (;;) {
      attempts++;
      try {
        await sendToChannel(channel.type as ChannelType, (channel.config ?? {}) as ChannelConfig, secret, message, deps);
        await record(channel.id, claimed.id, attempts, null);
        return { channelId: channel.id, status: "sent" };
      } catch (error) {
        if (!(error instanceof DeliveryError)) {
          logger.error(`Notification channel ${channel.id} send error: ${redactDeliveryError(String((error as Error)?.message ?? error), secret)}`);
        }
        failure = error instanceof DeliveryError ? error.message : "Unexpected error while sending";
        const retryable = error instanceof DeliveryError && error.retryable;
        if (!retryable || attempts > delays.length) break;
        await sleep(delays[attempts - 1]);
      }
    }
  } catch (error) {
    failure = error instanceof DeliveryError ? error.message : "Unexpected error while sending";
  }

  const stored = redactDeliveryError(failure, secret);
  await record(channel.id, claimed.id, attempts, stored);
  logger.warn(`Notification ${event} to channel ${channel.id} failed after ${attempts} attempt(s): ${stored}`);
  return { channelId: channel.id, status: "failed" };
}

async function record(channelId: string, deliveryId: string, attempts: number, error: string | null): Promise<void> {
  const now = new Date();
  await db
    .update(notificationDeliveries)
    .set({ status: error ? "failed" : "sent", attempts, error, deliveredAt: error ? null : now })
    .where(eq(notificationDeliveries.id, deliveryId));
  await db
    .update(notificationChannels)
    .set({ lastDeliveryAt: now, lastDeliveryOk: !error, lastError: error })
    .where(eq(notificationChannels.id, channelId));
}

/** Send a one-off test message; nothing is recorded as a delivery. */
export async function sendTestMessage(
  channel: ChannelRow,
  deps: Partial<ProviderDeps> = {},
): Promise<{ ok: true } | { ok: false; error: string }> {
  let secret: ChannelSecret = {};
  try {
    secret = channelSecret(channel);
    await sendToChannel(
      channel.type as ChannelType,
      (channel.config ?? {}) as ChannelConfig,
      secret,
      {
        event: "test",
        title: "GuildServer test notification",
        message: `The channel "${channel.name}" is connected and will receive the events it is subscribed to.`,
        severity: "info",
        occurredAt: new Date().toISOString(),
      },
      { ...defaultProviderDeps(), ...deps },
    );
    return { ok: true };
  } catch (error) {
    const message = error instanceof DeliveryError ? error.message : "Unexpected error while sending";
    return { ok: false, error: redactDeliveryError(message, secret) };
  }
}
