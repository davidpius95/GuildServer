import crypto from "crypto";

// Symmetric encryption for secrets at rest (registry credentials, env vars, …).
// Uses the same scheme/key as the environment-variable encryption so a single
// ENV_ENCRYPTION_KEY governs all stored secrets.
const ENCRYPTION_KEY =
  process.env.ENV_ENCRYPTION_KEY || "dev-encryption-key-32-chars-long!";

function key(): Buffer {
  return Buffer.from(ENCRYPTION_KEY.padEnd(32).slice(0, 32));
}

/** Encrypt a secret. Returns "iv:ciphertext" (hex). Empty/undefined passes through. */
export function encryptSecret(text: string | null | undefined): string | null {
  if (!text) return text ?? null;
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-cbc", key(), iv);
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  return iv.toString("hex") + ":" + encrypted;
}

/**
 * Decrypt a value produced by encryptSecret. Returns the input unchanged if it
 * isn't in the expected format or can't be decrypted (e.g. legacy plaintext).
 */
export function decryptSecret(text: string | null | undefined): string | null {
  if (!text) return text ?? null;
  try {
    const [ivHex, encrypted] = text.split(":");
    if (!ivHex || !encrypted) return text;
    const iv = Buffer.from(ivHex, "hex");
    if (iv.length !== 16) return text;
    const decipher = crypto.createDecipheriv("aes-256-cbc", key(), iv);
    let decrypted = decipher.update(encrypted, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch {
    return text;
  }
}
