/**
 * S3-compatible object storage for off-site database backups.
 *
 * Credentials are stored encrypted and decrypted only at the moment a client
 * is built. Endpoints are chosen by tenants, and the server connects to them,
 * so every endpoint is checked before use: a tenant must not be able to point
 * the platform at loopback, link-local metadata services, or (unless the
 * operator allows it) private addresses on the host's network.
 */
import { createReadStream, createWriteStream } from "fs";
import { lookup } from "dns/promises";
import { isIP } from "net";
import { randomUUID } from "crypto";
import { pipeline } from "stream/promises";
import type { Readable } from "stream";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { decryptSecret } from "../../utils/crypto";

export interface StorageConfig {
  endpoint: string;
  region: string;
  bucket: string;
  pathPrefix?: string | null;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}

export class StorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StorageError";
  }
}

/** Build a usable config from a stored row, decrypting its credentials. */
export function configFromRow(row: {
  endpoint: string;
  region: string;
  bucket: string;
  pathPrefix: string | null;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}): StorageConfig {
  const accessKeyId = decryptSecret(row.accessKeyId);
  const secretAccessKey = decryptSecret(row.secretAccessKey);
  if (!accessKeyId || !secretAccessKey) {
    throw new StorageError("Storage credentials could not be decrypted");
  }
  return { ...row, accessKeyId, secretAccessKey };
}

// ---------------------------------------------------------------------------
// Endpoint safety
// ---------------------------------------------------------------------------

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((n, part) => (n << 8) + Number(part), 0) >>> 0;
}

function inCidr(ip: string, base: string, bits: number): boolean {
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(base) & mask);
}

export type AddressClass = "loopback" | "link-local" | "private" | "unspecified" | "public";

export function classifyAddress(address: string): AddressClass {
  const ip = address.startsWith("::ffff:") && isIP(address.slice(7)) === 4 ? address.slice(7) : address;
  if (isIP(ip) === 4) {
    if (inCidr(ip, "127.0.0.0", 8)) return "loopback";
    if (inCidr(ip, "0.0.0.0", 8)) return "unspecified";
    if (inCidr(ip, "169.254.0.0", 16)) return "link-local";
    if (inCidr(ip, "10.0.0.0", 8) || inCidr(ip, "172.16.0.0", 12) || inCidr(ip, "192.168.0.0", 16) || inCidr(ip, "100.64.0.0", 10)) {
      return "private";
    }
    return "public";
  }
  const lower = ip.toLowerCase();
  if (lower === "::1") return "loopback";
  if (lower === "::") return "unspecified";
  if (lower.startsWith("fe80:")) return "link-local";
  if (lower.startsWith("fc") || lower.startsWith("fd")) return "private";
  return "public";
}

/**
 * Refuse endpoints that would let a tenant reach services on or near the host.
 *
 * Loopback, link-local (including the 169.254.169.254 metadata address) and
 * unspecified addresses are always refused. Private ranges are refused unless
 * GS_S3_ALLOW_PRIVATE_ENDPOINTS=1, which an operator running MinIO on their own
 * LAN can set. The hostname is resolved here; a determined DNS-rebinding
 * attacker could still race the lookup, so this is a strong default, not a
 * substitute for network egress policy.
 */
export async function assertSafeEndpoint(
  endpoint: string,
  env: NodeJS.ProcessEnv = process.env,
  resolve: (host: string) => Promise<Array<{ address: string }>> = (host) => lookup(host, { all: true }),
): Promise<void> {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new StorageError("Endpoint must be a valid URL");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new StorageError("Endpoint must use http or https");
  }
  if (url.username || url.password) {
    throw new StorageError("Endpoint must not embed credentials");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host) ? [{ address: host }] : await resolve(host).catch(() => {
    throw new StorageError("Endpoint hostname could not be resolved");
  });
  if (addresses.length === 0) throw new StorageError("Endpoint hostname could not be resolved");

  const allowPrivate = env.GS_S3_ALLOW_PRIVATE_ENDPOINTS === "1";
  for (const { address } of addresses) {
    const kind = classifyAddress(address);
    if (kind === "loopback" || kind === "link-local" || kind === "unspecified") {
      if (!(allowPrivate && env.GS_S3_ALLOW_LOOPBACK_ENDPOINTS === "1" && kind === "loopback")) {
        throw new StorageError(`Endpoint resolves to a ${kind} address, which is not allowed`);
      }
    }
    if (kind === "private" && !allowPrivate) {
      throw new StorageError("Endpoint resolves to a private address; an operator must allow private endpoints");
    }
  }
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

