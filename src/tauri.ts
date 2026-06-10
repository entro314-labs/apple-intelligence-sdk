import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  AppleIntelligenceGenerateOptions,
  AppleIntelligenceGenerateResult,
  AppleIntelligenceStreamEvent,
  AppleIntelligenceStreamOptions,
  AppleIntelligenceTransport,
  AppleIntelligenceAvailability,
} from "./transport";

type StreamStart = {
  streamId: string;
  eventName: string;
};

export type TauriAppleIntelligenceTransportOptions = {
  commandPrefix?: string;
};

export function createTauriAppleIntelligenceTransport(
  options: TauriAppleIntelligenceTransportOptions = {}
): AppleIntelligenceTransport {
  const prefix = options.commandPrefix ?? "apple_ai";

  const command = (name: string) => `${prefix}_${name}`;

  return {
    async checkAvailability(): Promise<AppleIntelligenceAvailability> {
      return invoke(command("check_availability"));
    },

    async generate(
      request: AppleIntelligenceGenerateOptions
    ): Promise<AppleIntelligenceGenerateResult> {
      return invoke(command("generate"), { request });
    },

    async *stream(
      request: AppleIntelligenceStreamOptions
    ): AsyncIterable<AppleIntelligenceStreamEvent> {
      // The abort signal stays on this side of the IPC boundary — it is not serializable.
      const { abortSignal, ...payload } = request;
      const start = await invoke<StreamStart>(command("stream"), {
        request: payload,
      });

      // Abort → host-side cancel. The cancelled stream still terminates through its normal
      // `done` event (emitted by the native cancellation handler), which ends the iterator and
      // detaches the listener below; a stale abort after completion is a no-op on the host.
      const cancel = () => {
        void invoke(command("cancel_stream"), { streamId: start.streamId });
      };
      if (abortSignal?.aborted) {
        cancel();
      } else {
        abortSignal?.addEventListener("abort", cancel, { once: true });
      }

      const queue: AppleIntelligenceStreamEvent[] = [];
      let done = false;
      let pendingResolve:
        | ((value: IteratorResult<AppleIntelligenceStreamEvent>) => void)
        | null = null;

      const unlisten = await listen<AppleIntelligenceStreamEvent>(
        start.eventName,
        (event) => {
          const payload = event.payload;
          if (pendingResolve) {
            pendingResolve({ value: payload, done: false });
            pendingResolve = null;
          } else {
            queue.push(payload);
          }

          if (payload.type === "done" || payload.type === "error") {
            done = true;
            unlisten();
          }
        }
      );

      try {
        while (true) {
          if (queue.length > 0) {
            const value = queue.shift()!;
            yield value;
            if (value.type === "done" || value.type === "error") {
              return;
            }
            continue;
          }

          if (done) {
            return;
          }

          const value = await new Promise<
            IteratorResult<AppleIntelligenceStreamEvent>
          >((resolve) => {
            pendingResolve = resolve;
          });

          if (value.value) {
            yield value.value;
            if (value.value.type === "done" || value.value.type === "error") {
              return;
            }
          }
        }
      } finally {
        if (!done) {
          unlisten();
        }
      }
    },
  } satisfies AppleIntelligenceTransport;
}