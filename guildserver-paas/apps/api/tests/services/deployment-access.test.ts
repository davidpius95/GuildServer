import { describe, it, expect } from "@jest/globals";
import { buildDeploymentAccessUrl } from "../../src/services/deployment-access";

describe("buildDeploymentAccessUrl", () => {
  it("uses the LXC IP for proxmox deployments without a domain", () => {
    const result = buildDeploymentAccessUrl({
      hostPort: 43425,
      providerType: "proxmox",
      providerMetadata: { provider: "proxmox", lxcIp: "10.0.0.21" },
    });

    expect(result.accessUrl).toBe("http://10.0.0.21:43425");
    expect(result.directUrl).toBe("http://10.0.0.21:43425");
  });

  it("prefers the primary domain when present and keeps the direct URL", () => {
    const result = buildDeploymentAccessUrl({
      hostPort: 3000,
      providerType: "docker-local",
      providerMetadata: { provider: "docker-local", lxcIp: "10.0.0.21" },
      primaryDomain: "app.guild-technologies.com",
    });

    expect(result.accessUrl).toBe("https://app.guild-technologies.com");
    expect(result.directUrl).toBe("http://10.0.0.21:3000");
  });

  it("uses http for localhost-style domains", () => {
    const result = buildDeploymentAccessUrl({
      hostPort: 3000,
      providerType: "docker-local",
      previewDomain: "demo.localhost",
    });

    expect(result.accessUrl).toBe("http://demo.localhost");
  });
});
