export type {
  AppleIntelligenceAvailability,
  AppleIntelligenceGenerateOptions,
  AppleIntelligenceGenerateResult,
  AppleIntelligenceMessage,
  AppleIntelligenceStreamEvent,
  AppleIntelligenceStreamOptions,
  AppleIntelligenceToolCall,
  AppleIntelligenceToolDefinition,
  AppleIntelligenceTransport,
} from "./transport";

export type { TauriAppleIntelligenceTransportOptions } from "./tauri";

export {
  AppleIntelligenceChatLanguageModel,
  createAppleIntelligenceProvider,
} from "./provider";

export { createTauriAppleIntelligenceTransport } from "./tauri";