import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3Content,
  LanguageModelV3FinishReason,
  LanguageModelV3Message,
  LanguageModelV3ResponseMetadata,
  LanguageModelV3StreamPart,
  LanguageModelV3ToolResultOutput,
  LanguageModelV3Usage,
  SharedV3Headers,
  SharedV3ProviderMetadata,
  SharedV3Warning,
} from "@ai-sdk/provider";
import { generateId } from "@ai-sdk/provider-utils";
import type { JSONSchema7 } from "json-schema";
import type {
  AppleIntelligenceAvailability,
  AppleIntelligenceImage,
  AppleIntelligenceMessage,
  AppleIntelligenceModel,
  AppleIntelligenceReasoningLevel,
  AppleIntelligenceStreamEvent,
  AppleIntelligenceToolDefinition,
  AppleIntelligenceTransport,
  AppleIntelligenceUsage,
} from "./transport";

/**
 * Model ids. `apple-on-device` is the ~4k-context on-device model; `apple-private-cloud` is the
 * macOS-27 Private Cloud Compute model (~32k context, reasoning-capable, still private, no API key).
 */
export type AppleIntelligenceModelId =
  | "apple-on-device"
  | "apple-private-cloud"
  | (string & {});

export type AppleIntelligenceSettings = {
  temperature?: number;
  maxTokens?: number;
  requireAvailability?: boolean;
  /** Reasoning effort for reasoning-capable models (Private Cloud Compute). macOS 27+. */
  reasoningLevel?: AppleIntelligenceReasoningLevel;
};

export type AppleIntelligenceProviderSettings = {
  transport: AppleIntelligenceTransport;
  generateId?: () => string;
};

/**
 * Build an empty {@link LanguageModelV3Usage}.
 *
 * Apple Intelligence runs on-device and does not report token counts, so every
 * field is `undefined`. The shape MUST be the nested LanguageModelV3/V4 usage
 * (`inputTokens.total`, `outputTokens.total`) — the AI SDK's `asLanguageModelUsage`
 * reads `usage.inputTokens.total`, so emitting the older flat shape
 * (`inputTokens: undefined`) throws "Cannot read properties of undefined". A fresh
 * object is returned per call so a consumer can never mutate shared state.
 */
function createEmptyUsage(): LanguageModelV3Usage {
  return {
    inputTokens: {
      total: undefined,
      noCache: undefined,
      cacheRead: undefined,
      cacheWrite: undefined,
    },
    outputTokens: {
      total: undefined,
      text: undefined,
      reasoning: undefined,
    },
  };
}

/**
 * Map the native Apple Intelligence usage (macOS 27+ reports real token counts) onto the nested
 * {@link LanguageModelV3Usage} shape. Falls back to the all-`undefined` usage when the host reports
 * none (macOS 26, which does not surface per-call token counts).
 */
