/**
 * Keeps one log follower per (drain, running container) and routes each line
 * to the drain's shipper.
 *
 * Every reconcile re-reads the enabled drains, attaches to containers that
 * carry the drained resource's label, and detaches from containers that are
 * gone or whose drain was removed. New followers start at "now" so enabling a
 * drain does not replay history; a follower that ends (container restarted)
 * resumes from the last second it saw, so a line may occasionally be sent
 * twice but is not lost.
 */
import { PassThrough } from "stream";
import { GS_LABELS } from "../docker/client";
import { logger } from "../../utils/logger";
import { LineSplitter, splitTimestamp, timestampSeconds, type ResourceType } from "./records";
import { DrainShipper, type DrainTarget, type ShipperDeps, type ShipperLimits, type ShipperReport } from "./shipper";

export interface DrainSpec {
  id: string;
  organizationId: string;
  resourceType: ResourceType;
  resourceId: string;
  resourceName: string;
  target: DrainTarget;
}

interface ContainerSummary {
  Id: string;
  Names?: string[];
  Labels?: Record<string, string>;
}

interface LogStream extends NodeJS.ReadableStream {
  destroy?: () => void;
}

export interface DockerLike {
  listContainers(options: Record<string, unknown>): Promise<ContainerSummary[]>;
  getContainer(id: string): {
    inspect(): Promise<{ Name?: string; Config?: { Tty?: boolean } }>;
    logs(options: Record<string, unknown>): Promise<NodeJS.ReadableStream>;
  };
  modem: { demuxStream(stream: NodeJS.ReadableStream, stdout: NodeJS.WritableStream, stderr: NodeJS.WritableStream): void };
}

export interface ManagerDeps {
  docker: DockerLike;
  loadDrains(): Promise<DrainSpec[]>;
  saveReport(drainId: string, report: ShipperReport): Promise<void>;
  shipperDeps: ShipperDeps;
  limits?: Partial<ShipperLimits>;
  maxFollowers?: number;
  /** Shipper flush interval; 0 disables timers (tests flush explicitly). */
  flushIntervalMs?: number;
  /** Minimum time between status writes for one drain. */
  reportIntervalMs?: number;
  now?: () => number;
}

interface Follower {
  drainId: string;
  stream: LogStream;
}

interface ReportState {
  pending: ShipperReport | null;
  lastWriteAt: number;
  lastOk: boolean | null;
}

const DEFAULT_MAX_FOLLOWERS = 200;
const LAST_SEEN_TTL_MS = 24 * 60 * 60 * 1000;

export function resourceLabel(type: ResourceType): string {
  return type === "application" ? GS_LABELS.APP_ID : GS_LABELS.SERVICE_ID;
}

