export type {
  AppleIntelligenceAvailability,
  AppleIntelligenceContextInfo,
  AppleIntelligenceGenerateOptions,
  AppleIntelligenceGenerateResult,
  AppleIntelligenceImage,
  AppleIntelligenceMessage,
  AppleIntelligenceModel,
  AppleIntelligenceReasoningLevel,
  AppleIntelligenceStreamEvent,
  AppleIntelligenceStreamOptions,
  AppleIntelligenceToolCall,
  AppleIntelligenceToolDefinition,
  AppleIntelligenceTransport,
  AppleIntelligenceUsage,
} from "./transport";

export type { TauriAppleIntelligenceTransportOptions } from "./tauri";

export type {
  AppleIntelligenceModelId,
  AppleIntelligenceProvider,
  AppleIntelligenceProviderSettings,
  AppleIntelligenceSettings,
} from "./provider";

export {
  AppleIntelligenceChatLanguageModel,
  createAppleIntelligenceProvider,
} from "./provider";

export { createTauriAppleIntelligenceTransport } from "./tauri";