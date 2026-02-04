import type { JSONSchema7 } from "json-schema";

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
};

export type AppleIntelligenceAvailability = {
  available: boolean;
  reason: string;
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
  temperature?: number;
  maxTokens?: number;
  stopAfterToolCalls?: boolean;
};

export type AppleIntelligenceGenerateResult = {
  text: string;
  toolCalls?: AppleIntelligenceToolCall[];
  object?: unknown;
};

export type AppleIntelligenceStreamEvent =
  | { type: "text"; text: string }
  | {
      type: "tool-call";
      toolCallId: string;
      toolName: string;
      args: Record<string, unknown>;
    }
  | { type: "done" }
  | { type: "error"; message: string };

export type AppleIntelligenceStreamOptions = {
  messages: AppleIntelligenceMessage[];
  tools?: AppleIntelligenceToolDefinition[];
  temperature?: number;
  maxTokens?: number;
  stopAfterToolCalls?: boolean;
};

export interface AppleIntelligenceTransport {
  checkAvailability(): Promise<AppleIntelligenceAvailability>;
  generate(options: AppleIntelligenceGenerateOptions): Promise<AppleIntelligenceGenerateResult>;
  stream(options: AppleIntelligenceStreamOptions): AsyncIterable<AppleIntelligenceStreamEvent>;
}