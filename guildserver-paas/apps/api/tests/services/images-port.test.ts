import { describe, it, expect } from "@jest/globals";
import { detectDefaultPort } from "../../src/services/docker/images";

describe("detectDefaultPort", () => {
  it("detects port 9119 for hermes agent images", () => {
    expect(detectDefaultPort("nousresearch/hermes-agent:latest")).toBe(9119);
    expect(detectDefaultPort("sbx/hermes-agent-image")).toBe(9119);
    expect(detectDefaultPort("my-custom-hermes")).toBe(9119);
  });

  it("detects ports for other AI / orchestration tools", () => {
    expect(detectDefaultPort("openclaw:latest")).toBe(8080);
    expect(detectDefaultPort("langflowai/langflow:latest")).toBe(7860);
    expect(detectDefaultPort("flowiseai/flowise:latest")).toBe(3000);
    expect(detectDefaultPort("ghcr.io/danny-avila/librechat:latest")).toBe(3080);
    expect(detectDefaultPort("mintplexlabs/anythingllm:latest")).toBe(3001);
    expect(detectDefaultPort("lobehub/lobe-chat:latest")).toBe(3210);
    expect(detectDefaultPort("ollama/ollama:latest")).toBe(11434);
    expect(detectDefaultPort("ghcr.io/berriai/litellm:main-latest")).toBe(4000);
  });

  it("falls back to 80 for unknown images", () => {
    expect(detectDefaultPort("some-random-unknown-image:latest")).toBe(80);
  });
});
