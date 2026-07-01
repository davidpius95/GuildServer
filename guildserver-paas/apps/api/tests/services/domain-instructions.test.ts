import { buildForwardingInstructions } from "../../src/services/domain-instructions";

describe("Domain Instructions Builder", () => {
  it("should correctly identify an apex domain", () => {
    const result = buildForwardingInstructions({
      domain: "example.com",
      target: "my-app.guildserver.io",
    });

    expect(result.isApex).toBe(true);
    expect(result.isWildcard).toBe(false);
    
    // Check specific generic fields
    expect(result.generic.from).toBe("example.com");
    expect(result.generic.to).toBe("https://my-app.guildserver.io");

    // Check registrar strings (GoDaddy uses 'Domain' for apex)
    const godaddy = result.registrars.find(r => r.name === "GoDaddy")!;
    expect(godaddy.steps.some(step => step.includes("Select 'Domain' as the type"))).toBe(true);
  });

  it("should correctly identify a subdomain", () => {
    const result = buildForwardingInstructions({
      domain: "app.example.com",
      target: "https://my-app.guildserver.io",
    });

    expect(result.isApex).toBe(false);
    expect(result.isWildcard).toBe(false);

    // Check registrar strings (GoDaddy uses 'Subdomain' for subdomains)
    const godaddy = result.registrars.find(r => r.name === "GoDaddy")!;
    expect(godaddy.steps.some(step => step.includes("Select 'Subdomain' and enter `app`"))).toBe(true);
  });

  it("should correctly identify a wildcard domain", () => {
    const result = buildForwardingInstructions({
      domain: "*.example.com",
      target: "my-app.guildserver.io",
    });

    expect(result.isApex).toBe(true); // example.com is an apex for the split, but we only care about wildcard flag
    expect(result.isWildcard).toBe(true);

    // Cloudflare rule for wildcards
    const cloudflare = result.registrars.find(r => r.name === "Cloudflare")!;
    expect(cloudflare.steps.some(step => step.includes("Hostname matches `*.example.com`"))).toBe(true);
  });
});
