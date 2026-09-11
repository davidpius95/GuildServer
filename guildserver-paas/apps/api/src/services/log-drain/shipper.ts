/**
 * Buffers drain records and ships them to one endpoint in batches.
 *
 * Memory is bounded: past the buffer limits new records are dropped and
 * counted, never queued. A failing endpoint is retried with exponential
 * backoff while records keep their order. Error messages name the endpoint's
 * host only, because paths and query strings often carry ingest tokens.
 */
import { UnsafeUrlError, assertSafeOutboundUrl, type Resolver } from "../../utils/outbound-url";
import type { DrainRecord } from "./records";

export const LOG_DRAIN_OUTBOUND_POLICY = {
  allowPrivateEnv: "GS_LOG_DRAIN_ALLOW_PRIVATE_ENDPOINTS",
  allowLoopbackEnv: "GS_LOG_DRAIN_ALLOW_LOOPBACK_ENDPOINTS",
};

export const DRAIN_FORMATS = ["json", "ndjson"] as const;
export type DrainFormat = (typeof DRAIN_FORMATS)[number];

export interface DrainTarget {
  url: string;
  headers: Record<string, string>;
  format: DrainFormat;
}

export interface ShipperDeps {
  fetch: typeof fetch;
  env: NodeJS.ProcessEnv;
  resolve?: Resolver;
  now?: () => number;
  timeoutMs?: number;
}

export interface ShipperLimits {
  maxBatchRecords: number;
  maxBatchBytes: number;
  maxBufferedRecords: number;
  maxBufferedBytes: number;
  initialBackoffMs: number;
  maxBackoffMs: number;
  /** How long a passed endpoint safety check is trusted before resolving again. */
  endpointCheckTtlMs: number;
}

export const DEFAULT_SHIPPER_LIMITS: ShipperLimits = {
  maxBatchRecords: 500,
  maxBatchBytes: 512 * 1024,
  maxBufferedRecords: 10_000,
  maxBufferedBytes: 8 * 1024 * 1024,
  initialBackoffMs: 1_000,
  maxBackoffMs: 60_000,
  endpointCheckTtlMs: 60_000,
};

/** What happened since the previous report. */
export interface ShipperReport {
  ok: boolean;
  error: string | null;
  sent: number;
  dropped: number;
  at: Date;
}

export class DrainDeliveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DrainDeliveryError";
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "the drain endpoint";
  }
}

export async function postBatch(target: DrainTarget, records: DrainRecord[], deps: ShipperDeps): Promise<void> {
  const ndjson = target.format === "ndjson";
  const body = ndjson ? `${records.map((record) => JSON.stringify(record)).join("\n")}\n` : JSON.stringify(records);
  const host = hostOf(target.url);
  let response: Response;
  try {
    response = await deps.fetch(target.url, {
      method: "POST",
      headers: {
        ...target.headers,
        "Content-Type": ndjson ? "application/x-ndjson" : "application/json",
        "User-Agent": "GuildServer-LogDrain/1.0",
      },
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(deps.timeoutMs ?? 10_000),
    });
  } catch (error: any) {
    const timedOut = error?.name === "TimeoutError" || error?.name === "AbortError";
    throw new DrainDeliveryError(`${host} ${timedOut ? "timed out" : "could not be reached"}`);
  }
  // Release the connection; the response body is never used.
  void (response as any).body?.cancel?.().catch?.(() => undefined);
  if (response.status >= 200 && response.status < 300) return;
  if (response.status >= 300 && response.status < 400) {
    throw new DrainDeliveryError(`${host} answered with a redirect (HTTP ${response.status}), which is not followed`);
  }
  throw new DrainDeliveryError(`${host} answered HTTP ${response.status}`);
}

interface Entry {
  record: DrainRecord;
  bytes: number;
}

