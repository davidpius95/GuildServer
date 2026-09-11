/**
 * Turning a container's log output into drain records, and validating the
 * request headers a drain may send.
 */
export type ResourceType = "application" | "service";

export interface DrainRecord {
  /** RFC 3339 timestamp from Docker, nanosecond precision when available. */
  timestamp: string;
  message: string;
  stream: "stdout" | "stderr";
  resource: { type: ResourceType; id: string; name: string };
  container: { id: string; name: string };
  source: "guildserver";
}

/** Longer lines are truncated rather than buffered without bound. */
export const MAX_LINE_BYTES = 16 * 1024;
export const TRUNCATION_MARK = " …[truncated]";

/** Splits a byte stream into lines, carrying partial lines across chunks. */
export class LineSplitter {
  private pending: Buffer[] = [];
  private pendingBytes = 0;
  private truncated = false;

  constructor(
    private readonly onLine: (line: string) => void,
    private readonly maxBytes: number = MAX_LINE_BYTES,
  ) {}

  push(chunk: Buffer): void {
    let start = 0;
    for (;;) {
      const newline = chunk.indexOf(0x0a, start);
      this.append(chunk.subarray(start, newline === -1 ? chunk.length : newline));
      if (newline === -1) return;
      this.emit();
      start = newline + 1;
    }
  }

  /** Emit whatever partial line is left, e.g. when the stream ends. */
  flush(): void {
    if (this.pendingBytes > 0 || this.truncated) this.emit();
  }

  private append(part: Buffer): void {
    if (this.truncated || part.length === 0) return;
    const room = this.maxBytes - this.pendingBytes;
    if (part.length > room) {
      if (room > 0) {
        this.pending.push(part.subarray(0, room));
        this.pendingBytes += room;
      }
      this.truncated = true;
      return;
    }
    this.pending.push(part);
    this.pendingBytes += part.length;
  }

  private emit(): void {
    let line = Buffer.concat(this.pending, this.pendingBytes).toString("utf8");
    if (line.endsWith("\r")) line = line.slice(0, -1);
    if (this.truncated) line += TRUNCATION_MARK;
    this.pending = [];
    this.pendingBytes = 0;
    this.truncated = false;
    if (line.length > 0) this.onLine(line);
  }
}

const DOCKER_TIMESTAMP = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})) ?/;

/** Separate the timestamp Docker prefixes when `timestamps: true`. */
export function splitTimestamp(line: string, now: () => number = Date.now): { timestamp: string; message: string } {
  const match = DOCKER_TIMESTAMP.exec(line);
  if (!match) return { timestamp: new Date(now()).toISOString(), message: line };
  return { timestamp: match[1], message: line.slice(match[0].length) };
}

/** Unix seconds for a Docker timestamp, or null if it cannot be read. */
export function timestampSeconds(timestamp: string): number | null {
  const millis = Date.parse(timestamp.replace(/(\.\d{3})\d+/, "$1"));
  return Number.isFinite(millis) ? Math.floor(millis / 1000) : null;
}

export class DrainConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DrainConfigError";
  }
}

export const MAX_DRAIN_HEADERS = 10;
const HEADER_NAME = /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/;
// Set by GuildServer or by the HTTP stack; letting a tenant override them would
// break requests or smuggle a second one.
const RESERVED_HEADERS = new Set([
  "host",
  "content-length",
  "content-type",
  "transfer-encoding",
  "connection",
  "keep-alive",
  "upgrade",
  "te",
  "trailer",
  "expect",
  "user-agent",
  "proxy-authorization",
  "cookie",
]);

export function validateDrainHeaders(headers: Record<string, string>): void {
  const entries = Object.entries(headers);
  if (entries.length > MAX_DRAIN_HEADERS) {
    throw new DrainConfigError(`A log drain can send at most ${MAX_DRAIN_HEADERS} headers`);
  }
  const seen = new Set<string>();
  for (const [name, value] of entries) {
    if (!HEADER_NAME.test(name)) throw new DrainConfigError(`Invalid header name: ${JSON.stringify(name.slice(0, 64))}`);
    const lower = name.toLowerCase();
    if (RESERVED_HEADERS.has(lower)) throw new DrainConfigError(`The ${name} header is set by GuildServer and cannot be overridden`);
    if (seen.has(lower)) throw new DrainConfigError(`Duplicate header: ${name}`);
    seen.add(lower);
    if (typeof value !== "string" || value.length > 1024 || /[\r\n\0]/.test(value)) {
      throw new DrainConfigError(`Invalid value for header ${name}`);
    }
  }
}
