import { describe, it, expect, vi } from "vitest";
import {
  MockAiClient,
  PerspectiveApiClient,
  createAiClient,
} from "./ai-client.js";

describe("MockAiClient", () => {
  it("returns low toxicity for safe content", async () => {
    const client = new MockAiClient();
    const result = await client.analyze("Hello world, nice day!");

    expect(result.toxicityScore).toBe(0.05);
    expect(result.modelVersion).toBe("mock-v1");
    expect(result.categories).toHaveProperty("toxicity");
  });

  it("returns high toxicity for toxic keywords", async () => {
    const client = new MockAiClient();
    const result = await client.analyze("This is toxic hate speech");

    expect(result.toxicityScore).toBe(0.95);
    expect(result.categories["severe_toxicity"]).toBe(0.80);
  });

  it("returns medium toxicity for spam/abuse keywords", async () => {
    const client = new MockAiClient();
    const result = await client.analyze("This is spam content");

    expect(result.toxicityScore).toBe(0.72);
  });

  it("detects threat keywords", async () => {
    const client = new MockAiClient();
    const result = await client.analyze("I will kill you");

    expect(result.toxicityScore).toBe(0.95);
    expect(result.categories["threat"]).toBe(0.90);
  });

  it("allows test overrides via setNextResult", async () => {
    const client = new MockAiClient();
    const custom = {
      toxicityScore: 0.42,
      categories: { custom_cat: 0.42 },
      modelVersion: "override-v1",
    };

    client.setNextResult(custom);
    const result = await client.analyze("anything");

    expect(result.toxicityScore).toBe(0.42);
    expect(result.modelVersion).toBe("override-v1");
  });

  it("resets override after one use", async () => {
    const client = new MockAiClient();
    client.setNextResult({
      toxicityScore: 0.99,
      categories: {},
      modelVersion: "one-shot",
    });

    await client.analyze("first call uses override");
    const result = await client.analyze("second call uses keywords");

    // Back to default safe score
    expect(result.toxicityScore).toBe(0.05);
  });
});

describe("PerspectiveApiClient", () => {
  it("sends correct request to Perspective API", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        attributeScores: {
          TOXICITY: { summaryScore: { value: 0.8, type: "PROBABILITY" } },
          SEVERE_TOXICITY: { summaryScore: { value: 0.3, type: "PROBABILITY" } },
          INSULT: { summaryScore: { value: 0.6, type: "PROBABILITY" } },
          THREAT: { summaryScore: { value: 0.1, type: "PROBABILITY" } },
          PROFANITY: { summaryScore: { value: 0.5, type: "PROBABILITY" } },
        },
      }),
    });

    vi.stubGlobal("fetch", mockFetch);

    const client = new PerspectiveApiClient("test-api-key");
    const result = await client.analyze("test content");

    expect(result.toxicityScore).toBe(0.8);
    expect(result.categories["insult"]).toBe(0.6);
    expect(result.modelVersion).toBe("perspective-v1");

    // Verify API call
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("key=test-api-key"),
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
      })
    );

    vi.unstubAllGlobals();
  });

  it("throws on API error response", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      statusText: "Forbidden",
    });

    vi.stubGlobal("fetch", mockFetch);

    const client = new PerspectiveApiClient("bad-key");

    await expect(client.analyze("test")).rejects.toThrow(
      "Perspective API error: 403 Forbidden"
    );

    vi.unstubAllGlobals();
  });
});

describe("createAiClient", () => {
  it("creates MockAiClient by default", () => {
    const client = createAiClient();
    expect(client).toBeInstanceOf(MockAiClient);
  });

  it("creates MockAiClient when provider is 'mock'", () => {
    const client = createAiClient("mock");
    expect(client).toBeInstanceOf(MockAiClient);
  });

  it("creates PerspectiveApiClient when provider is 'perspective' with API key", () => {
    vi.stubEnv("PERSPECTIVE_API_KEY", "test-key");

    const client = createAiClient("perspective");
    expect(client).toBeInstanceOf(PerspectiveApiClient);

    vi.unstubAllEnvs();
  });

  it("throws when perspective provider lacks API key", () => {
    // Ensure no key is set
    const original = process.env["PERSPECTIVE_API_KEY"];
    delete process.env["PERSPECTIVE_API_KEY"];

    expect(() => createAiClient("perspective")).toThrow(
      "PERSPECTIVE_API_KEY env var is required"
    );

    if (original) process.env["PERSPECTIVE_API_KEY"] = original;
  });
});
