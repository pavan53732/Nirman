"use client";

import { useEffect, useRef, useState } from "react";
import { useApp } from "@/lib/store";
import { useChat } from "@/hooks/use-chat";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Bot, User, Sparkles, Loader2, ArrowUp, CheckCircle2 } from "lucide-react";
import { starterSuggestions } from "@/lib/mock-data";
import { cn } from "@/lib/utils";
<<<<<<< HEAD
import { detectAmbiguity, AMBIGUITY_THRESHOLD, detectTargets } from "@/lib/engine/client";
=======
<<<<<<< HEAD
import { detectAmbiguity, AMBIGUITY_THRESHOLD, detectTargets } from "@/lib/engine/client";
=======
import { detectAmbiguity, AMBIGUITY_THRESHOLD } from "@/lib/engine/skills/ambiguity-detector";
import { detectTargets } from "@/lib/engine/orchestrator";
>>>>>>> 6cd3275feb2c9061668cda39cc2f099425e3ba73
>>>>>>> 2f9f526421ed4c483fe2814e494274bfc8d2ce3a

const suggestionIcons: Record<string, string> = {
  monitor: "🖥️",
  globe: "🌐",
  smartphone: "📱",
  terminal: "⌘",
  bot: "🤖",
  megaphone: "📣",
  layers: "✨",
};

