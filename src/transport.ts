import type { JSONSchema7 } from "json-schema";

/** Which on-device / private model backs a request. */
export type AppleIntelligenceModel = "on-device" | "private-cloud";

/**
 * Reasoning effort for reasoning-capable models (Private Cloud Compute). Maps onto the framework's
 * `ContextOptions.ReasoningLevel`; an arbitrary string passes through as a `.custom` level. Only
 * honored on macOS 27+.
 */
export type AppleIntelligenceReasoningLevel =
  | "light"
  | "moderate"
  | "deep"
  | (string & {});

/**
 * An image attached to a user turn (multimodal input, macOS 27+). Provide either a `fileURL`
 * (a path or `file://` URL — preferred, zero-copy) or inline `base64` bytes.
 */
export type AppleIntelligenceImage = {
  mediaType?: string;
  fileURL?: string;
  base64?: string;
};

export type AppleIntelligenceMessage = {
  role: "system" | "user" | "assistant" | "tool" | "tool_calls";
  content?: string;
  name?: string;
  toolCallId?: string;
  toolCalls?: Array<{
    id: string;
    type: "function";
    function: {
      name: string;
      arguments: string;
    };
  }>;
  images?: AppleIntelligenceImage[];
};

export type AppleIntelligenceAvailability = {
  available: boolean;
  reason: string;
};

/** Context-window info for a model. `contextSize` is `-1` when it can't be determined. */
export type AppleIntelligenceContextInfo = {
  model: string;
  contextSize: number;
};

/**
 * Token usage for one generation. All counts are `0` on macOS 26 (which does not report per-call
 * token usage); real counts arrive on macOS 27+.
 */
export type AppleIntelligenceUsage = {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
};

export type AppleIntelligenceToolDefinition = {
  name: string;
  description?: string;
  parameters: JSONSchema7;
};

export type AppleIntelligenceToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

export type AppleIntelligenceGenerateOptions = {
  messages: AppleIntelligenceMessage[];
  tools?: AppleIntelligenceToolDefinition[];
  schema?: JSONSchema7;
  model?: AppleIntelligenceModel;
  reasoningLevel?: AppleIntelligenceReasoningLevel;
  temperature?: number;
  maxTokens?: number;
  stopAfterToolCalls?: boolean;
};

export type AppleIntelligenceGenerateResult = {
  text: string;
  toolCalls?: AppleIntelligenceToolCall[];
  object?: unknown;
  usage?: AppleIntelligenceUsage;
};

export type AppleIntelligenceStreamEvent =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string }
  | {
      type: "tool-call";
      toolCallId: string;
      toolName: string;
      args: Record<string, unknown>;
    }
  | { type: "usage"; usage: AppleIntelligenceUsage }
  | { type: "done" }
  | { type: "error"; message: string };

export type AppleIntelligenceStreamOptions = {
  messages: AppleIntelligenceMessage[];
  tools?: AppleIntelligenceToolDefinition[];
  model?: AppleIntelligenceModel;
  reasoningLevel?: AppleIntelligenceReasoningLevel;
  temperature?: number;
  maxTokens?: number;
  stopAfterToolCalls?: boolean;
  /**
   * Aborting this signal cancels the in-flight on-device generation (the transport calls the
   * host's cancel API). The stream then ends with a normal `done` event. Without it, a superseded
   * generation keeps running to completion — wasted inference for typing-driven consumers.
   */
  abortSignal?: AbortSignal;
};

export interface AppleIntelligenceTransport {
  checkAvailability(): Promise<AppleIntelligenceAvailability>;
  /**
   * Availability of the Private Cloud Compute model (macOS 27+, private-by-design, no API key).
   * Optional so pre-existing transports still satisfy the interface; the Tauri transport implements
   * it.
   */
  checkPrivateCloudAvailability?(): Promise<AppleIntelligenceAvailability>;
  /** Max context window (tokens) for a model, read from the framework at runtime. */
  getContextInfo?(
    model?: AppleIntelligenceModel
  ): Promise<AppleIntelligenceContextInfo>;
  /** BCP-47 language tags the on-device model supports (e.g. `["en", "fr", "zh-Hans"]`). */
  getSupportedLanguages?(): Promise<string[]>;
  /** Prewarm a model to reduce first-token latency on the next request. Best-effort. */
  prewarm?(model?: AppleIntelligenceModel): Promise<void>;
  generate(
    options: AppleIntelligenceGenerateOptions
  ): Promise<AppleIntelligenceGenerateResult>;
  stream(
    options: AppleIntelligenceStreamOptions
  ): AsyncIterable<AppleIntelligenceStreamEvent>;
}
