# Apple Intelligence SDK (Transport-Agnostic)

This package provides a **Vercel AI SDK v7 provider** (`LanguageModelV4` spec) for Apple Intelligence using a **pluggable transport**. It does **not** ship any native binaries.

Companion Tauri bridge crate: https://github.com/entro314-labs/tauri-apple-intelligence

## Why a transport?

Apple Intelligence runs on-device and requires macOS 26+ on Apple Silicon. Different runtimes (Tauri, Node, etc.) need different bridges. This SDK keeps the provider logic reusable while the transport does platform-specific work.

## Install

```bash
pnpm add @entro314labs/apple-intelligence-sdk
```

If you're using the Tauri bridge, also add the Rust crate:

```bash
cargo add tauri-apple-intelligence
```

## Usage

```ts
import { generateText } from "ai";
import {
  createAppleIntelligenceProvider,
  createTauriAppleIntelligenceTransport,
} from "@entro314labs/apple-intelligence-sdk";

const appleAI = createAppleIntelligenceProvider({
  transport: createTauriAppleIntelligenceTransport(),
});

const { text } = await generateText({
  model: appleAI("apple-on-device"),
  prompt: "Summarize these notes.",
});
```

## Tauri setup (native bridge)

1. Add the Rust commands to your Tauri builder:

```rust
tauri::Builder::default()
  .invoke_handler(tauri::generate_handler![
    tauri_apple_intelligence::apple_ai_check_availability,
    tauri_apple_intelligence::apple_ai_pcc_check_availability,
    tauri_apple_intelligence::apple_ai_generate,
    tauri_apple_intelligence::apple_ai_stream,
    tauri_apple_intelligence::apple_ai_cancel_stream,
    tauri_apple_intelligence::apple_ai_context_info,
    tauri_apple_intelligence::apple_ai_token_count,
    tauri_apple_intelligence::apple_ai_supported_languages,
    tauri_apple_intelligence::apple_ai_prewarm,
  ])
```

2. Ensure your app links `libappleai.dylib` and bundles it as a resource.

3. Use the Tauri transport from your frontend:

```ts
import {
  createAppleIntelligenceProvider,
  createTauriAppleIntelligenceTransport,
} from "@entro314labs/apple-intelligence-sdk";

const appleAI = createAppleIntelligenceProvider({
  transport: createTauriAppleIntelligenceTransport(),
});
```

## Supported features

- Streaming text generation, tool calling (multi-step orchestration via AI SDK), and structured
  output (`generateObject`/`streamObject` with a JSON schema)
- **Model selection** — `appleAI("apple-on-device")` (fast, ~4k context) or
  `appleAI("apple-private-cloud")` (macOS 27 Private Cloud Compute, ~32k context, reasoning-capable,
  still private: no API key, no bill)
- **Portable reasoning** — the AI SDK's top-level `reasoning` option maps onto Apple's reasoning
  levels (`minimal`/`low` → light, `medium` → moderate, `high`/`xhigh` → deep). A
  `providerOptions["apple-intelligence"].reasoningLevel` override or the model settings'
  `reasoningLevel` are also honored (settings act as the `provider-default`)
- **Per-call sampling** — `temperature` (including `0`), `topP`, `topK`, and `seed` map onto
  `GenerationOptions` sampling modes; `toolChoice` (`auto`/`required`/`none`/specific tool) maps
  onto the framework's tool-calling mode
- **Typed errors** — generation failures carry a stable `code`
  (`AppleIntelligenceGenerationError`): guardrail violations and refusals finish with
  `content-filter` instead of throwing; `context-window-exceeded` throws with the model's
  `contextSize` and the offending `tokenCount` so you can condense the conversation and retry
  (Apple's documented recovery strategy)
- **Multimodal image input** — image file parts on a user message are forwarded to the on-device
  model as attachments; `file://` image URLs pass through zero-copy (macOS 27)
- **Real token usage** — `usage` is reported on generate/stream results (macOS 27), including
  reasoning tokens
- **Runtime capability queries** on the transport — `checkPrivateCloudAvailability()`,
  `getContextInfo(model)`, `tokenCount(text, model)` (macOS 26.4+, for budgeting prompts against
  the real context window), `getSupportedLanguages()`, `prewarm(model, promptPrefix?)`
- **Warnings, not silent drops** — unsupported settings (`stopSequences`, penalties) and
  over-budget tool counts (Apple recommends 3–5 tools per request) surface as AI SDK warnings

```ts
const appleAI = createAppleIntelligenceProvider({
  transport: createTauriAppleIntelligenceTransport(),
});

// Private Cloud Compute with portable reasoning:
const { text } = await generateText({
  model: appleAI("apple-private-cloud"),
  reasoning: "high",
  prompt: "Explain the tradeoffs of...",
});
```

### Handling the context window

Apple's on-device model has a 4096-token context window per request. Budget prompts up front and
recover from overflow, per Apple's context-window guidance:

```ts
import { AppleIntelligenceGenerationError } from "@entro314labs/apple-intelligence-sdk";

// Budget before sending (macOS 26.4+):
const { contextSize } = await transport.getContextInfo("on-device"); // 4096
const tokens = await transport.tokenCount(prompt);                    // real tokenizer count

try {
  const { text } = await generateText({ model: appleAI("apple-on-device"), prompt });
} catch (error) {
  if (
    error instanceof AppleIntelligenceGenerationError &&
    error.isContextWindowExceeded
  ) {
    // Condense the conversation (e.g. keep the system message + last turns, or summarize)
    // and retry — a fresh request gets a fresh context window.
  }
}
```

## Platform constraints

- macOS 26+ (Apple Intelligence) for the on-device model, streaming, tools, structured output
- macOS 26.4+ for `tokenCount`
- macOS 27+ for Private Cloud Compute, reasoning, multimodal image input, per-call token usage,
  and native `toolChoice` enforcement
- Apple Silicon (M1+)
- Apple Intelligence enabled in system settings

## Notes

- The Tauri transport uses `apple_ai_*` commands by default. If you change the prefix on the Rust side, pass `commandPrefix` to `createTauriAppleIntelligenceTransport`.
- The transport returns tool calls in AI SDK format, enabling multi-step tool workflows.
- `streamObject` is simulated: guided generation has no incremental stream over the native bridge,
  so the full JSON arrives as a single text delta with a correct `finish`.

## Transport interface

If you want a custom transport (e.g. a future Node bridge), implement `AppleIntelligenceTransport` from the package exports.

---

MIT License.