export class DrainShipper {
  private queue: Entry[] = [];
  private queuedBytes = 0;
  private sentSinceReport = 0;
  private droppedSinceReport = 0;
  private failures = 0;
  private nextAttemptAt = 0;
  private endpointCheckedAt = Number.NEGATIVE_INFINITY;
  private lastOk: boolean | null = null;
  private lastError: string | null = null;
  private flushing: Promise<void> | null = null;
  private timer: NodeJS.Timeout | null = null;
  private readonly limits: ShipperLimits;

  constructor(
    readonly target: DrainTarget,
    private readonly deps: ShipperDeps,
    limits: Partial<ShipperLimits> = {},
    private readonly onReport: (report: ShipperReport) => void = () => undefined,
  ) {
    this.limits = { ...DEFAULT_SHIPPER_LIMITS, ...limits };
  }

  get buffered(): number {
    return this.queue.length;
  }

  enqueue(record: DrainRecord): void {
    const bytes = Buffer.byteLength(JSON.stringify(record));
    if (this.queue.length >= this.limits.maxBufferedRecords || this.queuedBytes + bytes > this.limits.maxBufferedBytes) {
      this.droppedSinceReport++;
      return;
    }
    this.queue.push({ record, bytes });
    this.queuedBytes += bytes;
  }

  start(intervalMs = 2_000): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.flush(), intervalMs);
    this.timer.unref?.();
  }

  /** Stop the timer and make one last attempt, ignoring any backoff. */
  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.flushing) await this.flushing;
    this.nextAttemptAt = 0;
    await this.flush();
  }

  flush(): Promise<void> {
    if (!this.flushing) {
      this.flushing = this.drain().finally(() => {
        this.flushing = null;
      });
    }
    return this.flushing;
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  private async drain(): Promise<void> {
    if (this.now() < this.nextAttemptAt) {
      this.report();
      return;
    }
    while (this.queue.length > 0) {
      const batch = this.nextBatch();
      try {
        await this.checkEndpoint();
        await postBatch(this.target, batch.map((entry) => entry.record), this.deps);
      } catch (error) {
        this.failures++;
        this.nextAttemptAt = this.now() + Math.min(this.limits.initialBackoffMs * 2 ** (this.failures - 1), this.limits.maxBackoffMs);
        this.lastOk = false;
        this.lastError =
          error instanceof DrainDeliveryError || error instanceof UnsafeUrlError ? error.message : "Unexpected error while shipping logs";
        this.report(true);
        return;
      }
      // Records enqueued during the request were appended, so the batch is still at the front.
      this.queue.splice(0, batch.length);
      this.queuedBytes -= batch.reduce((total, entry) => total + entry.bytes, 0);
      this.sentSinceReport += batch.length;
      this.failures = 0;
      this.nextAttemptAt = 0;
      this.lastOk = true;
      this.lastError = null;
    }
    this.report();
  }

  private nextBatch(): Entry[] {
    const batch: Entry[] = [];
    let bytes = 0;
    for (const entry of this.queue) {
      if (batch.length >= this.limits.maxBatchRecords) break;
      if (batch.length > 0 && bytes + entry.bytes > this.limits.maxBatchBytes) break;
      batch.push(entry);
      bytes += entry.bytes;
    }
    return batch;
  }

  private async checkEndpoint(): Promise<void> {
    if (this.now() - this.endpointCheckedAt < this.limits.endpointCheckTtlMs) return;
    await assertSafeOutboundUrl(this.target.url, LOG_DRAIN_OUTBOUND_POLICY, this.deps.env, this.deps.resolve);
    this.endpointCheckedAt = this.now();
  }

  private report(force = false): void {
    if (!force && this.sentSinceReport === 0 && this.droppedSinceReport === 0) return;
    const report: ShipperReport = {
      ok: this.lastOk !== false,
      error: this.lastError,
      sent: this.sentSinceReport,
      dropped: this.droppedSinceReport,
      at: new Date(this.now()),
    };
    this.sentSinceReport = 0;
    this.droppedSinceReport = 0;
    try {
      this.onReport(report);
    } catch {
      // Reporting must never interrupt shipping.
    }
  }
}
