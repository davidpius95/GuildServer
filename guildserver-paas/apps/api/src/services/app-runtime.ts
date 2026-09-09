import { z } from "zod";
import { createHash } from "crypto";

export const runtimeSettingsSchema = z.object({
  containerPort: z.number().int().min(1).max(65535).nullable().optional(),
  persistentStoragePath: z.string().max(200).refine(
    value => /^(\/data|\/app\/(data|storage|uploads))(\/[a-zA-Z0-9_-]+)*$/.test(value),
    "Use /data, /app/data, /app/storage or /app/uploads, optionally with subdirectories."
  ).nullable().optional(),
});

export function resolveRuntimePort(explicit?: number | null, env?: string, imagePort?: number | null): number | undefined {
  const port = Number(env);
  return explicit || (Number.isInteger(port) && port > 0 && port <= 65535 ? port : undefined) || imagePort || undefined;
}

export function appStorageMount(applicationId: string, target: string, preview?: string) {
  runtimeSettingsSchema.parse({ persistentStoragePath: target });
  const suffix = preview ? `-preview-${createHash("sha256").update(preview).digest("hex").slice(0, 12)}` : "";
  return { Type: "volume" as const, Source: `gs-app-${applicationId}${suffix}-data`, Target: target };
}
