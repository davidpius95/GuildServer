/**
 * The notification event catalogue: what can happen and how each event reads.
 * Titles are plain text. The in-app inbox prefixes an icon; other channels
 * do not, because an emoji in an email subject or webhook payload is noise.
 */
export const NOTIFICATION_EVENTS = [
  "deployment_success",
  "deployment_failed",
  "preview_created",
  "preview_expired",
  "certificate_expiring",
  "certificate_failed",
  "webhook_failed",
  "member_added",
  "member_removed",
  "spend_threshold_50",
  "spend_threshold_75",
  "spend_threshold_100",
  "spend_limit_reached",
  "trial_ending",
  "payment_failed",
  "backup_failed",
  "backup_upload_failed",
] as const;

export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number];

export type Severity = "success" | "info" | "warning" | "critical";

export interface NotifyData {
  appName?: string;
  url?: string;
  commitSha?: string;
  branch?: string;
  previewUrl?: string;
  error?: string;
  logsUrl?: string;
  memberEmail?: string;
  domain?: string;
  databaseName?: string;
  /**
   * Identifies the occurrence (a deployment id, a backup id). Organization
   * channels receive each occurrence of an event at most once.
   */
  dedupeKey?: string;
  [key: string]: any;
}

export const EVENT_ICONS: Record<NotificationEvent, string> = {
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
  payment_failed: "💳",
  backup_failed: "🗄️",
  backup_upload_failed: "☁️",
};

const SEVERITY: Record<NotificationEvent, Severity> = {
  deployment_success: "success",
  deployment_failed: "critical",
  preview_created: "info",
  preview_expired: "info",
  certificate_expiring: "warning",
  certificate_failed: "critical",
  webhook_failed: "warning",
  member_added: "info",
  member_removed: "info",
  spend_threshold_50: "info",
  spend_threshold_75: "warning",
  spend_threshold_100: "critical",
  spend_limit_reached: "critical",
  trial_ending: "warning",
  payment_failed: "critical",
  backup_failed: "critical",
  backup_upload_failed: "warning",
};

const clip = (text: string | undefined, max: number) => (text ?? "").slice(0, max);

export function renderEvent(
  event: NotificationEvent,
  data: NotifyData,
): { title: string; message: string; severity: Severity } {
  const severity = SEVERITY[event] ?? "info";
  const withSeverity = (title: string, message: string) => ({ title, message, severity });

  switch (event) {
    case "deployment_success":
      return withSeverity(
        `${data.appName} deployed successfully`,
        data.commitSha
          ? `Deployment completed for commit ${data.commitSha.slice(0, 8)}. ${data.url ? `View at ${data.url}` : ""}`
          : `Deployment completed successfully. ${data.url ? `View at ${data.url}` : ""}`,
      );
    case "deployment_failed":
      return withSeverity(
        `${data.appName} deployment failed`,
        data.error ? `Deployment failed: ${clip(data.error, 200)}` : "Deployment failed. Check the build logs for details.",
      );
    case "preview_created":
      return withSeverity(
        `Preview ready for ${data.branch}`,
        `Preview deployment for ${data.appName} branch "${data.branch}" is ready. ${data.previewUrl ? `View at ${data.previewUrl}` : ""}`,
      );
    case "preview_expired":
      return withSeverity(
        `Preview expired for ${data.branch}`,
        `Preview deployment for ${data.appName} branch "${data.branch}" has been cleaned up after TTL expiration.`,
      );
    case "certificate_expiring":
      return withSeverity(
        `SSL certificate expiring for ${data.domain}`,
        `The SSL certificate for ${data.domain} is expiring soon. Traefik will attempt to auto-renew.`,
      );
    case "certificate_failed":
      return withSeverity(
        `SSL certificate failed for ${data.domain}`,
        `Failed to provision SSL certificate for ${data.domain}. Check your DNS configuration.`,
      );
    case "webhook_failed":
      return withSeverity("Webhook delivery failed", `A webhook delivery for ${data.appName} failed to trigger a deployment.`);
    case "member_added":
      return withSeverity("New team member added", `${data.memberEmail} has been added to the team.`);
    case "member_removed":
      return withSeverity("Team member removed", `${data.memberEmail} has been removed from the team.`);
    case "spend_threshold_50":
      return withSeverity(
        "50% of spend limit used",
        `Your organization has used 50% of its monthly spend limit ($${data.currentSpend}/$${data.spendLimit}). Consider reviewing your usage.`,
      );
    case "spend_threshold_75":
      return withSeverity(
        "75% of spend limit used",
        `Your organization has used 75% of its monthly spend limit ($${data.currentSpend}/$${data.spendLimit}). You're approaching your limit.`,
      );
    case "spend_threshold_100":
      return withSeverity(
        "Spend limit reached",
        `Your organization has reached 100% of its monthly spend limit ($${data.currentSpend}/$${data.spendLimit}).`,
      );
    case "spend_limit_reached":
      return withSeverity(
        "Deployments paused — spend limit reached",
        `New deployments are paused because your organization has reached its $${data.spendLimit}/mo spend limit. Increase your limit or wait for the next billing period.`,
      );
    case "trial_ending":
      return withSeverity(
        "Your Pro trial ends soon",
        `Your 14-day Pro trial ends on ${data.trialEndDate}. Add a payment method to keep Pro features, or you'll be downgraded to Hobby.`,
      );
    case "payment_failed":
      return withSeverity("Payment failed", data.error ? clip(data.error, 300) : "A payment could not be completed. Check your billing details.");
    case "backup_failed":
      return withSeverity(
        `Backup failed for ${data.databaseName}`,
        data.error ? `The backup failed: ${clip(data.error, 200)}` : "The backup failed. Check the database's backup history for details.",
      );
    case "backup_upload_failed":
      return withSeverity(
        `Off-site copy failed for ${data.databaseName}`,
        `The backup completed locally, but copying it to off-site storage failed${data.error ? `: ${clip(data.error, 200)}` : "."}`,
      );
    default:
      return withSeverity("Notification", JSON.stringify(data));
  }
}