export class LogDrainManager {
  private shippers = new Map<string, { spec: DrainSpec; shipper: DrainShipper; fingerprint: string }>();
  private followers = new Map<string, Follower>();
  private lastSeen = new Map<string, { seconds: number; at: number }>();
  private reports = new Map<string, ReportState>();
  private reconciling: Promise<void> | null = null;
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly deps: ManagerDeps) {}

  get followerCount(): number {
    return this.followers.size;
  }

  start(intervalMs = 30_000): void {
    if (this.timer) return;
    void this.reconcile();
    this.timer = setInterval(() => void this.reconcile(), intervalMs);
    this.timer.unref?.();
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.reconciling) await this.reconciling.catch(() => undefined);
    for (const [key, follower] of Array.from(this.followers)) this.unfollow(key, follower);
    await Promise.all(Array.from(this.shippers.values()).map((entry) => entry.shipper.stop().catch(() => undefined)));
    this.shippers.clear();
    await this.writePendingReports();
  }

  /** Ship everything buffered now. */
  async flush(): Promise<void> {
    await Promise.all(Array.from(this.shippers.values()).map((entry) => entry.shipper.flush()));
  }

  reconcile(): Promise<void> {
    if (!this.reconciling) {
      this.reconciling = this.run().finally(() => {
        this.reconciling = null;
      });
    }
    return this.reconciling;
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  private async run(): Promise<void> {
    let specs: DrainSpec[];
    try {
      specs = await this.deps.loadDrains();
    } catch (error: any) {
      logger.warn(`Log drains: could not load drains: ${error?.message}`);
      return;
    }

    const live = new Set(specs.map((spec) => spec.id));
    for (const [id, entry] of Array.from(this.shippers)) {
      if (live.has(id)) continue;
      // Drain removed or disabled: stop following, ship what is buffered.
      this.dropFollowersOf(id);
      this.shippers.delete(id);
      await entry.shipper.stop().catch(() => undefined);
    }

    const wanted = new Set<string>();
    for (const spec of specs) {
      this.shipperFor(spec);
      const label = resourceLabel(spec.resourceType);
      let containers: ContainerSummary[];
      try {
        containers = await this.deps.docker.listContainers({
          filters: { label: [`${label}=${spec.resourceId}`], status: ["running"] },
        });
      } catch (error: any) {
        logger.warn(`Log drains: could not list containers for drain ${spec.id}: ${error?.message}`);
        // A transient Docker error must not tear down healthy followers.
        for (const [key, follower] of Array.from(this.followers)) if (follower.drainId === spec.id) wanted.add(key);
        continue;
      }

      for (const info of containers) {
        // The filter is exact; this is defence in depth against ever following
        // a container that belongs to a different resource.
        if (info.Labels?.[label] !== spec.resourceId) continue;
        const key = `${spec.id}:${info.Id}`;
        wanted.add(key);
        if (this.followers.has(key)) continue;
        if (this.followers.size >= (this.deps.maxFollowers ?? DEFAULT_MAX_FOLLOWERS)) {
          logger.warn(`Log drains: follower limit reached; not following container ${info.Id.slice(0, 12)} for drain ${spec.id}`);
          continue;
        }
        try {
          await this.follow(spec, info, key);
        } catch (error: any) {
          logger.warn(`Log drains: could not follow container ${info.Id.slice(0, 12)} for drain ${spec.id}: ${error?.message}`);
        }
      }
    }

    for (const [key, follower] of Array.from(this.followers)) {
      if (!wanted.has(key)) this.unfollow(key, follower);
    }
    const cutoff = this.now() - LAST_SEEN_TTL_MS;
    for (const [key, seen] of Array.from(this.lastSeen)) {
      if (!live.has(key.split(":")[0]) || seen.at < cutoff) this.lastSeen.delete(key);
    }
  }

  private shipperFor(spec: DrainSpec): DrainShipper {
    const fingerprint = JSON.stringify(spec.target);
    const existing = this.shippers.get(spec.id);
    if (existing && existing.fingerprint === fingerprint) {
      existing.spec = spec;
      return existing.shipper;
    }
    if (existing) void existing.shipper.stop().catch(() => undefined);

    const shipper = new DrainShipper(spec.target, this.deps.shipperDeps, this.deps.limits, (report) => this.onReport(spec.id, report));
    const interval = this.deps.flushIntervalMs ?? 2_000;
    if (interval > 0) shipper.start(interval);
    this.shippers.set(spec.id, { spec, shipper, fingerprint });
    return shipper;
  }

  private async follow(spec: DrainSpec, info: ContainerSummary, key: string): Promise<void> {
    const container = this.deps.docker.getContainer(info.Id);
    const details = await container.inspect();
    const since = this.lastSeen.get(key)?.seconds ?? Math.floor(this.now() / 1000);
    const stream = (await container.logs({ follow: true, stdout: true, stderr: true, timestamps: true, since })) as LogStream;

    const containerRef = {
      id: info.Id.slice(0, 12),
      name: String(details?.Name ?? info.Names?.[0] ?? "").replace(/^\//, ""),
    };
    const drainId = spec.id;
    const splitter = (streamName: "stdout" | "stderr") =>
      new LineSplitter((line) => {
        // Looked up per line, so a replaced shipper or renamed resource applies at once.
        const entry = this.shippers.get(drainId);
        if (!entry) return;
        const { timestamp, message } = splitTimestamp(line, () => this.now());
        this.lastSeen.set(key, { seconds: timestampSeconds(timestamp) ?? Math.floor(this.now() / 1000), at: this.now() });
        entry.shipper.enqueue({
          timestamp,
          message,
          stream: streamName,
          resource: { type: entry.spec.resourceType, id: entry.spec.resourceId, name: entry.spec.resourceName },
          container: containerRef,
          source: "guildserver",
        });
      });
    const stdout = splitter("stdout");
    const stderr = splitter("stderr");

    if (details?.Config?.Tty) {
      // A TTY container's log stream is raw, not multiplexed.
      stream.on("data", (chunk: Buffer) => stdout.push(chunk));
    } else {
      const out = new PassThrough();
      const err = new PassThrough();
      out.on("data", (chunk: Buffer) => stdout.push(chunk));
      err.on("data", (chunk: Buffer) => stderr.push(chunk));
      this.deps.docker.modem.demuxStream(stream, out, err);
    }

    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      stdout.flush();
      stderr.flush();
      if (this.followers.get(key)?.stream === stream) this.followers.delete(key);
    };
    stream.on("end", finish);
    stream.on("close", finish);
    stream.on("error", (error: any) => {
      logger.debug(`Log drains: stream for ${containerRef.id} ended with error: ${error?.message}`);
      finish();
    });
    this.followers.set(key, { drainId, stream });
  }

  private unfollow(key: string, follower: Follower): void {
    this.followers.delete(key);
    try {
      follower.stream.destroy?.();
    } catch {
      // Already closed.
    }
  }

  private dropFollowersOf(drainId: string): void {
    for (const [key, follower] of Array.from(this.followers)) {
      if (follower.drainId === drainId) this.unfollow(key, follower);
    }
  }

  private onReport(drainId: string, report: ShipperReport): void {
    const state = this.reports.get(drainId) ?? { pending: null, lastWriteAt: Number.NEGATIVE_INFINITY, lastOk: null };
    state.pending = state.pending
      ? { ...report, sent: state.pending.sent + report.sent, dropped: state.pending.dropped + report.dropped }
      : report;
    const now = this.now();
    if (state.lastOk !== report.ok || now - state.lastWriteAt >= (this.deps.reportIntervalMs ?? 15_000)) {
      const toWrite = state.pending;
      state.pending = null;
      state.lastWriteAt = now;
      state.lastOk = report.ok;
      this.deps.saveReport(drainId, toWrite).catch((error: any) => logger.warn(`Log drains: could not save status for ${drainId}: ${error?.message}`));
    }
    this.reports.set(drainId, state);
  }

  private async writePendingReports(): Promise<void> {
    for (const [drainId, state] of Array.from(this.reports)) {
      if (state.pending) await this.deps.saveReport(drainId, state.pending).catch(() => undefined);
    }
    this.reports.clear();
  }
}
