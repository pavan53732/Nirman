import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface TestRequestBody {
  providerId: string;
  apiFormat: "openai-compatible" | "anthropic-compatible";
  baseUrl: string;
  apiKey: string;
  modelName: string;
}

interface TestResult {
  success: boolean;
  latencyMs: number;
  error?: string;
  providerId: string;
  apiFormat: string;
  modelFound?: boolean;
  maskedKey?: string;
}

function maskKey(key: string): string {
  if (!key) return "(none)";
  if (key.length <= 8) return `${key.slice(0, 2)}...${key.slice(-2)}`;
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

export async function POST(req: NextRequest) {
  let body: TestRequestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { providerId, apiFormat, baseUrl, apiKey, modelName } = body;

  if (!baseUrl || !/^https?:\/\/.+/.test(baseUrl)) {
    return NextResponse.json({
      success: false,
      latencyMs: 0,
      error: "Base URL must start with http:// or https://",
      providerId,
      apiFormat,
    } as TestResult);
  }

  if (!modelName) {
    return NextResponse.json({
      success: false,
      latencyMs: 0,
      error: "Model name is required",
      providerId,
      apiFormat,
    } as TestResult);
  }

  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    let url: string;
    let headers: Record<string, string>;
    let requestBody: Record<string, unknown>;

    if (apiFormat === "anthropic-compatible") {
      // Anthropic uses /v1/messages. If baseUrl already ends with /v1, use /messages.
      const trimmed = baseUrl.replace(/\/$/, "");
      url = trimmed.endsWith("/v1")
        ? `${trimmed}/messages`
        : `${trimmed}/v1/messages`;
      headers = {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      };
      requestBody = {
        model: modelName,
        max_tokens: 1,
        messages: [{ role: "user", content: "hi" }],
      };
    } else {
      // OpenAI compatible: /chat/completions + Bearer token
      const trimmed = baseUrl.replace(/\/$/, "");
      url = `${trimmed}/chat/completions`;
      headers = {
        "Content-Type": "application/json",
      };
      // Ollama doesn't need an API key
      if (providerId !== "ollama" || apiKey) {
        headers["Authorization"] = `Bearer ${apiKey}`;
      }
      requestBody = {
        model: modelName,
        messages: [{ role: "user", content: "hi" }],
        max_tokens: 1,
        temperature: 0,
      };
    }

    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });

    clearTimeout(timeout);
    const latencyMs = Date.now() - startedAt;

    if (res.status === 401) {
      return NextResponse.json({
        success: false,
        latencyMs,
        error: "Invalid API Key — 401 Unauthorized",
        providerId,
        apiFormat,
        maskedKey: maskKey(apiKey),
      } as TestResult);
    }

    if (res.status === 404) {
      const errText = await res.text().catch(() => "");
      if (/model/i.test(errText)) {
        return NextResponse.json({
          success: false,
          latencyMs,
          error: `Model '${modelName}' not found at provider`,
          providerId,
          apiFormat,
        } as TestResult);
      }
      return NextResponse.json({
        success: false,
        latencyMs,
        error: `404 Not Found — check Base URL (${url})`,
        providerId,
        apiFormat,
      } as TestResult);
    }

    if (res.status === 429) {
      return NextResponse.json({
        success: false,
        latencyMs,
        error: "Rate limited (429) — try again later",
        providerId,
        apiFormat,
      } as TestResult);
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      const errMsg = errText.slice(0, 200);
      return NextResponse.json({
        success: false,
        latencyMs,
        error: `HTTP ${res.status}: ${errMsg}`,
        providerId,
        apiFormat,
      } as TestResult);
    }

    // 200 — success
    return NextResponse.json({
      success: true,
      latencyMs,
      providerId,
      apiFormat,
      modelFound: true,
      maskedKey: maskKey(apiKey),
    } as TestResult);
  } catch (err) {
    clearTimeout(timeout);
    const latencyMs = Date.now() - startedAt;
    const isAbort = err instanceof Error && err.name === "AbortError";
    return NextResponse.json({
      success: false,
      latencyMs,
      error: isAbort
        ? "Connection timed out (8s) — check Base URL and network"
        : `Connection failed: ${err instanceof Error ? err.message : String(err)}`,
      providerId,
      apiFormat,
    } as TestResult);
  }
}
