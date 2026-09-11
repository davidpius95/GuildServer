/**
 * Safety checks for outbound requests whose destination a tenant chooses:
 * S3 endpoints, notification webhooks, anything else the server will connect
 * to on a customer's say-so.
 *
 * Loopback, link-local (including the 169.254.169.254 metadata address) and
 * unspecified addresses are always refused. Private ranges are refused unless
 * the policy's allow-private variable is "1"; loopback additionally needs the
 * allow-loopback variable, and exists for test rigs. The hostname is resolved
 * here; a determined DNS-rebinding attacker could still race the lookup, so
 * this is a strong default, not a substitute for network egress policy.
 */
import { lookup } from "dns/promises";
import { isIP } from "net";

export type AddressClass = "loopback" | "link-local" | "private" | "unspecified" | "public";

export type Resolver = (host: string) => Promise<Array<{ address: string }>>;

export interface OutboundPolicy {
  /** Environment variable that, set to "1", allows private addresses. */
  allowPrivateEnv: string;
  /** Environment variable that, set to "1" alongside allowPrivateEnv, allows loopback. */
  allowLoopbackEnv: string;
}

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeUrlError";
  }
}

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((n, part) => (n << 8) + Number(part), 0) >>> 0;
}

function inCidr(ip: string, base: string, bits: number): boolean {
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(base) & mask);
}

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

const defaultResolve: Resolver = (host) => lookup(host, { all: true });

export async function assertSafeOutboundUrl(
  endpoint: string,
  policy: OutboundPolicy,
  env: NodeJS.ProcessEnv = process.env,
  resolve: Resolver = defaultResolve,
): Promise<void> {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new UnsafeUrlError("Endpoint must be a valid URL");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new UnsafeUrlError("Endpoint must use http or https");
  }
  if (url.username || url.password) {
    throw new UnsafeUrlError("Endpoint must not embed credentials");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host) ? [{ address: host }] : await resolve(host).catch(() => {
    throw new UnsafeUrlError("Endpoint hostname could not be resolved");
  });
  if (addresses.length === 0) throw new UnsafeUrlError("Endpoint hostname could not be resolved");

  const allowPrivate = env[policy.allowPrivateEnv] === "1";
  for (const { address } of addresses) {
    const kind = classifyAddress(address);
    if (kind === "loopback" || kind === "link-local" || kind === "unspecified") {
      if (!(allowPrivate && env[policy.allowLoopbackEnv] === "1" && kind === "loopback")) {
        throw new UnsafeUrlError(`Endpoint resolves to a ${kind} address, which is not allowed`);
      }
    }
    if (kind === "private" && !allowPrivate) {
      throw new UnsafeUrlError("Endpoint resolves to a private address; an operator must allow private endpoints");
    }
  }
}
