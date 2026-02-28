/**
 * AI Content Analysis Client — abstraction layer for toxicity detection APIs.
 *
 * Provides a unified interface for content moderation AI backends.
 * The active implementation is selected via the AI_PROVIDER env var:
 *   - "mock"        → MockAiClient (default, for development/testing)
 *   - "perspective"  → PerspectiveApiClient (Google Perspective API)
 *
 * Adding a new provider:
 *   1. Implement the AiClient interface
 *   2. Add it to createAiClient()
 */

// ─── Interface ───────────────────────────────────────────────────────────────

/** Result returned by any AI content analysis backend. */
export interface AiAnalysisResult {
  /** Overall toxicity score 0.00–1.00 */
  toxicityScore: number;
  /** Per-category scores (provider-dependent keys) */
  categories: Record<string, number>;
  /** Model identifier for audit trail */
  modelVersion: string;
}

/** Pluggable AI analysis backend. */
export interface AiClient {
  /** Analyze text content and return toxicity scores. */
  analyze(content: string): Promise<AiAnalysisResult>;
}

// ─── Mock Implementation ─────────────────────────────────────────────────────

/**
 * Mock AI client for development and testing.
 *
 * Keyword-based scoring:
 *   - Contains "toxic"/"hate"  → 0.95 (high toxicity)
 *   - Contains "spam"/"abuse"  → 0.72 (medium toxicity)
 *   - Otherwise                → 0.05 (safe)
 *
 * Scores can be overridden via setNextResult() in tests.
 */
export class MockAiClient implements AiClient {
  private nextResult: AiAnalysisResult | null = null;

  /**
   * Override the next call's result (useful in unit tests).
   * Resets after one use.
   */
  setNextResult(result: AiAnalysisResult): void {
    this.nextResult = result;
  }

  async analyze(content: string): Promise<AiAnalysisResult> {
    // Allow test overrides
    if (this.nextResult) {
      const result = this.nextResult;
      this.nextResult = null;
      return result;
    }

    const lower = content.toLowerCase();

    if (/\b(toxic|hate|kill|slur)\b/.test(lower)) {
      return {
        toxicityScore: 0.95,
        categories: {
          toxicity: 0.95,
          severe_toxicity: 0.80,
          insult: 0.85,
          threat: /\b(kill|threat)\b/.test(lower) ? 0.90 : 0.10,
          profanity: 0.70,
        },
        modelVersion: "mock-v1",
      };
    }

    if (/\b(spam|abuse|harass)\b/.test(lower)) {
      return {
        toxicityScore: 0.72,
        categories: {
          toxicity: 0.72,
          severe_toxicity: 0.30,
          insult: 0.60,
          threat: 0.05,
          profanity: 0.40,
        },
        modelVersion: "mock-v1",
      };
    }

    return {
      toxicityScore: 0.05,
      categories: {
        toxicity: 0.05,
        severe_toxicity: 0.01,
        insult: 0.02,
        threat: 0.01,
        profanity: 0.01,
      },
      modelVersion: "mock-v1",
    };
  }
}

// ─── Perspective API Implementation ──────────────────────────────────────────

/**
 * Google Perspective API client.
 *
 * Requires PERSPECTIVE_API_KEY env var.
 * https://developers.perspectiveapi.com/s/docs
 */
export class PerspectiveApiClient implements AiClient {
  private readonly apiKey: string;
  private readonly endpoint =
    "https://commentanalyzer.googleapis.com/v1alpha1/comments:analyze";

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async analyze(content: string): Promise<AiAnalysisResult> {
    const requestBody = {
      comment: { text: content },
      languages: ["en"],
      requestedAttributes: {
        TOXICITY: {},
        SEVERE_TOXICITY: {},
        INSULT: {},
        THREAT: {},
        PROFANITY: {},
      },
    };

    const response = await fetch(
      `${this.endpoint}?key=${this.apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      }
    );

    if (!response.ok) {
      throw new Error(
        `Perspective API error: ${response.status} ${response.statusText}`
      );
    }

    const data = (await response.json()) as PerspectiveResponse;
    const scores = data.attributeScores;

    const categories: Record<string, number> = {};
    for (const [key, value] of Object.entries(scores)) {
      categories[key.toLowerCase()] = value.summaryScore.value;
    }

    return {
      toxicityScore: categories["toxicity"] ?? 0,
      categories,
      modelVersion: "perspective-v1",
    };
  }
}

/** Perspective API response shape (partial). */
interface PerspectiveResponse {
  attributeScores: Record<
    string,
    { summaryScore: { value: number; type: string } }
  >;
}

// ─── Factory ─────────────────────────────────────────────────────────────────

/**
 * Creates the appropriate AI client based on environment configuration.
 *
 * @param provider - Override provider selection (defaults to AI_PROVIDER env var)
 */
export function createAiClient(provider?: string): AiClient {
  const selected = provider ?? process.env["AI_PROVIDER"] ?? "mock";

  switch (selected) {
    case "perspective": {
      const apiKey = process.env["PERSPECTIVE_API_KEY"];
      if (!apiKey) {
        throw new Error(
          "PERSPECTIVE_API_KEY env var is required for the Perspective provider"
        );
      }
      return new PerspectiveApiClient(apiKey);
    }

    case "mock":
    default:
      return new MockAiClient();
  }
}
