import { Router } from "express";
import jwt from "jsonwebtoken";
import { db, databaseBackups, databases, members } from "@guildserver/database";
import { eq } from "drizzle-orm";
import { DatabaseBackupService } from "../services/db-backup";
import { logger } from "../utils/logger";

export const downloadRouter = Router();

/**
 * Authenticated backup file download.
 *
 * Browsers can't attach an Authorization header to a navigation, so the JWT may
 * be supplied either via the standard header or a short-lived `?token=` query
 * param (the same JWT the SPA already holds in localStorage).
 */
downloadRouter.get("/backup/:backupId", async (req, res) => {
  try {
    const token =
      req.headers.authorization?.replace("Bearer ", "") ||
      (typeof req.query.token === "string" ? req.query.token : "");
    if (!token) return res.status(401).json({ error: "Unauthorized" });

    let userId: string;
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET!) as any;
      userId = decoded.userId;
    } catch {
      return res.status(401).json({ error: "Invalid token" });
    }

    const backup = await db.query.databaseBackups.findFirst({
      where: eq(databaseBackups.id, req.params.backupId),
    });
    if (!backup?.databaseId) return res.status(404).json({ error: "Backup not found" });

    // Verify the user belongs to the org that owns this database.
    const database = await db.query.databases.findFirst({
      where: eq(databases.id, backup.databaseId),
      with: {
        project: { with: { organization: { with: { members: { where: eq(members.userId, userId) } } } } },
      },
    });
    if (!database?.project?.organization?.members?.length) {
      return res.status(404).json({ error: "Not found or access denied" });
    }

    const { filePath, fileName } = await DatabaseBackupService.getDownloadFile(req.params.backupId);
    return res.download(filePath, fileName);
  } catch (err: any) {
    logger.error(`Backup download failed: ${err.message}`);
    return res.status(500).json({ error: err.message || "Download failed" });
  }
});
