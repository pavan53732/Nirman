import { NextRequest, NextResponse } from "next/server";
import ZAI from "z-ai-web-dev-sdk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RepairRequestBody {
  filePath: string;
  fileContent: string;
  errors: { file: string; line: number; column: number; message: string; code?: string }[];
  language: string;
}

const REPAIR_PROMPT = `You are a code repair agent. You receive a source file and a list of compiler/linter errors. Return the COMPLETE corrected file content that fixes all errors. Return ONLY the file content — no explanation, no markdown fences, no surrounding text. Preserve the file's intent and structure; make the minimal changes needed to fix the errors.`;

export async function POST(req: NextRequest) {
  let body: RepairRequestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { filePath, fileContent, errors, language } = body;
  if (!fileContent || !errors?.length) {
    return NextResponse.json({ error: "fileContent and errors are required" }, { status: 400 });
  }

  let zai;
  try {
    zai = await ZAI.create();
  } catch (err) {
    return NextResponse.json(
      { error: `Model runtime unavailable: ${String(err)}` },
      { status: 502 }
    );
  }

  const errorList = errors
    .map((e) => `${e.file}:${e.line}:${e.column} ${e.code ? `[${e.code}] ` : ""}${e.message}`)
    .join("\n");

  const userMessage = `File: ${filePath}
Language: ${language}

Errors to fix:
${errorList}

Current file content:
\`\`\`
${fileContent}
\`\`\`

Return the complete corrected file content that resolves all errors above.`;

  try {
    const completion = await zai.chat.completions.create({
      messages: [
        { role: "system", content: REPAIR_PROMPT },
        { role: "user", content: userMessage },
      ],
      thinking: { type: "disabled" },
    });

    const patched = completion?.choices?.[0]?.message?.content ?? "";
    const usage = completion?.usage;

    if (!patched) {
      return NextResponse.json({ error: "Model returned empty content" }, { status: 502 });
    }

    // Strip markdown fences if the model added them despite instructions
    const cleaned = patched
      .replace(/^```[a-zA-Z]*\n?/, "")
      .replace(/\n?```$/, "")
      .trim();

    return NextResponse.json({
      patchedContent: cleaned,
      tokensUsed: usage?.total_tokens ?? 0,
      model: "repair",
    });
  } catch (err) {
    return NextResponse.json(
      { error: `Repair failed: ${String(err)}` },
      { status: 502 }
    );
  }
}
