import { Router, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { createReadStream } from "fs";
import { DatabaseBackupService } from "../services/db-backup";
import { logger } from "../utils/logger";

export const backupsRouter = Router();

/**
 * GET /backups/:backupId?token=<jwt>
 * Streams a completed backup artifact. Auth via the short-lived JWT minted by
 * database.downloadBackup (DatabaseBackupService.getDownloadUrl).
 */
backupsRouter.get("/:backupId", async (req: Request, res: Response) => {
  const { backupId } = req.params;
  const token = String(req.query.token || "");

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as { backupId?: string };
    if (decoded.backupId !== backupId) {
      return res.status(403).json({ error: "Invalid download token" });
    }
  } catch {
    return res.status(401).json({ error: "Expired or invalid download token" });
  }

  const filePath = await DatabaseBackupService.getFilePath(backupId);
  if (!filePath) {
    return res.status(404).json({ error: "Backup not found" });
  }

  res.setHeader("Content-Type", "application/gzip");
  res.setHeader("Content-Disposition", `attachment; filename="${backupId}.dump.gz"`);
  const stream = createReadStream(filePath);
  stream.on("error", (err) => {
    logger.error(`Backup download failed for ${backupId}: ${err.message}`);
    if (!res.headersSent) res.status(500).json({ error: "Failed to read backup file" });
  });
  stream.pipe(res);
});
