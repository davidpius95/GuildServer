/**
 * SSH host-key pinning for remote Docker hosts.
 *
 * Fingerprints use OpenSSH's format ("SHA256:" + unpadded base64 of the
 * SHA-256 of the raw public key), so an operator can compare them with
 * `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` on the server.
 */
import { createHash } from "crypto";
import { Client, type ConnectConfig } from "ssh2";

export const FINGERPRINT_PATTERN = /^SHA256:[A-Za-z0-9+/]{43}$/;

export function sshFingerprint(rawPublicKey: Buffer): string {
  return `SHA256:${createHash("sha256").update(rawPublicKey).digest("base64").replace(/=+$/, "")}`;
}

/**
 * An ssh2 `hostVerifier` that accepts only the pinned key. With nothing pinned
 * it accepts any key (trust on first use) and reports what it saw.
 */
export function pinnedHostVerifier(expected: string | undefined, seen?: (fingerprint: string) => void) {
  return (key: Buffer): boolean => {
    const fingerprint = sshFingerprint(key);
    seen?.(fingerprint);
    return !expected || fingerprint === expected;
  };
}

export interface SshProbeResult {
  /** A TCP connection was made and the server spoke SSH. */
  reachable: boolean;
  /** The host key was accepted and authentication succeeded. */
  authenticated: boolean;
  /** Fingerprint of the key the server presented, if it got that far. */
  fingerprint?: string;
  /** The server presented a key other than the pinned one. */
  keyMismatch: boolean;
  error?: string;
}

/** Connect, verify the host key, authenticate, disconnect. Never throws. */
export function probeSsh(
  config: Pick<ConnectConfig, "host" | "port" | "username" | "privateKey" | "password"> & {
    expectedFingerprint?: string;
    timeoutMs?: number;
  },
): Promise<SshProbeResult> {
  return new Promise((resolve) => {
    let fingerprint: string | undefined;
    let settled = false;
    const client = new Client();
    const finish = (result: Omit<SshProbeResult, "fingerprint">) => {
      if (settled) return;
      settled = true;
      client.end();
      resolve({ ...result, fingerprint });
    };

    client.on("ready", () => finish({ reachable: true, authenticated: true, keyMismatch: false }));
    client.on("error", (error: Error & { level?: string }) => {
      const mismatch = Boolean(config.expectedFingerprint && fingerprint && fingerprint !== config.expectedFingerprint);
      if (mismatch) {
        finish({ reachable: true, authenticated: false, keyMismatch: true, error: "The server presented a different SSH host key than the pinned one" });
      } else if (fingerprint || error.level === "client-authentication") {
        finish({ reachable: true, authenticated: false, keyMismatch: false, error: "SSH authentication failed" });
      } else {
        finish({ reachable: false, authenticated: false, keyMismatch: false, error: "Could not reach an SSH server at that address" });
      }
    });

    try {
      client.connect({
        host: config.host,
        port: config.port,
        username: config.username,
        privateKey: config.privateKey,
        password: config.password,
        readyTimeout: config.timeoutMs ?? 15_000,
        hostVerifier: pinnedHostVerifier(config.expectedFingerprint, (seen) => {
          fingerprint = seen;
        }),
      });
    } catch {
      finish({ reachable: false, authenticated: false, keyMismatch: false, error: "Invalid SSH connection settings" });
    }
  });
}