export function ChatPanel() {
  const chat = useApp((s) => s.chat);
  const input = useApp((s) => s.input);
  const setInput = useApp((s) => s.setInput);
  const streaming = useApp((s) => s.streaming);
  const isBuilding = useApp((s) => s.isBuilding);
  const startBuild = useApp((s) => s.startBuild);
  const addLog = useApp((s) => s.addLog);
  const addMessage = useApp((s) => s.addMessage);
  const { send } = useChat();

  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [hasStarted, setHasStarted] = useState(chat.some((m) => m.role === "user"));

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat]);

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 200) + "px";
  }, [input]);

  const submit = async () => {
    const prompt = input.trim();
    if (!prompt || streaming) return;
    setInput("");
    setHasStarted(true);

    // Add user message
    addMessage({
      id: `u-${Date.now()}`,
      role: "user",
      content: prompt,
      timestamp: Date.now(),
    });
    addLog("info", "engine", `Received request: "${prompt.slice(0, 80)}${prompt.length > 80 ? "…" : ""}"`);

    // Step 1: Ambiguity detection
    const ambiguity = detectAmbiguity(prompt);
    addLog("info", "ambiguity-detector", `Ambiguity score ${ambiguity.score.toFixed(2)} (threshold ${AMBIGUITY_THRESHOLD})`);

    if (ambiguity.score > AMBIGUITY_THRESHOLD && ambiguity.question) {
      // Too ambiguous — ask the user, do NOT start build
      addMessage({
        id: `a-${Date.now()}`,
        role: "assistant",
        content: `I need a bit more detail before I start building.\n\n**Why I'm asking:** ${ambiguity.checks.filter((c) => c.matched).map((c) => c.detail).join("; ")}\n\n${ambiguity.question}\n\nWhat platform are you targeting? What core features do you need? Do you need offline support?`,
        timestamp: Date.now(),
      });
      return;
    }

    // Step 2: Clear enough — show decision rationale, then auto-start build
    const targets = detectTargets(prompt);
    const decisionLines = targets.map((t) => {
      const decision = t.policies[0];
      const conf = decision ? ` (${Math.round(decision.confidence * 100)}%)` : "";
      const rationale = decision ? decision.rationale.split("(")[0].trim() : "";
      return `**${t.label}** → ${t.stack}${conf}\n  ${rationale}`;
    }).join("\n\n");

    addMessage({
      id: `a-${Date.now()}`,
      role: "assistant",
      content: `Got it. Understanding your vision for "${prompt}".\n\nAuto-selecting stack via Decision Engine:\n\n${decisionLines}\n\nStarting autonomous build now — I'll handle planning, architecture, code generation, building, testing, and packaging. Watch the status panel for live progress.`,
      timestamp: Date.now(),
    });

    // Step 3: Auto-start the build (no extra click needed)
    startBuild(prompt);
    // Also stream the LLM response for richer conversation
    await send({ prompt });
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const applySuggestion = (prompt: string) => {
    setInput(prompt);
    textareaRef.current?.focus();
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Conversation */}
      <div ref={scrollRef} className="ide-scroll flex-1 min-h-0 overflow-y-auto px-4 py-6 sm:px-8">
        <div className="mx-auto flex max-w-3xl flex-col gap-5">
          {!hasStarted && (
            <div className="flex flex-col items-center text-center pt-6 pb-2">
              <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 ring-1 ring-primary/20">
                <Sparkles className="h-7 w-7 text-primary" />
              </div>
              <h1 className="text-2xl font-semibold tracking-tight text-balance">
                Describe your app idea
              </h1>
              <p className="mt-2 max-w-md text-sm text-muted-foreground text-balance">
                e.g. "Build offline invoicing Windows app with Android companion"
              </p>
            </div>
          )}

          {chat.map((m) => (
            <MessageBubble key={m.id} message={m} />
          ))}

          {!hasStarted && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2">
              {starterSuggestions.map((s) => (
                <button
                  key={s.title}
                  onClick={() => applySuggestion(s.prompt)}
                  className="group flex items-start gap-3 rounded-xl border border-border bg-card/50 p-3 text-left transition hover:border-primary/40 hover:bg-accent/50"
                >
                  <span className="text-lg leading-none mt-0.5">{suggestionIcons[s.icon] ?? "✨"}</span>
                  <span className="flex flex-col gap-0.5 min-w-0">
                    <span className="text-sm font-medium">{s.title}</span>
                    <span className="text-xs text-muted-foreground line-clamp-2">{s.prompt}</span>
                  </span>
                </button>
              ))}
            </div>
          )}

          {streaming && (
            <div className="flex items-center gap-2 pl-11 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
              Pavan is reasoning…
            </div>
          )}
        </div>
      </div>

      {/* Composer */}
      <div className="shrink-0 border-t border-border bg-card/40 px-4 py-3 sm:px-8">
        <div className="mx-auto max-w-3xl">
          <div className="relative rounded-2xl border border-border bg-background shadow-sm focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/15 transition">
            <Textarea
              id="chat-input"
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKey}
              placeholder="Describe what you want to build…  (e.g. a Windows invoicing app, offline-first, with PDF export)"
              className="min-h-[56px] max-h-[200px] resize-none border-0 bg-transparent px-4 py-3.5 pr-14 text-sm shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
              rows={1}
            />
            <Button
              onClick={submit}
              disabled={!input.trim() || streaming}
              size="icon"
              className="absolute bottom-2.5 right-2.5 h-9 w-9 rounded-xl"
              aria-label="Send"
            >
              {streaming ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ArrowUp className="h-4 w-4" />
              )}
            </Button>
          </div>
          <div className="mt-2 flex items-center justify-between px-1">
            <p className="text-[11px] text-muted-foreground">
              The engine handles planning, code, builds, tests & packaging automatically.
            </p>
            <p className="text-[11px] text-muted-foreground hidden sm:block">
              <kbd className="rounded border border-border bg-muted px-1 py-0.5 text-[10px]">⏎</kbd> send ·{" "}
              <kbd className="rounded border border-border bg-muted px-1 py-0.5 text-[10px]">⇧⏎</kbd> newline
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: ReturnType<typeof useApp.getState>["chat"][number] }) {
  if (message.role === "system") {
    return (
      <div className="flex justify-center">
        <div className="rounded-full border border-border bg-muted/40 px-3 py-1 text-[11px] text-muted-foreground">
          {message.content}
        </div>
      </div>
    );
  }

  const isUser = message.role === "user";
  return (
    <div className={cn("flex gap-3", isUser && "flex-row-reverse")}>
      <div
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
          isUser ? "bg-secondary text-secondary-foreground" : "bg-primary text-primary-foreground"
        )}
      >
        {isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
      </div>
      <div className={cn("flex flex-col gap-1 min-w-0 max-w-[85%]", isUser && "items-end")}>
        <div className="text-[11px] text-muted-foreground px-1">
          {isUser ? "You" : "Pavan"}
        </div>
        <div
          className={cn(
            "rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words",
            isUser
              ? "bg-secondary text-secondary-foreground rounded-tr-sm"
              : "bg-card border border-border rounded-tl-sm"
          )}
        >
          {message.content}
          {message.streaming && (
            <span className="ml-0.5 inline-block h-4 w-[2px] translate-y-0.5 bg-primary animate-blink" />
          )}
        </div>
      </div>
    </div>
  );
}
