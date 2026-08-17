import "dotenv/config";
import { db, databaseBackups, databases } from "@guildserver/database";
import { eq } from "drizzle-orm";
import {
  provisionDatabaseContainer,
  removeDatabaseVolume,
} from "../src/services/database-provision";
import {
  DatabaseBackupService,
} from "../src/services/db-backup";
import { execInContainer, getAppContainer, removeExistingContainers } from "../src/services/docker/container";
import { backupQueue, backupWorker, syncBackupSchedule } from "../src/queues/backups";

const projectId = process.env.SMOKE_PROJECT_ID;

function required(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function outputToString(value: Buffer | string): string {
  return Buffer.isBuffer(value) ? value.toString("utf8") : value;
}

async function execPostgres(databaseId: string, password: string, sql: string): Promise<string> {
  const container = await getAppContainer(databaseId);
  if (!container) throw new Error(`No running container found for ${databaseId}`);

  const command = [
    "sh",
    "-c",
    `PGPASSWORD=${shellSingleQuote(password)} psql -v ON_ERROR_STOP=1 -U smoke_user -d smoke_db -tAc ${shellSingleQuote(sql)}`,
  ];
  const result = await execInContainer(container.id, command);
  if (result.exitCode !== 0) {
    throw new Error(outputToString(result.stderr) || `psql exited with code ${result.exitCode}`);
  }
  return outputToString(result.stdout).trim();
}

async function waitForPostgres(databaseId: string, password: string): Promise<void> {
  const deadline = Date.now() + 60_000;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      await execPostgres(databaseId, password, "select 1");
      return;
    } catch (err: any) {
      lastError = err.message;
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
  }
  throw new Error(`PostgreSQL did not become ready: ${lastError}`);
}

async function main() {
  required(projectId, "SMOKE_PROJECT_ID");

  const password = `Smoke-${Date.now()}-Pass`;
  const [record] = await db
    .insert(databases)
    .values({
      projectId,
      name: `codex-smoke-postgres-${Date.now()}`,
      type: "postgresql",
      databaseName: "smoke_db",
      username: "smoke_user",
      password,
      dockerImage: "postgres:15",
      status: "provisioning",
      backupEnabled: false,
      backupFrequency: "daily",
      backupHour: 3,
      backupRetentionDays: 7,
    })
    .returning();

  const summary: Record<string, unknown> = {
    databaseId: record.id,
    createdRecord: true,
  };

  try {
    const provisioned = await provisionDatabaseContainer({
      databaseId: record.id,
      name: record.name,
      type: "postgresql",
      dockerImage: "postgres:15",
      databaseName: "smoke_db",
      username: "smoke_user",
      password,
    });

    await db
      .update(databases)
      .set({
        containerId: provisioned.containerId,
        volumeName: provisioned.volumeName,
        externalPort: provisioned.hostPort,
        hostPort: provisioned.hostPort,
        status: "running",
        updatedAt: new Date(),
      })
      .where(eq(databases.id, record.id));

    summary.provisioned = true;
    summary.hostPort = provisioned.hostPort;

    await waitForPostgres(record.id, password);
    summary.ready = true;

    await execPostgres(record.id, password, "create table smoke_items(id serial primary key, label text not null)");
    await execPostgres(record.id, password, "insert into smoke_items(label) values ('before-backup')");
    const before = await execPostgres(record.id, password, "select count(*) from smoke_items");
    if (before !== "1") throw new Error(`Expected 1 row before backup, got ${before}`);
    summary.writeVerified = true;

    const backup = await DatabaseBackupService.triggerBackup(record.id, "manual");
    await DatabaseBackupService.runBackup(backup.id);
    const completedBackup = await db.query.databaseBackups.findFirst({
      where: eq(databaseBackups.id, backup.id),
    });
    if (!completedBackup || completedBackup.status !== "completed" || !completedBackup.filePath) {
      throw new Error("Backup did not complete with a file path");
    }
    summary.backupId = backup.id;
    summary.backupBytes = completedBackup.sizeBytes;

    await execPostgres(record.id, password, "insert into smoke_items(label) values ('after-backup')");
    const afterMutation = await execPostgres(record.id, password, "select count(*) from smoke_items");
    if (afterMutation !== "2") throw new Error(`Expected 2 rows after mutation, got ${afterMutation}`);

    await DatabaseBackupService.restoreBackup(backup.id);
    const afterRestore = await execPostgres(record.id, password, "select count(*) from smoke_items");
    if (afterRestore !== "1") throw new Error(`Expected 1 row after restore, got ${afterRestore}`);
    summary.restoreVerified = true;

    await syncBackupSchedule({
      id: record.id,
      backupEnabled: true,
      backupFrequency: "hourly",
      backupHour: 3,
    });
    const repeatables = await backupQueue.getRepeatableJobs();
    const delayedJobs = await backupQueue.getDelayed(0, -1);
    const expectedScheduleId = `auto-backup-${record.id}`;
    summary.scheduleRegistered = repeatables.some((job) =>
      job.id === expectedScheduleId ||
      job.key.includes(expectedScheduleId) ||
      job.name === expectedScheduleId,
    ) || delayedJobs.some((job) =>
      job.name === "scheduled-backup" &&
      job.data?.type === "backup" &&
      job.data.databaseId === record.id,
    );

    if (!summary.scheduleRegistered) {
      throw new Error("Automatic backup schedule was not registered");
    }

    console.log(JSON.stringify({ ok: true, ...summary }, null, 2));
  } finally {
    await syncBackupSchedule({ id: record.id, backupEnabled: false }).catch(() => undefined);

    const backups = await db.query.databaseBackups.findMany({
      where: eq(databaseBackups.databaseId, record.id),
    });
    for (const backup of backups) {
      await DatabaseBackupService.deleteBackupFile(backup.filePath);
    }

    await removeExistingContainers(record.id).catch(() => undefined);
    await removeDatabaseVolume(record.id).catch(() => undefined);
    await db.delete(databaseBackups).where(eq(databaseBackups.databaseId, record.id));
    await db.delete(databases).where(eq(databases.id, record.id));
    await backupWorker.close().catch(() => undefined);
    await backupQueue.close().catch(() => undefined);
  }
}

main().then(() => {
  process.exit(0);
}).catch((err) => {
  console.error(JSON.stringify({ ok: false, error: err.message }, null, 2));
  process.exit(1);
});
