import { NextRequest } from "next/server";
import ZAI from "z-ai-web-dev-sdk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SYSTEM_PROMPT = `You are Pavan, an autonomous AI software creator that turns natural-language ideas into complete, production-ready applications.

You converse with the user in a calm, concise, confident tone. You do NOT ask the user to write code or open an editor — you handle everything behind the scenes: requirement analysis, planning, architecture, stack selection, code generation, building, self-healing, testing, documentation, packaging, and deployment preparation.

When the user describes what they want to build:
1. Briefly confirm your understanding (1-2 sentences).
2. State the project type and the stack you have chosen and why (1-2 sentences). The engine picks the best toolchain automatically — e.g. WinUI 3/WPF/Tauri/Electron for Windows, Kotlin/Flutter for Android, Next.js for web/marketing, Rust/Go for CLI, etc.
3. Give a short, scannable plan (3-6 bullet points) of what you will build.
4. Reassure the user that building, testing, and packaging will happen automatically and they can watch progress in the status panel and live preview.

Keep responses compact and readable. Use short paragraphs and bullet points. Never emit raw code blocks unless the user explicitly asks. Never claim to be a generic assistant — you are Pavan, the autonomous software creator.

If the user asks a follow-up question, answer it directly and briefly, relating it to their project when relevant.`;

interface ChatRequestBody {
  messages: { role: "user" | "assistant" | "system"; content: string }[];
}

export async function POST(req: NextRequest) {
  let body: ChatRequestBody;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const userMessages = Array.isArray(body.messages) ? body.messages : [];
  if (userMessages.length === 0) {
    return new Response(JSON.stringify({ error: "messages is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const messages = [
    { role: "system" as const, content: SYSTEM_PROMPT },
    ...userMessages.map((m) => ({
      role: (m.role === "assistant" ? "assistant" : "user") as "user" | "assistant",
      content: m.content,
    })),
  ];

  let zai;
  try {
    zai = await ZAI.create();
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Model runtime unavailable", detail: String(err) }),
      { status: 502, headers: { "Content-Type": "application/json" } }
    );
  }

  let upstream: ReadableStream<Uint8Array> | null = null;
  try {
    upstream = (await zai.chat.completions.create({
      messages,
      stream: true,
      thinking: { type: "disabled" },
    })) as ReadableStream<Uint8Array>;
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Chat completion failed", detail: String(err) }),
      { status: 502, headers: { "Content-Type": "application/json" } }
    );
  }

  if (!upstream) {
    return new Response(
      JSON.stringify({ error: "No stream returned from model" }),
      { status: 502, headers: { "Content-Type": "application/json" } }
    );
  }

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const outStream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = upstream!.getReader();
      let buffer = "";
      let closed = false;
      const safeClose = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          /* controller may already be closed */
        }
      };
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          // SSE frames separated by blank lines
          const frames = buffer.split("\n\n");
          buffer = frames.pop() ?? "";

          for (const frame of frames) {
            const lines = frame.split("\n");
            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed.startsWith("data:")) continue;
              const data = trimmed.slice(5).trim();
              if (data === "[DONE]") {
                // upstream signaled end — let finally close once
                return;
              }
              try {
                const json = JSON.parse(data);
                const delta = json?.choices?.[0]?.delta?.content;
                if (typeof delta === "string" && delta.length > 0) {
                  controller.enqueue(
                    encoder.encode(`data: ${JSON.stringify({ content: delta })}\n\n`)
                  );
                }
              } catch {
                // ignore non-JSON keepalive lines
              }
            }
          }
        }
        // upstream ended without an explicit [DONE] — emit our own terminator
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      } catch (err) {
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ error: String(err) })}\n\n`)
          );
        } catch {
          /* stream may already be closed */
        }
      } finally {
        try {
          reader.releaseLock();
        } catch {
          /* noop */
        }
        safeClose();
      }
    },
  });

  return new Response(outStream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
