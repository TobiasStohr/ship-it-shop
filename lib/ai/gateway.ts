import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { gateway } from "ai";
import type {
  LanguageModelV4,
  LanguageModelV4CallOptions,
} from "@ai-sdk/provider";
import {
  WORKFLOW_DESERIALIZE,
  WORKFLOW_SERIALIZE,
} from "@ai-sdk/provider-utils";

/**
 * Single source of the chat model. `MODEL_GATEWAY` picks the gateway:
 *
 * - `vercel`: returns a `GatewayChatModel` for `VERCEL_GATEWAY_MODEL`. The AI
 *   SDK gateway provider reads `AI_GATEWAY_API_KEY` or `VERCEL_OIDC_TOKEN`.
 * - `ica`: returns an `IcaChatModel` for the OpenAI-compatible ICA endpoint.
 *
 * Server code only. This module does not import `server-only`, because
 * workflow step bundles also load it.
 */

export type ModelGateway = "ica" | "vercel";

export type ChatModel = LanguageModelV4;

export function getModelGateway(): ModelGateway {
  const value = process.env.MODEL_GATEWAY ?? "vercel";
  if (value !== "ica" && value !== "vercel") {
    throw new Error(`MODEL_GATEWAY must be "ica" or "vercel".`);
  }
  return value;
}

export function getChatModel(): ChatModel {
  if (getModelGateway() === "vercel") {
    return new GatewayChatModel(requireEnv("VERCEL_GATEWAY_MODEL"));
  }
  return new IcaChatModel(requireEnv("ICA_GATEWAY_MODEL"));
}

/**
 * Wraps the OpenAI-compatible ICA model so it can cross a workflow step
 * boundary. Workflow serializes only the model id. The step rebuilds the
 * client from env, so the API key and base URL never enter the event log.
 */
class IcaChatModel implements LanguageModelV4 {
  readonly specificationVersion = "v4";
  readonly provider = "ica.chat";
  readonly modelId: string;
  private delegate?: LanguageModelV4;

  static [WORKFLOW_SERIALIZE](model: IcaChatModel) {
    return { modelId: model.modelId };
  }

  static [WORKFLOW_DESERIALIZE](data: { modelId: string }) {
    return new IcaChatModel(data.modelId);
  }

  constructor(modelId: string) {
    this.modelId = modelId;
  }

  get supportedUrls() {
    return this.model().supportedUrls;
  }

  doGenerate(options: LanguageModelV4CallOptions) {
    return this.model().doGenerate(options);
  }

  doStream(options: LanguageModelV4CallOptions) {
    return this.model().doStream(options);
  }

  private model(): LanguageModelV4 {
    this.delegate ??= createOpenAICompatible({
      name: "ica",
      baseURL: requireEnv("ICA_GATEWAY_URL"),
      apiKey: requireEnv("ICA_GATEWAY_API_KEY"),
      includeUsage: true,
    }).chatModel(this.modelId);
    return this.delegate;
  }
}

// The AI Gateway free tier allows 5 requests per minute. One chat turn makes
// one request per step, so a rate-limited call waits and tries again.
const RATE_LIMIT_WAIT_MS = 20_000;
const RATE_LIMIT_ATTEMPTS = 4;

function isRateLimitError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === "GatewayRateLimitError") return true;
  return "statusCode" in error && error.statusCode === 429;
}

async function withRateLimitRetry<T>(call: () => PromiseLike<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await call();
    } catch (error) {
      if (attempt >= RATE_LIMIT_ATTEMPTS || !isRateLimitError(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_WAIT_MS));
    }
  }
}

/**
 * Vercel AI Gateway model that waits out rate limits. Workflow serializes
 * only the model id, like `IcaChatModel`.
 */
class GatewayChatModel implements LanguageModelV4 {
  readonly specificationVersion = "v4";
  readonly provider = "gateway";
  readonly modelId: string;
  private delegate?: LanguageModelV4;

  static [WORKFLOW_SERIALIZE](model: GatewayChatModel) {
    return { modelId: model.modelId };
  }

  static [WORKFLOW_DESERIALIZE](data: { modelId: string }) {
    return new GatewayChatModel(data.modelId);
  }

  constructor(modelId: string) {
    this.modelId = modelId;
  }

  get supportedUrls() {
    return this.model().supportedUrls;
  }

  doGenerate(options: LanguageModelV4CallOptions) {
    return withRateLimitRetry(() => this.model().doGenerate(options));
  }

  doStream(options: LanguageModelV4CallOptions) {
    return withRateLimitRetry(() => this.model().doStream(options));
  }

  private model(): LanguageModelV4 {
    this.delegate ??= gateway(this.modelId);
    return this.delegate;
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}.`);
  return value;
}