function convertUsage(usage?: AppleIntelligenceUsage): LanguageModelV3Usage {
  if (!usage) {
    return createEmptyUsage();
  }
  const noCache = Math.max(0, usage.inputTokens - usage.cachedInputTokens);
  const text = Math.max(0, usage.outputTokens - usage.reasoningTokens);
  return {
    inputTokens: {
      total: usage.inputTokens,
      noCache,
      cacheRead: usage.cachedInputTokens,
      cacheWrite: undefined,
    },
    outputTokens: {
      total: usage.outputTokens,
      text,
      reasoning: usage.reasoningTokens,
    },
  };
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Convert an AI-SDK file part into an Apple Intelligence image attachment. Local file URLs/paths ride
 * through as `fileURL` (zero-copy); remote/`data:` URLs and raw bytes become `base64`. Returns `null`
 * for non-image parts.
 */
function toAppleImage(
  mediaType: string | undefined,
  data: unknown
): AppleIntelligenceImage | null {
  const type = mediaType ?? "image/*";
  if (!type.startsWith("image/") && type !== "image/*") {
    return null;
  }
  if (data instanceof URL) {
    return data.protocol === "file:"
      ? { mediaType: type, fileURL: data.href }
      : { mediaType: type, fileURL: data.href };
  }
  if (typeof data === "string") {
    const dataUrl = /^data:[^;]+;base64,(.*)$/s.exec(data);
    if (dataUrl) {
      return { mediaType: type, base64: dataUrl[1] };
    }
    if (data.startsWith("file://") || data.startsWith("/")) {
      return { mediaType: type, fileURL: data };
    }
    return { mediaType: type, base64: data };
  }
  if (data instanceof Uint8Array) {
    return { mediaType: type, base64: uint8ToBase64(data) };
  }
  if (data instanceof ArrayBuffer) {
    return { mediaType: type, base64: uint8ToBase64(new Uint8Array(data)) };
  }
  return null;
}

export interface AppleIntelligenceProvider {
  (
    modelId: AppleIntelligenceModelId,
    settings?: AppleIntelligenceSettings
  ): AppleIntelligenceChatLanguageModel;
  languageModel(
    modelId: AppleIntelligenceModelId,
    settings?: AppleIntelligenceSettings
  ): AppleIntelligenceChatLanguageModel;
  chat(
    modelId: AppleIntelligenceModelId,
    settings?: AppleIntelligenceSettings
  ): AppleIntelligenceChatLanguageModel;
}

export function createAppleIntelligenceProvider(
  settings: AppleIntelligenceProviderSettings
): AppleIntelligenceProvider {
  const createModel = (
    modelId: AppleIntelligenceModelId,
    modelSettings: AppleIntelligenceSettings = {}
  ) => new AppleIntelligenceChatLanguageModel(modelId, modelSettings, settings);

  const provider = function (
    modelId: AppleIntelligenceModelId,
    modelSettings?: AppleIntelligenceSettings
  ) {
    if (new.target) {
      throw new Error(
        "The Apple Intelligence provider cannot be called with the new keyword."
      );
    }

    return createModel(modelId, modelSettings);
  } as AppleIntelligenceProvider;

  provider.chat = createModel;
  provider.languageModel = createModel;

  return provider;
}

export class AppleIntelligenceChatLanguageModel implements LanguageModelV3 {
  readonly specificationVersion = "v3";
  readonly provider = "apple-intelligence";
  readonly modelId: string;
  readonly defaultObjectGenerationMode = "json";

  supportsImageUrls = true;
  supportsStructuredOutputs = true;

  private readonly settings: AppleIntelligenceSettings;
  private readonly transport: AppleIntelligenceTransport;
  private readonly generateId: () => string;

  constructor(
    modelId: AppleIntelligenceModelId,
    settings: AppleIntelligenceSettings,
    providerSettings: AppleIntelligenceProviderSettings
  ) {
    this.modelId = modelId;
    this.settings = settings;
    this.transport = providerSettings.transport;
    this.generateId = providerSettings.generateId ?? generateId;
  }

  /** Which native model backs this model id: `apple-private-cloud` → Private Cloud Compute. */
  private resolveModel(): AppleIntelligenceModel {
    return this.modelId === "apple-private-cloud" ? "private-cloud" : "on-device";
  }

  supportedUrls:
    | Record<string, RegExp[]>
    | PromiseLike<Record<string, RegExp[]>> = {};

  async doGenerate(
    options: LanguageModelV3CallOptions
  ): Promise<{
    content: Array<LanguageModelV3Content>;
    finishReason: LanguageModelV3FinishReason;
    usage: LanguageModelV3Usage;
    providerMetadata?: SharedV3ProviderMetadata;
    request?: { body?: unknown };
    response?: LanguageModelV3ResponseMetadata & {
      headers?: SharedV3Headers;
      body?: unknown;
    };
    warnings: Array<SharedV3Warning>;
  }> {
    await this.assertAvailability();

    const isStructured =
      options.responseFormat?.type === "json" &&
      Boolean(options.responseFormat.schema);

    if (isStructured) {
      return this.handleStructuredGeneration(options);
    }

    return this.handleRegularGeneration(options);
  }

  async doStream(
    options: LanguageModelV3CallOptions
  ): Promise<{ stream: ReadableStream<LanguageModelV3StreamPart> }> {
    await this.assertAvailability();

    const messages = this.convertPromptToMessages(options.prompt);
    const tools = options.tools?.length
      ? this.convertTools(options.tools)
      : undefined;

    const model = this.resolveModel();
    const reasoningLevel = this.settings.reasoningLevel;

    const stream = tools?.length
      ? this.createStreamFromEvents(
          this.transport.stream({
            messages,
            tools,
            model,
            reasoningLevel,
            temperature: this.settings.temperature,
            maxTokens: options.maxOutputTokens ?? this.settings.maxTokens,
            stopAfterToolCalls: true,
            abortSignal: options.abortSignal,
          })
        )
      : this.createStreamFromChunks(
          this.transport.stream({
            messages,
            model,
            reasoningLevel,
            temperature: this.settings.temperature,
            maxTokens: options.maxOutputTokens ?? this.settings.maxTokens,
            abortSignal: options.abortSignal,
          })
        );

    return { stream };
  }

  supportsUrl?(_url: typeof URL): boolean {
    return true;
  }

  private async assertAvailability(): Promise<AppleIntelligenceAvailability> {
    if (this.settings.requireAvailability === false) {
      return { available: true, reason: "Skipped availability check" };
    }

    const availability = await this.transport.checkAvailability();
    if (!availability.available) {
      throw new Error(
        `Apple Intelligence not available: ${availability.reason}`
      );
    }

    return availability;
  }

  private async handleStructuredGeneration(
    options: LanguageModelV3CallOptions
  ): Promise<{
    content: Array<LanguageModelV3Content>;
    finishReason: LanguageModelV3FinishReason;
    usage: LanguageModelV3Usage;
    warnings: Array<SharedV3Warning>;
  }> {
    const schema = options.responseFormat?.schema as JSONSchema7 | undefined;
    if (!schema) {
      throw new Error(
        "Structured generation requires a JSON schema in responseFormat."
      );
    }

    const messages = this.convertPromptToMessages(options.prompt);
    const result = await this.transport.generate({
      messages,
      schema,
      model: this.resolveModel(),
      reasoningLevel: this.settings.reasoningLevel,
      temperature: this.settings.temperature,
      maxTokens: options.maxOutputTokens ?? this.settings.maxTokens,
    });

    if (result.object !== undefined) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result.object),
          },
        ],
        finishReason: { unified: "stop", raw: "stop" },
        usage: convertUsage(result.usage),
        warnings: [],
      };
    }

    return {
      content: [{ type: "text", text: result.text ?? "" }],
      finishReason: { unified: "stop", raw: "stop" },
      usage: convertUsage(result.usage),
      warnings: [],
    };
  }

  private async handleRegularGeneration(
    options: LanguageModelV3CallOptions
  ): Promise<{
    content: Array<LanguageModelV3Content>;
    finishReason: LanguageModelV3FinishReason;
    usage: LanguageModelV3Usage;
    warnings: Array<SharedV3Warning>;
  }> {
    const messages = this.convertPromptToMessages(options.prompt);
    const tools = options.tools?.length
      ? this.convertTools(options.tools)
      : undefined;

    const result = await this.transport.generate({
      messages,
      tools,
      model: this.resolveModel(),
      reasoningLevel: this.settings.reasoningLevel,
      temperature: this.settings.temperature,
      maxTokens: options.maxOutputTokens ?? this.settings.maxTokens,
      stopAfterToolCalls: true,
    });

    if (result.toolCalls?.length) {
      const toolCallContent: LanguageModelV3Content[] = result.toolCalls.map(
        (call) => ({
          type: "tool-call",
          toolCallId: call.id,
          toolName: call.function.name,
          input: call.function.arguments,
        })
      );

      return {
        content: toolCallContent,
        finishReason: { unified: "tool-calls", raw: "tool-calls" },
        usage: convertUsage(result.usage),
        warnings: [],
      };
    }

    return {
      content: [{ type: "text", text: result.text ?? "" }],
      finishReason: { unified: "stop", raw: "stop" },
      usage: convertUsage(result.usage),
      warnings: [],
    };
  }

  private convertTools(
    tools: LanguageModelV3CallOptions["tools"]
  ): AppleIntelligenceToolDefinition[] {
    return tools
      ? tools.map((tool) => {
          if (tool.type !== "function") {
            throw new Error(`Unsupported tool type: ${tool.type}`);
          }

          return {
            name: tool.name,
            description: tool.description,
            parameters: tool.inputSchema,
          };
        })
      : [];
  }

  private convertPromptToMessages(
    prompt: Parameters<LanguageModelV3["doGenerate"]>[0]["prompt"]
  ): AppleIntelligenceMessage[] {
    return prompt.map((message) => {
      switch (message.role) {
        case "system":
          return {
            role: "system",
            content: message.content,
          };
        case "user":
          return this.convertUserMessage(message);
        case "assistant":
          return this.convertAssistantMessage(message);
        case "tool":
          return this.convertToolMessage(message);
        default:
          return {
            role: "user",
            content: String(message.content ?? ""),
          };
      }
    });
  }

  private convertUserMessage(
    message: Extract<LanguageModelV3Message, { role: "user" }>
  ): AppleIntelligenceMessage {
    if (!Array.isArray(message.content)) {
      return { role: "user", content: message.content };
    }

    const textParts: string[] = [];
    const images: AppleIntelligenceImage[] = [];
    for (const part of message.content) {
      if (part.type === "text") {
        textParts.push(part.text);
      } else if (part.type === "file") {
        const image = toAppleImage(part.mediaType, part.data);
        if (image) {
          images.push(image);
        } else {
          textParts.push(`[unsupported content - ${part.mediaType ?? "file"}]`);
        }
      } else {
        textParts.push("[unsupported content]");
      }
    }

    return {
      role: "user",
      content: textParts.join("\n"),
      ...(images.length > 0 ? { images } : {}),
    };
  }

  private convertAssistantMessage(
    message: Extract<LanguageModelV3Message, { role: "assistant" }>
  ): AppleIntelligenceMessage {
    if (Array.isArray(message.content)) {
      const toolCalls = message.content.filter(
        (part) => part.type === "tool-call"
      );
      const textParts = message.content.filter((part) => part.type === "text");

      if (toolCalls.length > 0) {
        return {
          role: "assistant",
          content: textParts.map((part) => part.text).join("\n") || "",
          toolCalls: toolCalls.map((part) => ({
            id: part.toolCallId,
            type: "function",
            function: {
              name: part.toolName,
              arguments:
                typeof part.input === "string"
                  ? part.input
                  : JSON.stringify(part.input),
            },
          })),
        };
      }

      return {
        role: "assistant",
        content: message.content
          .map((part) => {
            switch (part.type) {
              case "text":
              case "reasoning":
                return part.text;
              default:
                return `[unsupported content - ${part.type}]`;
            }
          })
          .join("\n"),
      };
    }

    return {
      role: "assistant",
      content: message.content || "",
    };
  }

  private convertToolMessage(
    message: Extract<LanguageModelV3Message, { role: "tool" }>
  ): AppleIntelligenceMessage {
    const toolCalls = message.content
      .map((part) => {
        if (part.type === "tool-result") {
          return {
            id: part.toolCallId,
            toolName: part.toolName,
            segments: [
              {
                type: "text",
                text: this.formatToolResultOutput(part.output),
              },
            ],
          };
        }
        if (part.type === "tool-approval-response") {
          return {
            id: part.approvalId,
            toolName: "tool-approval",
            segments: [
              {
                type: "text",
                text: part.approved
                  ? `Tool approval granted${
                      part.reason ? `: ${part.reason}` : ""
                    }`
                  : `Tool approval denied${
                      part.reason ? `: ${part.reason}` : ""
                    }`,
              },
            ],
          };
        }
        return null;
      })
      .filter(Boolean);

    return {
      role: "tool",
      content: JSON.stringify({ tool_calls: toolCalls }),
    };
  }

  private formatToolResultOutput(
    output: LanguageModelV3ToolResultOutput
  ): string {
    switch (output.type) {
      case "text":
      case "error-text":
        return output.value;
      case "json":
      case "error-json":
        return JSON.stringify(output.value);
      case "execution-denied":
        return output.reason
          ? `Tool execution denied: ${output.reason}`
          : "Tool execution denied";
      case "content":
        return output.value
          .map((part) => {
            if (part.type === "text") {
              return part.text;
            }
            if (part.type === "file-data") {
              return `[file-data:${part.mediaType}]`;
            }
            if (part.type === "file-url") {
              return `[file-url:${part.url}]`;
            }
            return "[file]";
          })
          .join("\n");
      default:
        return "[unsupported tool output]";
    }
  }

  private createStreamFromEvents(
    nativeStream: AsyncIterable<AppleIntelligenceStreamEvent>
  ): ReadableStream<LanguageModelV3StreamPart> {
    return new ReadableStream<LanguageModelV3StreamPart>({
      async start(controller) {
        controller.enqueue({ type: "stream-start", warnings: [] });
        const textId = crypto.randomUUID();
        const reasoningId = crypto.randomUUID();
        let hasText = false;
        let hasReasoning = false;
        let hasToolCalls = false;
        let usage = createEmptyUsage();

        try {
          for await (const event of nativeStream) {
            if (event.type === "text") {
              if (!hasText) {
                controller.enqueue({ type: "text-start", id: textId });
                hasText = true;
              }
              controller.enqueue({
                type: "text-delta",
                delta: event.text,
                id: textId,
              });
            } else if (event.type === "reasoning") {
              if (!hasReasoning) {
                controller.enqueue({ type: "reasoning-start", id: reasoningId });
                hasReasoning = true;
              }
              controller.enqueue({
                type: "reasoning-delta",
                delta: event.text,
                id: reasoningId,
              });
            } else if (event.type === "tool-call") {
              hasToolCalls = true;
              controller.enqueue({
                type: "tool-call",
                toolCallId: event.toolCallId,
                toolName: event.toolName,
                input: JSON.stringify(event.args),
              });
            } else if (event.type === "usage") {
              usage = convertUsage(event.usage);
            } else if (event.type === "error") {
              controller.error(new Error(event.message));
              return;
            } else if (event.type === "done") {
              break;
            }
          }

          if (hasReasoning) {
            controller.enqueue({ type: "reasoning-end", id: reasoningId });
          }
          if (hasText) {
            controller.enqueue({ type: "text-end", id: textId });
          }

          controller.enqueue({
            type: "finish",
            finishReason: hasToolCalls
              ? { unified: "tool-calls", raw: "tool-calls" }
              : { unified: "stop", raw: "stop" },
            usage,
          });
          controller.close();
        } catch (err) {
          controller.error(err);
        }
      },
    });
  }

  private createStreamFromChunks(
    stream: AsyncIterable<AppleIntelligenceStreamEvent>
  ): ReadableStream<LanguageModelV3StreamPart> {
    return new ReadableStream<LanguageModelV3StreamPart>({
      async start(controller) {
        controller.enqueue({ type: "stream-start", warnings: [] });
        const textId = crypto.randomUUID();
        const reasoningId = crypto.randomUUID();
        let hasText = false;
        let hasReasoning = false;
        let usage = createEmptyUsage();

        try {
          for await (const event of stream) {
            if (event.type === "text") {
              if (!hasText) {
                controller.enqueue({ type: "text-start", id: textId });
                hasText = true;
              }
              controller.enqueue({
                type: "text-delta",
                delta: event.text,
                id: textId,
              });
            } else if (event.type === "reasoning") {
              if (!hasReasoning) {
                controller.enqueue({ type: "reasoning-start", id: reasoningId });
                hasReasoning = true;
              }
              controller.enqueue({
                type: "reasoning-delta",
                delta: event.text,
                id: reasoningId,
              });
            } else if (event.type === "usage") {
              usage = convertUsage(event.usage);
            } else if (event.type === "error") {
              controller.error(new Error(event.message));
              return;
            } else if (event.type === "done") {
              break;
            }
          }

          if (hasReasoning) {
            controller.enqueue({ type: "reasoning-end", id: reasoningId });
          }
          if (hasText) {
            controller.enqueue({ type: "text-end", id: textId });
          }

          controller.enqueue({
            type: "finish",
            finishReason: { unified: "stop", raw: "stop" },
            usage,
          });
          controller.close();
        } catch (err) {
          controller.error(err);
        }
      },
    });
  }
}