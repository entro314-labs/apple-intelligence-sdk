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
  AppleIntelligenceMessage,
  AppleIntelligenceStreamEvent,
  AppleIntelligenceToolDefinition,
  AppleIntelligenceTransport,
} from "./transport";

export type AppleIntelligenceModelId = "apple-on-device" | (string & {});

export type AppleIntelligenceSettings = {
  temperature?: number;
  maxTokens?: number;
  requireAvailability?: boolean;
};

export type AppleIntelligenceProviderSettings = {
  transport: AppleIntelligenceTransport;
  generateId?: () => string;
};

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

  supportsImageUrls = false;
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

    const stream = tools?.length
      ? this.createStreamFromEvents(
          this.transport.stream({
            messages,
            tools,
            temperature: this.settings.temperature,
            maxTokens: options.maxOutputTokens ?? this.settings.maxTokens,
            stopAfterToolCalls: true,
            abortSignal: options.abortSignal,
          })
        )
      : this.createStreamFromChunks(
          this.transport.stream({
            messages,
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
        usage: this.emptyUsage(),
        warnings: [],
      };
    }

    return {
      content: [{ type: "text", text: result.text ?? "" }],
      finishReason: { unified: "stop", raw: "stop" },
      usage: this.emptyUsage(),
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
        usage: this.emptyUsage(),
        warnings: [],
      };
    }

    return {
      content: [{ type: "text", text: result.text ?? "" }],
      finishReason: { unified: "stop", raw: "stop" },
      usage: this.emptyUsage(),
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
          return {
            role: "user",
            content: Array.isArray(message.content)
              ? message.content
                  .map((part) =>
                    part.type === "text" ? part.text : "[unsupported content]"
                  )
                  .join("\n")
              : message.content,
          };
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
        let hasText = false;
        let hasToolCalls = false;

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
            } else if (event.type === "tool-call") {
              hasToolCalls = true;
              controller.enqueue({
                type: "tool-call",
                toolCallId: event.toolCallId,
                toolName: event.toolName,
                input: JSON.stringify(event.args),
              });
            } else if (event.type === "error") {
              controller.error(new Error(event.message));
              return;
            } else if (event.type === "done") {
              break;
            }
          }

          if (hasText) {
            controller.enqueue({ type: "text-end", id: textId });
          }

          controller.enqueue({
            type: "finish",
            finishReason: hasToolCalls
              ? { unified: "tool-calls", raw: "tool-calls" }
              : { unified: "stop", raw: "stop" },
            usage: {
              inputTokens: undefined,
              outputTokens: undefined,
              totalTokens: undefined,
            },
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
        let hasText = false;

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
            } else if (event.type === "error") {
              controller.error(new Error(event.message));
              return;
            } else if (event.type === "done") {
              break;
            }
          }

          if (hasText) {
            controller.enqueue({ type: "text-end", id: textId });
          }

          controller.enqueue({
            type: "finish",
            finishReason: { unified: "stop", raw: "stop" },
            usage: {
              inputTokens: undefined,
              outputTokens: undefined,
              totalTokens: undefined,
            },
          });
          controller.close();
        } catch (err) {
          controller.error(err);
        }
      },
    });
  }

  private emptyUsage(): LanguageModelV3Usage {
    return {
      inputTokens: undefined,
      outputTokens: undefined,
      totalTokens: undefined,
    };
  }
}