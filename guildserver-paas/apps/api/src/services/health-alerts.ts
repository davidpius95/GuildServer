/**
 * Tell an organization when one of its applications is crash-looping.
 *
 * The platform collected container states every few minutes and did nothing
 * with them: `alert-check` was an empty case, so nothing ever reached a human.
 *
 * Only `restarting` is alerted on. A crashed container and one a user stopped
 * deliberately both end up as `stopped` (see dockerStateToAppStatus), so
 * alerting on that would page people for stopping their own application.
 * Nothing sets `restarting` deliberately: it means Docker is restarting the
 * container because it keeps exiting.
 */

import { db, applications } from "@guildserver/database";
import { eq } from "drizzle-orm";
import { logger } from "../utils/logger";
import { notifyOrganization } from "./notification";

/** One alert per application per hour, however often the check runs. */
export function alertWindowKey(applicationId: string, now: Date): string {
  const hour = new Date(now.getTime());
  hour.setMinutes(0, 0, 0);
  return `${applicationId}:${hour.toISOString()}`;
}

export interface AlertDeps {
  database?: typeof db;
  notify?: typeof notifyOrganization;
  now?: () => Date;
  appUrl?: string;
}

/**
 * Notify each affected organization once per hour. Returns how many alerts
 * were raised, so the worker can log something meaningful.
 */
export async function checkApplicationHealth({
  database = db,
  notify = notifyOrganization,
  now = () => new Date(),
  appUrl = process.env.APP_URL || "http://localhost:3000",
}: AlertDeps = {}): Promise<number> {
  const unhealthy = await database.query.applications.findMany({
    where: eq(applications.status, "restarting"),
    with: { project: { columns: { organizationId: true } } },
  });

  let raised = 0;
  for (const app of unhealthy) {
    const organizationId = app.project?.organizationId;
    if (!organizationId) {
      // An application with no project has nobody to tell.
      logger.warn("Skipping health alert for an application with no organization", { applicationId: app.id });
      continue;
    }

    try {
      await notify(organizationId, "application_unhealthy", {
        appName: app.name,
        logsUrl: `${appUrl}/dashboard/applications/${app.id}`,
        dedupeKey: alertWindowKey(app.id, now()),
      });
      raised++;
    } catch (error: any) {
      // One organization's failure must not stop the others being told.
      logger.error("Could not raise a health alert", { applicationId: app.id, error: error?.message });
    }
  }

  if (raised > 0) logger.info(`Raised ${raised} application health alert(s)`);
  return raised;
}
