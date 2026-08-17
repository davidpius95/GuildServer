import crypto from "crypto";
import { eq, and } from "drizzle-orm";
import { db, instances, instanceTypes, computeProviders } from "@guildserver/database";
import { ProxmoxClient } from "./proxmox-client";
import type { ProxmoxConfig } from "../providers/types";
import { logger } from "../utils/logger";

function sanitizeHostname(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "instance"
  );
}

async function setStatus(
  instanceId: string,
  status: "pending" | "provisioning" | "active" | "stopped" | "error" | "terminated",
  extra: Partial<{ statusMessage: string; vmid: number; node: string; hostname: string; ipv4: string }> = {},
) {
  await db
    .update(instances)
    .set({ status, ...extra, updatedAt: new Date() })
    .where(eq(instances.id, instanceId));
}

/** Resolve the compute provider to provision on: the instance's provider, else the org's default. */
async function resolveProvider(instance: typeof instances.$inferSelect) {
  if (instance.providerId) {
    const p = await db.query.computeProviders.findFirst({ where: eq(computeProviders.id, instance.providerId) });
    if (p) return p;
  }
  if (!instance.organizationId) return null;
  return db.query.computeProviders.findFirst({
    where: and(
      eq(computeProviders.organizationId, instance.organizationId),
      eq(computeProviders.type, "proxmox"),
      eq(computeProviders.status, "connected"),
    ),
  });
}

function makeProxmoxClient(config: ProxmoxConfig): ProxmoxClient {
  return new ProxmoxClient({
    host: config.host,
    port: config.port || 8006,
    tokenId: config.tokenId,
    tokenSecret: config.tokenSecret,
    allowInsecure: true,
  });
}

/** Find a usable OS template (vztmpl) on the node, preferring Ubuntu/Debian. */
async function resolveTemplate(client: ProxmoxClient, node: string): Promise<string> {
  const storages = await client.listStorage(node);
  const tmplStorages = storages.filter((s) => (s.content || "").includes("vztmpl"));
  for (const s of tmplStorages) {
    const templates = await client.listTemplates(node, s.storage);
    if (templates.length === 0) continue;
    const preferred =
      templates.find((t) => /ubuntu/i.test(t.volid)) ||
      templates.find((t) => /debian/i.test(t.volid)) ||
      templates[0];
    if (preferred) return preferred.volid;
  }
  throw new Error("No LXC OS template (vztmpl) found on the Proxmox node. Upload one (e.g. Ubuntu 22.04) first.");
}

/**
 * Provision a VPS instance as a Proxmox LXC sized to its instance type.
 * Transitions the instance: provisioning → active (or error).
 */
export async function provisionInstance(instanceId: string): Promise<void> {
  const instance = await db.query.instances.findFirst({
    where: eq(instances.id, instanceId),
    with: { instanceType: true },
  });
  if (!instance) {
    logger.warn("provisionInstance: instance not found", { instanceId });
    return;
  }
  const type = (instance as any).instanceType as typeof instanceTypes.$inferSelect | undefined;
  if (!type) {
    await setStatus(instanceId, "error", { statusMessage: "Instance type not found" });
    return;
  }

  await setStatus(instanceId, "provisioning", { statusMessage: "Allocating resources…" });

  try {
    const provider = await resolveProvider(instance);
    if (!provider || provider.type !== "proxmox") {
      await setStatus(instanceId, "error", {
        statusMessage:
          "No connected Proxmox provider available to provision this instance. Connect one under Infrastructure.",
      });
      return;
    }

    const config = provider.config as unknown as ProxmoxConfig;
    const client = makeProxmoxClient(config);
    const node = config.node;
    const rootfsStorage = config.storage || "local-lvm";
    const bridge = config.bridge || "vmbr0";

    const ostemplate = await resolveTemplate(client, node);
    const vmid = await client.getNextVMID();
    const hostname = sanitizeHostname(instance.name);
    const rootPassword = crypto.randomBytes(18).toString("base64url");

    // Storage = base instance storage + any extra block storage purchased.
    const diskGb = type.storageGb + (instance.extraStorageGb || 0);

    await setStatus(instanceId, "provisioning", {
      statusMessage: `Creating LXC ${vmid} on ${node}…`,
      vmid,
      node,
    });

    await client.createLXC(node, {
      vmid,
      hostname,
      ostemplate,
      storage: rootfsStorage,
      rootfs: `${rootfsStorage}:${diskGb}`,
      memory: Math.round(type.ramMb),
      swap: 512,
      cores: Math.max(1, Math.round(Number(type.vcpu))),
      net0: `name=eth0,bridge=${bridge},ip=dhcp`,
      password: rootPassword,
      start: true,
      unprivileged: true,
      features: "nesting=1",
      onboot: true,
    });

    // Wait for the container to obtain an IP.
    let ip: string | null = null;
    for (let i = 0; i < 30 && !ip; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      try {
        ip = await getLxcIp(client, node, vmid);
      } catch {
        /* keep polling */
      }
    }

    await setStatus(instanceId, "active", {
      statusMessage: ip ? "Instance is running" : "Instance is running (IP pending)",
      vmid,
      node,
      hostname,
      ...(ip ? { ipv4: ip } : {}),
    });
    logger.info("Instance provisioned", { instanceId, vmid, node, ip });
  } catch (error: any) {
    logger.error("Instance provisioning failed", { instanceId, error: error?.message });
    await setStatus(instanceId, "error", { statusMessage: `Provisioning failed: ${error?.message || "unknown error"}` });
  }
}

async function getLxcIp(client: ProxmoxClient, node: string, vmid: number): Promise<string | null> {
  const ifaces = await client.getLXCInterfaces(node, vmid);
  for (const iface of ifaces) {
    if (iface.name === "lo") continue;
    for (const addr of iface["ip-addresses"] || []) {
      if (addr["ip-address-type"] === "inet" && !addr["ip-address"].startsWith("127.")) {
        return addr["ip-address"];
      }
    }
  }
  return null;
}

/** Destroy the backing LXC and mark the instance terminated. */
export async function destroyInstance(instanceId: string): Promise<void> {
  const instance = await db.query.instances.findFirst({ where: eq(instances.id, instanceId) });
  if (!instance) return;

  try {
    if (instance.vmid && instance.node) {
      const provider = await resolveProvider(instance);
      if (provider && provider.type === "proxmox") {
        const client = makeProxmoxClient(provider.config as unknown as ProxmoxConfig);
        try {
          await client.stopLXC(instance.node, instance.vmid);
        } catch {
          /* may already be stopped */
        }
        await client.destroyLXC(instance.node, instance.vmid);
      }
    }
    await setStatus(instanceId, "terminated", { statusMessage: "Instance destroyed" });
    logger.info("Instance destroyed", { instanceId, vmid: instance.vmid });
  } catch (error: any) {
    logger.error("Instance destroy failed", { instanceId, error: error?.message });
    await setStatus(instanceId, "error", { statusMessage: `Destroy failed: ${error?.message || "unknown error"}` });
    throw error;
  }
}
