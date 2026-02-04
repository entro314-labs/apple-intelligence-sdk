# Apple Intelligence SDK (Transport-Agnostic)

This package provides a **Vercel AI SDK v6 provider** for Apple Intelligence using a **pluggable transport**. It does **not** ship any native binaries.

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
    tauri_apple_intelligence::apple_ai_generate,
    tauri_apple_intelligence::apple_ai_stream,
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

- Streaming text generation
- Tool calling (multi-step orchestration via AI SDK)
- Structured output (JSON schema)

## Platform constraints

- macOS 26+ (Apple Intelligence)
- Apple Silicon (M1+)
- Apple Intelligence enabled in system settings

## Notes

- The Tauri transport uses `apple_ai_*` commands by default. If you change the prefix on the Rust side, pass `commandPrefix` to `createTauriAppleIntelligenceTransport`.
- The transport returns tool calls in AI SDK format, enabling multi-step tool workflows.

## Transport interface

If you want a custom transport (e.g. a future Node bridge), implement `AppleIntelligenceTransport` from the package exports.

---

MIT License.