export function clientFor(cfg: StorageConfig): S3Client {
  return new S3Client({
    endpoint: cfg.endpoint,
    region: cfg.region || "us-east-1",
    forcePathStyle: cfg.forcePathStyle,
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
    // Recent SDKs add CRC32 checksums to every request by default, which many
    // S3-compatible servers reject. Only send them where the API requires it.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
}

/** Join the configured prefix and key parts, refusing anything path-like. */
export function objectKey(cfg: Pick<StorageConfig, "pathPrefix">, ...parts: string[]): string {
  for (const part of parts) {
    if (!part || part.includes("..") || part.startsWith("/") || /[\x00-\x1f]/.test(part)) {
      throw new StorageError(`Invalid object key part: ${JSON.stringify(part)}`);
    }
  }
  const prefix = (cfg.pathPrefix ?? "").replace(/^\/+|\/+$/g, "");
  return [prefix, ...parts].filter(Boolean).join("/");
}

/** Say what went wrong without echoing credentials or signed URLs. */
export function describeStorageError(error: unknown): string {
  const e = error as any;
  const code = e?.Code || e?.name || "Error";
  const status = e?.$metadata?.httpStatusCode;
  const message = String(e?.message ?? error).replace(/X-Amz-[A-Za-z-]+=[^&\s]+/g, "X-Amz-…").slice(0, 300);
  return status ? `${code} (HTTP ${status}): ${message}` : `${code}: ${message}`;
}

export async function uploadFile(cfg: StorageConfig, key: string, filePath: string): Promise<void> {
  await assertSafeEndpoint(cfg.endpoint);
  const client = clientFor(cfg);
  try {
    // lib-storage switches to multipart for large bodies, so a dump of any size
    // streams from disk without being read into memory.
    await new Upload({
      client,
      params: { Bucket: cfg.bucket, Key: key, Body: createReadStream(filePath), ContentType: "application/octet-stream" },
      queueSize: 2,
      partSize: 16 * 1024 * 1024,
    }).done();
  } finally {
    client.destroy();
  }
}

export async function downloadToFile(cfg: StorageConfig, key: string, destPath: string): Promise<void> {
  await assertSafeEndpoint(cfg.endpoint);
  const client = clientFor(cfg);
  try {
    const out = await client.send(new GetObjectCommand({ Bucket: cfg.bucket, Key: key }));
    if (!out.Body) throw new StorageError("Object has no body");
    await pipeline(out.Body as Readable, createWriteStream(destPath));
  } finally {
    client.destroy();
  }
}

export async function deleteObject(cfg: StorageConfig, key: string): Promise<void> {
  await assertSafeEndpoint(cfg.endpoint);
  const client = clientFor(cfg);
  try {
    await client.send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: key }));
  } finally {
    client.destroy();
  }
}

/** Write, read back and delete a small object: proves credentials, bucket and permissions. */
export async function testStorage(cfg: StorageConfig): Promise<{ ok: true } | { ok: false; error: string }> {
  let client: S3Client | null = null;
  try {
    await assertSafeEndpoint(cfg.endpoint);
    client = clientFor(cfg);
    const key = objectKey(cfg, `.guildserver-connection-test-${randomUUID()}`);
    await client.send(new PutObjectCommand({ Bucket: cfg.bucket, Key: key, Body: "guildserver connection test" }));
    await client.send(new HeadObjectCommand({ Bucket: cfg.bucket, Key: key }));
    await client.send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: key }));
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof StorageError ? error.message : describeStorageError(error) };
  } finally {
    client?.destroy();
  }
}
