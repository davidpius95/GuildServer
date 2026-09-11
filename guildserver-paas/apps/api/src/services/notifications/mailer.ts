import * as nodemailer from "nodemailer";
import type { Mailer } from "./providers";

/** The server's SMTP transport, or null when SMTP_HOST is not configured. */
export function mailerFromEnv(env: NodeJS.ProcessEnv = process.env): Mailer | null {
  if (!env.SMTP_HOST) return null;
  return nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: parseInt(env.SMTP_PORT || "587", 10),
    secure: env.SMTP_PORT === "465",
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
  }) as unknown as Mailer;
}
