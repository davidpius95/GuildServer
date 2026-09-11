/**
 * Which addresses a remote Docker provider may point at.
 *
 * Remote Docker hosts routinely sit on a LAN or VPN, so private ranges are
 * allowed. Loopback, link-local (including cloud metadata at 169.254.169.254)
 * and unspecified addresses are not: they would aim the platform at itself.
 * GS_REMOTE_DOCKER_ALLOW_LOOPBACK=1 exists for test rigs.
 */
import { lookup } from "dns/promises";
import { isIP } from "net";
import { classifyAddress, type Resolver } from "../utils/outbound-url";

export class RemoteHostError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RemoteHostError";
  }
}

const HOSTNAME = /^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/;

export function normalizeRemoteHost(host: string): string {
  return host.trim().replace(/^\[|\]$/g, "");
}

export async function assertRemoteHostAllowed(
  rawHost: string,
  env: NodeJS.ProcessEnv = process.env,
  resolve: Resolver = (host) => lookup(host, { all: true }),
): Promise<void> {
  const host = normalizeRemoteHost(rawHost);
  if (!isIP(host) && !HOSTNAME.test(host)) {
    throw new RemoteHostError("Host must be an IP address or a hostname");
  }
  const addresses = isIP(host)
    ? [{ address: host }]
    : await resolve(host).catch(() => {
        throw new RemoteHostError("Host name could not be resolved");
      });
  if (addresses.length === 0) throw new RemoteHostError("Host name could not be resolved");

  for (const { address } of addresses) {
    const kind = classifyAddress(address);
    if (kind === "loopback" && env.GS_REMOTE_DOCKER_ALLOW_LOOPBACK === "1") continue;
    if (kind === "loopback" || kind === "link-local" || kind === "unspecified") {
      throw new RemoteHostError(`Host resolves to a ${kind} address, which is not allowed for a remote Docker host`);
    }
  }
}
