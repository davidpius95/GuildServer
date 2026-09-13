import { createHmac, timingSafeEqual } from "node:crypto";
import type { Request } from "express";

export function verifyFlutterwaveSignature(req: Request): boolean {
  const secret = process.env.FLW_V4_WEBHOOK_SECRET_HASH;
  if (!secret) return false;
  const signature = req.header("flutterwave-signature");
  const raw = (req as Request & { rawBody?: Buffer }).rawBody;
  const expected = signature ? (raw ? createHmac("sha256", secret).update(raw).digest("base64") : "") : secret;
  const supplied = signature ?? req.header("verif-hash");
  if (!expected || !supplied) return false;
  const a = Buffer.from(expected), b = Buffer.from(supplied);
  return a.length === b.length && timingSafeEqual(a, b);
}
