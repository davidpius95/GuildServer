/**
 * Validation and at-rest handling for docker-remote provider configuration.
 *
 * Private keys and passwords are encrypted before they are stored and are
 * never returned by the API. An update may omit them to keep what is stored.
 */
import { z } from "zod";
import { utils as sshUtils } from "ssh2";
import { decryptSecret, encryptSecret } from "../utils/crypto";
import { FINGERPRINT_PATTERN } from "./ssh-host-key";
import { RemoteHostError, assertRemoteHostAllowed, normalizeRemoteHost } from "./remote-host";
import type { Resolver } from "../utils/outbound-url";
import type { DockerRemoteConfig } from "./types";

export const DOCKER_REMOTE_SECRET_FIELDS = ["sshKey", "sshPassword", "tlsKey"] as const;

export class DockerRemoteConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DockerRemoteConfigError";
  }
}

const PEM_CERTIFICATE = /-----BEGIN CERTIFICATE-----[\s\S]+-----END CERTIFICATE-----/;
const PEM_PRIVATE_KEY = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]+-----END [A-Z ]*PRIVATE KEY-----/;

const schema = z
  .object({
    connectionType: z.enum(["ssh", "tls"]).default("ssh"),
    host: z.string().trim().min(1).max(255),
    // Optional: defaults to 22 for SSH and 2376 (Docker's TLS socket) for TLS.
    port: z.coerce.number().int().min(1).max(65535).optional(),
    sshUser: z.string().trim().regex(/^[A-Za-z_][A-Za-z0-9_.-]{0,31}$/, "Invalid SSH user name").optional(),
    sshKey: z.string().max(16_384).optional(),
    sshPassword: z.string().max(1_024).optional(),
    hostKeyFingerprint: z.string().trim().regex(FINGERPRINT_PATTERN, "Host key fingerprint must look like SHA256:<43 base64 characters>").optional(),
    tlsCa: z.string().max(16_384).optional(),
    tlsCert: z.string().max(16_384).optional(),
    tlsKey: z.string().max(16_384).optional(),
    manageProxy: z.boolean().default(false),
  })
  .strict();

type Raw = z.input<typeof schema>;

const blankToUndefined = (value: unknown) => (typeof value === "string" && value.trim() === "" ? undefined : value);

/**
 * Validate a submitted configuration and prepare it for storage.
 *
 * @param raw       What the admin submitted. Secret fields hold plaintext.
 * @param existing  The stored configuration when updating. Secret fields there
 *                  are already encrypted and are kept if `raw` omits them.
 */
export async function prepareDockerRemoteConfig(
  raw: unknown,
  existing?: Partial<DockerRemoteConfig> | null,
  options: { env?: NodeJS.ProcessEnv; resolve?: Resolver } = {},
): Promise<DockerRemoteConfig> {
  const submitted = Object.fromEntries(Object.entries((raw ?? {}) as Record<string, unknown>).map(([k, v]) => [k, blankToUndefined(v)])) as Raw;
  const parsed = schema.safeParse(submitted);
  if (!parsed.success) {
    throw new DockerRemoteConfigError(parsed.error.issues.map((issue) => `${issue.path.join(".") || "config"}: ${issue.message}`).join("; "));
  }
  const input = { ...parsed.data, port: parsed.data.port ?? (parsed.data.connectionType === "tls" ? 2376 : 22) };
  const host = normalizeRemoteHost(input.host);

  try {
    await assertRemoteHostAllowed(host, options.env, options.resolve);
  } catch (error) {
    if (error instanceof RemoteHostError) throw new DockerRemoteConfigError(error.message);
    throw error;
  }

  if (input.sshKey) {
    if (!PEM_PRIVATE_KEY.test(input.sshKey)) throw new DockerRemoteConfigError("sshKey: expected a PEM or OpenSSH private key");
    const parsedKey = sshUtils.parseKey(input.sshKey);
    if (parsedKey instanceof Error) {
      throw new DockerRemoteConfigError("sshKey: the private key could not be read (passphrase-protected keys are not supported)");
    }
  }
  if (input.tlsCa && !PEM_CERTIFICATE.test(input.tlsCa)) throw new DockerRemoteConfigError("tlsCa: expected a PEM certificate");
  if (input.tlsCert && !PEM_CERTIFICATE.test(input.tlsCert)) throw new DockerRemoteConfigError("tlsCert: expected a PEM certificate");
  if (input.tlsKey && !PEM_PRIVATE_KEY.test(input.tlsKey)) throw new DockerRemoteConfigError("tlsKey: expected a PEM private key");

  const sameEndpoint = existing && normalizeRemoteHost(String(existing.host ?? "")) === host && Number(existing.port) === input.port;

  const config: DockerRemoteConfig = {
    connectionType: input.connectionType,
    host,
    port: input.port,
    manageProxy: input.manageProxy,
  };

  if (input.connectionType === "ssh") {
    config.sshUser = input.sshUser;
    config.sshKey = input.sshKey ? encryptSecret(input.sshKey)! : existing?.sshKey;
    config.sshPassword = input.sshPassword ? encryptSecret(input.sshPassword)! : existing?.sshPassword;
    // A pin belongs to an address: moving the provider re-pins on first connection.
    config.hostKeyFingerprint = input.hostKeyFingerprint ?? (sameEndpoint ? existing?.hostKeyFingerprint : undefined);
    if (!config.sshUser) throw new DockerRemoteConfigError("sshUser: required for SSH connections");
    if (!config.sshKey && !config.sshPassword) throw new DockerRemoteConfigError("An SSH private key or password is required");
  } else {
    config.tlsCa = input.tlsCa ?? existing?.tlsCa;
    config.tlsCert = input.tlsCert ?? existing?.tlsCert;
    config.tlsKey = input.tlsKey ? encryptSecret(input.tlsKey)! : existing?.tlsKey;
    if (!config.tlsCa || !config.tlsCert || !config.tlsKey) {
      throw new DockerRemoteConfigError("TLS connections need tlsCa, tlsCert and tlsKey");
    }
  }

  return Object.fromEntries(Object.entries(config).filter(([, value]) => value !== undefined)) as unknown as DockerRemoteConfig;
}

/** The stored configuration with secrets decrypted, for building a client. */
export function decryptDockerRemoteConfig(stored: DockerRemoteConfig): DockerRemoteConfig {
  const config = { ...stored };
  for (const field of DOCKER_REMOTE_SECRET_FIELDS) {
    if (config[field]) config[field] = decryptSecret(config[field]) ?? undefined;
  }
  return config;
}
