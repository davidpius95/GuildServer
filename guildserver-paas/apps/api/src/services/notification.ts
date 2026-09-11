import { db, notifications, notificationPreferences, slackConfigs, members, users } from "@guildserver/database";
import { eq, and, inArray } from "drizzle-orm";
import { logger } from "../utils/logger";
import { broadcastToUser } from "../websocket/server";
import { EVENT_ICONS, renderEvent, type NotificationEvent, type NotifyData, type Severity } from "./notifications/events";
import { defaultProviderDeps, dispatchToOrganization } from "./notifications/dispatch";
import { sendToChannel } from "./notifications/providers";

export type { NotificationEvent, NotifyData } from "./notifications/events";

interface Rendered {
  title: string;
  message: string;
  severity: Severity;
}

/**
 * Send a notification to a user across their enabled personal channels
 * (in-app, email, the organization's Slack webhook), then to every
 * organization notification channel subscribed to the event.
 */
export async function notify(
  event: NotificationEvent,
  userId: string,
  orgId: string | null,
  data: NotifyData
): Promise<void> {
  try {
    const rendered = renderEvent(event, data);

    // Check user's notification preferences for this event
    const prefs = await db.query.notificationPreferences.findFirst({
      where: and(
        eq(notificationPreferences.userId, userId),
        eq(notificationPreferences.event, event)
      ),
    });

    // Default preferences: in-app + email enabled, slack disabled
    const emailEnabled = prefs?.emailEnabled ?? true;
    const slackEnabled = prefs?.slackEnabled ?? false;
    const inAppEnabled = prefs?.inAppEnabled ?? true;

    // 1. In-app notification
    if (inAppEnabled) {
      const icon = EVENT_ICONS[event] || "📋";
      await sendInAppNotification(userId, event, `${icon} ${rendered.title}`, rendered.message, data);
    }

    // 2. Email notification
    if (emailEnabled) {
      await sendEmailNotification(userId, event, rendered, data);
    }

    // 3. Slack notification
    if (slackEnabled && orgId) {
      await sendSlackNotification(orgId, event, rendered, data);
    }

    logger.info(`Notification sent: ${event} to user ${userId}`, {
      channels: {
        inApp: inAppEnabled,
        email: emailEnabled,
        slack: slackEnabled,
      },
    });
  } catch (error: any) {
    logger.error(`Failed to send notification: ${error.message}`, {
      event,
      userId,
    });
  }

  // 4. Organization channels, once per occurrence however many users are told.
  if (orgId) {
    try {
      await dispatchToOrganization(orgId, event, data);
    } catch (error: any) {
      logger.error(`Failed to dispatch ${event} to organization channels: ${error.message}`, { orgId });
    }
  }
}

/**
 * For events that belong to an organization rather than to one user's action
 * (a scheduled backup failing): tell its owners and admins, then its channels.
 */
export async function notifyOrganization(
  orgId: string,
  event: NotificationEvent,
  data: NotifyData
): Promise<void> {
  try {
    const managers = await db
      .select({ userId: members.userId })
      .from(members)
      .where(and(eq(members.organizationId, orgId), inArray(members.role, ["owner", "admin"])));
    for (const { userId } of managers) {
      if (userId) await notify(event, userId, null, data);
    }
  } catch (error: any) {
    logger.error(`Failed to notify organization members of ${event}: ${error.message}`, { orgId });
  }

  try {
    await dispatchToOrganization(orgId, event, data);
  } catch (error: any) {
    logger.error(`Failed to dispatch ${event} to organization channels: ${error.message}`, { orgId });
  }
}

/**
 * In-app notification: Insert into DB + broadcast via WebSocket
 */
async function sendInAppNotification(
  userId: string,
  type: string,
  title: string,
  message: string,
  metadata: NotifyData
): Promise<void> {
  try {
    const [notification] = await db
      .insert(notifications)
      .values({
        userId,
        type,
        title,
        message,
        metadata,
        read: false,
      })
      .returning();

    // Broadcast to user via WebSocket for real-time updates
    broadcastToUser(userId, {
      type: "notification",
      notification: {
        id: notification.id,
        type: notification.type,
        title: notification.title,
        message: notification.message,
        metadata: notification.metadata,
        read: false,
        createdAt: notification.createdAt,
      },
    });
  } catch (error: any) {
    logger.warn(`Failed to send in-app notification: ${error.message}`);
  }
}

/**
 * Email notification via SMTP. Skipped when SMTP is not configured.
 */
async function sendEmailNotification(
  userId: string,
  event: NotificationEvent,
  rendered: Rendered,
  data: NotifyData
): Promise<void> {
  const deps = defaultProviderDeps();
  if (!deps.mailer) {
    logger.debug("SMTP not configured, skipping email notification");
    return;
  }

  try {
    const user = await db.query.users.findFirst({
      where: eq(users.id, userId),
    });
    if (!user?.email) return;

    await sendToChannel(
      "email",
      { recipients: [user.email] },
      {},
      { event, ...rendered, url: data.url, occurredAt: new Date().toISOString() },
      deps
    );
    logger.info(`Email notification sent for ${event}`);
  } catch (error: any) {
    logger.warn(`Failed to send email notification: ${error.message}`);
  }
}

/**
 * Slack notification via the organization's incoming webhook
 */
async function sendSlackNotification(
  orgId: string,
  event: NotificationEvent,
  rendered: Rendered,
  data: NotifyData
): Promise<void> {
  try {
    const config = await db.query.slackConfigs.findFirst({
      where: and(
        eq(slackConfigs.organizationId, orgId),
        eq(slackConfigs.enabled, true)
      ),
    });

    if (!config?.webhookUrl) {
      logger.debug("No Slack webhook configured for org, skipping");
      return;
    }

    await sendToChannel(
      "slack",
      {},
      { url: config.webhookUrl },
      { event, ...rendered, url: data.url, occurredAt: new Date().toISOString() },
      defaultProviderDeps()
    );
    logger.info(`Slack notification sent for ${event}`);
  } catch (error: any) {
    logger.warn(`Failed to send Slack notification: ${error.message}`);
  }
}
