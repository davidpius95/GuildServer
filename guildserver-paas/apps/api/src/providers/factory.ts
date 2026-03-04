import { ComputeProvider, ProviderType, ProviderConfig, DockerLocalConfig, ProxmoxConfig } from "./types";
import { DockerLocalProvider } from "./docker-local";
import { ProxmoxProvider } from "./proxmox";
import { db, computeProviders } from "@guildserver/database";
import { eq } from "drizzle-orm";

/**
 * Get a ComputeProvider instance by provider ID from the database.
 * If no providerId is given, returns the default DockerLocalProvider.
 */
export async function getProvider(providerId?: string | null): Promise<ComputeProvider> {
  // Default: local Docker (backward compatible)
  if (!providerId) {
    return new DockerLocalProvider();
  }

  // Fetch provider config from DB
  const provider = await db.query.computeProviders.findFirst({
    where: eq(computeProviders.id, providerId),
  });

  if (!provider) {
    throw new Error(`Provider ${providerId} not found`);
  }

  return createProviderFromConfig(provider.type as ProviderType, provider.config as ProviderConfig);
}

/**
 * Create a ComputeProvider instance from a type and config object.
 * Used for both DB-loaded providers and test connections.
 */
export function createProviderFromConfig(
  type: ProviderType,
  config: ProviderConfig
): ComputeProvider {
  switch (type) {
    case "docker-local":
      return new DockerLocalProvider(config as DockerLocalConfig);

    case "docker-remote":
      // Phase 3 implementation
      throw new Error("Docker Remote provider is not yet implemented. Coming in Phase 3.");

    case "proxmox":
      return new ProxmoxProvider(config as ProxmoxConfig);

    case "kubernetes":
      // Phase 4 implementation
      throw new Error("Kubernetes provider is not yet implemented. Coming in Phase 4.");

    case "aws-ecs":
      // Phase 6 implementation
      throw new Error("AWS ECS provider is not yet implemented. Coming in Phase 6.");

    case "gcp-cloudrun":
      // Phase 6 implementation
      throw new Error("GCP Cloud Run provider is not yet implemented. Coming in Phase 6.");

    case "azure-aci":
      throw new Error("Azure ACI provider is not yet implemented.");

    case "hetzner":
      throw new Error("Hetzner provider is not yet implemented.");

    case "digitalocean":
      throw new Error("DigitalOcean provider is not yet implemented.");

    default:
      throw new Error(`Unknown provider type: ${type}`);
  }
}

/**
 * Get the default provider for an organization.
 * Falls back to DockerLocalProvider if no default is configured.
 */
export async function getDefaultProvider(organizationId?: string): Promise<ComputeProvider> {
  if (organizationId) {
    const defaultProvider = await db.query.computeProviders.findFirst({
      where: eq(computeProviders.isDefault, true),
    });

    if (defaultProvider) {
      return createProviderFromConfig(
        defaultProvider.type as ProviderType,
        defaultProvider.config as ProviderConfig
      );
    }
  }

  return new DockerLocalProvider();
}
