import { db, notifications, notificationPreferences, slackConfigs } from "@guildserver/database";
import { eq, and } from "drizzle-orm";
import { logger } from "../utils/logger";
import { broadcastToUser } from "../websocket/server";

// Notification event types
export type NotificationEvent =
  | "deployment_success"
  | "deployment_failed"
  | "preview_created"
  | "preview_expired"
  | "certificate_expiring"
  | "certificate_failed"
  | "webhook_failed"
  | "member_added"
  | "member_removed"
  | "spend_threshold_50"
  | "spend_threshold_75"
  | "spend_threshold_100"
  | "spend_limit_reached"
  | "trial_ending";

interface NotifyData {
  appName?: string;
  url?: string;
  commitSha?: string;
  branch?: string;
  previewUrl?: string;
  error?: string;
  logsUrl?: string;
  memberEmail?: string;
  domain?: string;
  [key: string]: any;
}

// Icon/emoji mappings for notification types
const EVENT_ICONS: Record<NotificationEvent, string> = {
  deployment_success: "✅",
  deployment_failed: "❌",
  preview_created: "🔀",
  preview_expired: "⏰",
  certificate_expiring: "⚠️",
  certificate_failed: "🔒",
  webhook_failed: "🔔",
  member_added: "👤",
  member_removed: "👤",
  spend_threshold_50: "💰",
  spend_threshold_75: "⚠️",
  spend_threshold_100: "🚨",
  spend_limit_reached: "🛑",
  trial_ending: "⏳",
};

// Generate notification title/message based on event
function generateNotification(
  event: NotificationEvent,
  data: NotifyData
): { title: string; message: string } {
  const icon = EVENT_ICONS[event] || "📋";

  switch (event) {
    case "deployment_success":
      return {
        title: `${icon} ${data.appName} deployed successfully`,
        message: data.commitSha
          ? `Deployment completed for commit ${data.commitSha.slice(0, 8)}. ${data.url ? `View at ${data.url}` : ""}`
          : `Deployment completed successfully. ${data.url ? `View at ${data.url}` : ""}`,
      };
    case "deployment_failed":
      return {
        title: `${icon} ${data.appName} deployment failed`,
        message: data.error
          ? `Deployment failed: ${data.error.slice(0, 200)}`
          : "Deployment failed. Check the build logs for details.",
      };
    case "preview_created":
      return {
        title: `${icon} Preview ready for ${data.branch}`,
        message: `Preview deployment for ${data.appName} branch "${data.branch}" is ready. ${data.previewUrl ? `View at ${data.previewUrl}` : ""}`,
      };
    case "preview_expired":
      return {
        title: `${icon} Preview expired for ${data.branch}`,
        message: `Preview deployment for ${data.appName} branch "${data.branch}" has been cleaned up after TTL expiration.`,
      };
    case "certificate_expiring":
      return {
        title: `${icon} SSL certificate expiring for ${data.domain}`,
        message: `The SSL certificate for ${data.domain} is expiring soon. Traefik will attempt to auto-renew.`,
      };
    case "certificate_failed":
      return {
        title: `${icon} SSL certificate failed for ${data.domain}`,
        message: `Failed to provision SSL certificate for ${data.domain}. Check your DNS configuration.`,
      };
    case "webhook_failed":
      return {
        title: `${icon} Webhook delivery failed`,
        message: `A webhook delivery for ${data.appName} failed to trigger a deployment.`,
      };
    case "member_added":
      return {
        title: `${icon} New team member added`,
        message: `${data.memberEmail} has been added to the team.`,
      };
    case "member_removed":
      return {
        title: `${icon} Team member removed`,
        message: `${data.memberEmail} has been removed from the team.`,
      };
    case "spend_threshold_50":
      return {
        title: `${icon} 50% of spend limit used`,
        message: `Your organization has used 50% of its monthly spend limit ($${data.currentSpend}/$${data.spendLimit}). Consider reviewing your usage.`,
      };
    case "spend_threshold_75":
      return {
        title: `${icon} 75% of spend limit used`,
        message: `Your organization has used 75% of its monthly spend limit ($${data.currentSpend}/$${data.spendLimit}). You're approaching your limit.`,
      };
    case "spend_threshold_100":
      return {
        title: `${icon} Spend limit reached`,
        message: `Your organization has reached 100% of its monthly spend limit ($${data.currentSpend}/$${data.spendLimit}).`,
      };
    case "spend_limit_reached":
      return {
        title: `${icon} Deployments paused — spend limit reached`,
        message: `New deployments are paused because your organization has reached its $${data.spendLimit}/mo spend limit. Increase your limit or wait for the next billing period.`,
      };
    case "trial_ending":
      return {
        title: `${icon} Your Pro trial ends soon`,
        message: `Your 14-day Pro trial ends on ${data.trialEndDate}. Add a payment method to keep Pro features, or you'll be downgraded to Hobby.`,
      };
    default:
      return {
        title: `${icon} Notification`,
        message: JSON.stringify(data),
      };
  }
}

