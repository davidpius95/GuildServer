import { verifyRedirect } from "../../src/services/domain-verifier";
import * as dns from "dns/promises";

jest.mock("dns/promises");

const mockedDns = jest.mocked(dns);

describe("Domain Verifier Service", () => {
  let globalFetchMock: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Default DNS mock returns a public IP
    mockedDns.lookup.mockResolvedValue({ address: "8.8.8.8", family: 4 } as any);

    globalFetchMock = jest.fn();
    global.fetch = globalFetchMock as any;
  });

  afterEach(() => {
    (global as any).fetch = undefined;
  });

  it("should return active for a correct redirect", async () => {
    globalFetchMock.mockResolvedValueOnce({
      status: 301,
      headers: new Headers({
        location: "https://my-app.guildserver.io"
      })
    });

    const result = await verifyRedirect({
      domain: "custom.example.com",
      expectedTarget: "my-app.guildserver.io"
    });

    expect(result.status).toBe("active");
    expect(result.finalUrl).toBe("https://my-app.guildserver.io/");
    expect(result.httpStatus).toBe(301);
  });

  it("should fail if DNS resolves to a private IP (SSRF block)", async () => {
    mockedDns.lookup.mockResolvedValue({ address: "192.168.1.1", family: 4 } as any);

    const result = await verifyRedirect({
      domain: "internal.example.com",
      expectedTarget: "my-app.guildserver.io"
    });

    expect(result.status).toBe("failed");
    expect(result.reason).toContain("private IP");
    expect(globalFetchMock).not.toHaveBeenCalled();
  });

  it("should fail if redirect goes to the wrong target", async () => {
    globalFetchMock.mockResolvedValueOnce({
      status: 301,
      headers: new Headers({
        location: "https://wrong-target.example.com"
      })
    });
    
    // We mock the second fetch (following the redirect) to just return 200 to end the chain
    globalFetchMock.mockResolvedValueOnce({
      status: 200,
      headers: new Headers()
    });

    const result = await verifyRedirect({
      domain: "custom.example.com",
      expectedTarget: "my-app.guildserver.io"
    });

    expect(result.status).toBe("failed");
    expect(result.reason).toContain("redirects to wrong-target.example.com");
  });

  it("should fail if no redirect is found", async () => {
    // Falls back to HTTP on the second try
    globalFetchMock.mockResolvedValue({
      status: 200,
      headers: new Headers()
    });

    const result = await verifyRedirect({
      domain: "custom.example.com",
      expectedTarget: "my-app.guildserver.io"
    });

    expect(result.status).toBe("failed");
    expect(result.reason).toContain("redirects to custom.example.com");
  });

  it("should fail on timeout", async () => {
    globalFetchMock.mockRejectedValue(Object.assign(new Error("Timeout"), { name: "AbortError" }));

    const result = await verifyRedirect({
      domain: "custom.example.com",
      expectedTarget: "my-app.guildserver.io"
    });

    expect(result.status).toBe("failed");
    expect(result.reason).toBe("timeout");
  });

  it("should handle multi-hop redirects correctly", async () => {
    // 1. HTTP to HTTPS redirect
    globalFetchMock.mockResolvedValueOnce({
      status: 301,
      headers: new Headers({
        location: "https://custom.example.com"
      })
    });
    // 2. HTTPS to canonical redirect
    globalFetchMock.mockResolvedValueOnce({
      status: 302,
      headers: new Headers({
        location: "https://my-app.guildserver.io"
      })
    });

    const result = await verifyRedirect({
      domain: "custom.example.com",
      expectedTarget: "my-app.guildserver.io"
    });

    expect(result.status).toBe("active");
  });
});
