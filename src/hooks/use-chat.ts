"use client";

import { useCallback } from "react";
import { useApp } from "@/lib/store";

interface SendOpts {
  prompt: string;
}

export function useChat() {
  const addMessage = useApp((s) => s.addMessage);
  const appendToMessage = useApp((s) => s.appendToMessage);
  const finalizeMessage = useApp((s) => s.finalizeMessage);
  const setStreaming = useApp((s) => s.setStreaming);
  const streaming = useApp((s) => s.streaming);
  const addLog = useApp((s) => s.addLog);
  const chat = useApp((s) => s.chat);

  const send = useCallback(
    async ({ prompt }: SendOpts) => {
      if (streaming) return;

      // The chat panel already added the user message + decision-rationale.
      // We just create a streaming assistant placeholder for the LLM response.
      const assistantId = `a-llm-${Date.now()}`;
      addMessage({
        id: assistantId,
        role: "assistant",
        content: "",
        timestamp: Date.now(),
        streaming: true,
      });
      setStreaming(true);

      // build the conversation history for the model
      const history = [...chat, { id: `u-${Date.now()}`, role: "user" as const, content: prompt, timestamp: Date.now() }]
        .filter((m) => m.role !== "system")
        .map((m) => ({ role: m.role, content: m.content }))
        .slice(-12);

      let got = false;
      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: history }),
        });

        if (!res.ok || !res.body) {
          const txt = await res.text().catch(() => "request failed");
          appendToMessage(assistantId, `I couldn't reach the model right now (${res.status}). ${txt}`);
          finalizeMessage(assistantId);
          setStreaming(false);
          addLog("error", "provider", `Chat request failed: ${res.status}`);
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let realTokens = 0;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const frames = buffer.split("\n\n");
          buffer = frames.pop() ?? "";
          for (const frame of frames) {
            const line = frame.split("\n").find((l) => l.startsWith("data:"));
            if (!line) continue;
            const data = line.slice(5).trim();
            if (data === "[DONE]") continue;
            try {
              const json = JSON.parse(data);
              if (json.content) {
                got = true;
                appendToMessage(assistantId, json.content);
              }
              // Capture real token usage from the provider
              if (json.usage?.total_tokens) {
                realTokens = json.usage.total_tokens;
              }
            } catch {
              /* ignore */
            }
          }
        }

        // Charge real tokens to observability + cost optimizer
        if (realTokens > 0) {
          // Import directly from specific modules to avoid pulling the entire
          // engine barrel (which includes server-only modules like skills/loader.ts
          // that use `fs` and crash the browser bundle).
          const { observability } = await import("@/lib/engine/observability");
          const { tokenBudgetManager } = await import("@/lib/engine/provider-abstraction");
          observability.chargeTokens("planner", realTokens, "new-project");
          tokenBudgetManager.charge("planner", "new-project", realTokens);
          addLog("info", "provider", `Chat used ${realTokens} tokens (real usage from provider)`);
        }

        if (!got) {
          appendToMessage(
            assistantId,
            "I've taken your request and the orchestration engine is working on it. You can follow progress in the status panel and live preview."
          );
        }
        finalizeMessage(assistantId);
      } catch (err) {
        // If we already streamed partial content, finalize gracefully rather
        // than injecting a scary error into the middle of the message.
        if (!got) {
          appendToMessage(
            assistantId,
            `I've taken your request and the orchestration engine is working on it. You can follow progress in the status panel and live preview.`
          );
        }
        finalizeMessage(assistantId);
        addLog("warn", "provider", `Chat stream ended early: ${String(err)}`);
      } finally {
        setStreaming(false);
      }
    },
    [streaming, chat, addMessage, appendToMessage, finalizeMessage, setStreaming, addLog]
  );

  return { send, streaming };
}
