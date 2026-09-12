import http from "http";
import https from "https";
import { lookup } from "dns";
import { isIP } from "net";
import { classifyAddress } from "../utils/outbound-url";

/** Validate the address used by the socket itself, so a second DNS lookup cannot rebind to an internal host. */
export async function workflowHttp(urlText: string, options: { method?: string; headers?: Record<string, string>; body?: unknown }): Promise<number> {
  const url = new URL(urlText);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("Workflow HTTP requires an http(s) URL without embedded credentials.");
  const allowed = (address: string) => classifyAddress(address) === "public";
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) && !allowed(host)) throw new Error("Workflow HTTP cannot access private or local addresses.");
  const method = String(options.method || "GET").toUpperCase();
  if (!["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"].includes(method)) throw new Error("Unsupported HTTP method.");
  const body = !["GET", "HEAD"].includes(method) && options.body !== undefined ? JSON.stringify(options.body) : undefined;
  if (body && Buffer.byteLength(body) > 64 * 1024) throw new Error("Workflow request body is too large.");
  return new Promise((resolve, reject) => {
    const request = (url.protocol === "https:" ? https : http).request(url, {
      method, agent: false, headers: { "Content-Type": "application/json", ...options.headers },
      lookup: ((hostname: string, _options: { all?: boolean }, callback: (error: Error | null, address?: string | import("dns").LookupAddress[], family?: number) => void) => {
        lookup(hostname, { all: true }, (error, addresses) => {
          if (error) return callback(error);
          if (!addresses.length || addresses.some(a => !allowed(a.address))) return callback(new Error("Workflow HTTP cannot access private or local addresses."));
          // The selected validated address is handed directly to the socket.
          if (_options.all) callback(null, addresses);
          else callback(null, addresses[0].address, addresses[0].family);
        });
      }) as import("net").LookupFunction,
    }, response => {
      // No redirects and no unbounded response buffering.
      const status = response.statusCode || 0;
      response.destroy(); resolve(status);
    });
    const timer = setTimeout(() => request.destroy(new Error("Workflow HTTP timed out.")), 15000);
    request.once("close", () => clearTimeout(timer));
    request.once("error", () => reject(new Error("HTTP request failed. Check the public URL, DNS, and TLS certificate.")));
    request.end(body);
  });
}