/**
 * Send a notification to a user across all enabled channels
 */
export async function notify(
  event: NotificationEvent,
  userId: string,
  orgId: string | null,
  data: NotifyData
): Promise<void> {
  try {
    const { title, message } = generateNotification(event, data);

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
      await sendInAppNotification(userId, event, title, message, data);
    }

    // 2. Email notification
    if (emailEnabled) {
      await sendEmailNotification(userId, event, title, message, data);
    }

    // 3. Slack notification
    if (slackEnabled && orgId) {
      await sendSlackNotification(orgId, event, title, message, data);
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
 * Email notification via SMTP (nodemailer)
 * Falls back gracefully if SMTP is not configured
 */
async function sendEmailNotification(
  userId: string,
  event: string,
  title: string,
  message: string,
  data: NotifyData
): Promise<void> {
  const smtpHost = process.env.SMTP_HOST;
  if (!smtpHost) {
    logger.debug("SMTP not configured, skipping email notification");
    return;
  }

  try {
    // Dynamic import to avoid requiring nodemailer when not needed
    const nodemailer = await import("nodemailer");

    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: parseInt(process.env.SMTP_PORT || "587"),
      secure: process.env.SMTP_PORT === "465",
      auth: process.env.SMTP_USER
        ? {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
          }
        : undefined,
    });

    // Get user email from DB
    const { users } = await import("@guildserver/database");
    const user = await db.query.users.findFirst({
      where: eq(users.id, userId),
    });

    if (!user?.email) return;

    const htmlBody = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: #1a1a2e; color: #e0e0e0; padding: 20px; border-radius: 8px;">
          <h2 style="margin: 0 0 12px; color: #ffffff;">${title}</h2>
          <p style="margin: 0 0 16px; color: #b0b0b0; line-height: 1.5;">${message}</p>
          ${data.url ? `<a href="${data.url}" style="display: inline-block; background: #6366f1; color: white; padding: 10px 20px; border-radius: 6px; text-decoration: none; font-weight: 500;">View Details</a>` : ""}
        </div>
        <p style="color: #888; font-size: 12px; margin-top: 16px; text-align: center;">
          GuildServer PaaS — <a href="${process.env.APP_URL || "http://localhost:3000"}/dashboard/settings" style="color: #6366f1;">Manage notification preferences</a>
        </p>
      </div>
    `;

    await transporter.sendMail({
      from: process.env.EMAIL_FROM || "noreply@guildserver.com",
      to: user.email,
      subject: title.replace(/[✅❌🔀⏰⚠️🔒🔔👤📋]/gu, "").trim(),
      html: htmlBody,
    });

    logger.info(`Email notification sent to ${user.email} for ${event}`);
  } catch (error: any) {
    logger.warn(`Failed to send email notification: ${error.message}`);
  }
}

/**
 * Slack notification via incoming webhook
 */
async function sendSlackNotification(
  orgId: string,
  event: string,
  title: string,
  message: string,
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

    // Build Slack Block Kit message
    const colorMap: Record<string, string> = {
      deployment_success: "#22c55e",
      deployment_failed: "#ef4444",
      preview_created: "#8b5cf6",
      preview_expired: "#f59e0b",
      certificate_expiring: "#f59e0b",
      certificate_failed: "#ef4444",
      webhook_failed: "#f59e0b",
      member_added: "#3b82f6",
      member_removed: "#6b7280",
    };

    const slackPayload = {
      attachments: [
        {
          color: colorMap[event] || "#6366f1",
          blocks: [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: `*${title}*\n${message}`,
              },
            },
            ...(data.url
              ? [
                  {
                    type: "actions",
                    elements: [
                      {
                        type: "button",
                        text: { type: "plain_text", text: "View Details" },
                        url: data.url,
                      },
                    ],
                  },
                ]
              : []),
          ],
        },
      ],
    };

    const response = await fetch(config.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(slackPayload),
    });

    if (!response.ok) {
      logger.warn(`Slack webhook returned ${response.status}: ${await response.text()}`);
    } else {
      logger.info(`Slack notification sent for ${event}`);
    }
  } catch (error: any) {
    logger.warn(`Failed to send Slack notification: ${error.message}`);
  }
}
