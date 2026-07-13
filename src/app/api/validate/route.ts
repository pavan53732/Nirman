import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { runStaticValidator, type ValidationResult } from "@/lib/engine/static-validators";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ValidateRequestBody {
  /** Workspace root path (from /api/workspace POST response). */
  workspacePath: string;
  /** Target type: desktop | android | web */
  target: "desktop" | "android" | "web";
}

interface FileValidation {
  file: string;
  tool: string;
  result: ValidationResult;
}

/** Find key files to validate per target. */
async function findFilesToValidate(workspacePath: string, target: string): Promise<{ file: string; tool: string; opts?: Record<string, unknown> }[]> {
  const out: { file: string; tool: string; opts?: Record<string, unknown> }[] = [];

  if (target === "desktop") {
    // Find .sln, .csproj, MainViewModel.cs
    const findFile = async (pattern: RegExp): Promise<string | null> => {
      const walk = async (dir: string): Promise<string | null> => {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const e of entries) {
          const full = path.join(dir, e.name);
          if (e.isDirectory()) {
            const found = await walk(full);
            if (found) return found;
          } else if (pattern.test(e.name)) {
            return full;
          }
        }
        return null;
      }
      return walk(workspacePath);
    };

    const sln = await findFile(/\.sln$/);
    if (sln) out.push({ file: sln, tool: "xml-validator" });

    const csproj = await findFile(/\.csproj$/);
    if (csproj) out.push({ file: csproj, tool: "xml-validator" });

    const vm = await findFile(/MainViewModel\.cs$/);
    if (vm) out.push({ file: vm, tool: "cs-syntax-check", opts: { requiredClass: "MainViewModel" } });
  }

  if (target === "android") {
    const walk = async (dir: string, acc: string[]): Promise<string[]> => {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) await walk(full, acc);
        else acc.push(full);
      }
      return acc;
    };
    const all = await walk(workspacePath, []);

    const settings = all.find((f) => f.endsWith("settings.gradle.kts"));
    if (settings) out.push({ file: settings, tool: "gradle-kts-syntax-check", opts: { isSettings: true } });

    const appGradle = all.find((f) => f.endsWith("app/build.gradle.kts") || (f.endsWith("build.gradle.kts") && !f.includes("settings")));
    if (appGradle) out.push({ file: appGradle, tool: "gradle-kts-syntax-check", opts: { isSettings: false } });

    const mainActivity = all.find((f) => f.endsWith("MainActivity.kt"));
    if (mainActivity) out.push({ file: mainActivity, tool: "kotlin-syntax-check" });

    const listScreen = all.find((f) => /ListScreen\.kt$/.test(f));
    if (listScreen) out.push({ file: listScreen, tool: "kotlin-syntax-check" });
  }

  return out;
}

export async function POST(req: NextRequest) {
  let body: ValidateRequestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { workspacePath, target } = body;
  if (!workspacePath || !target) {
    return NextResponse.json({ error: "workspacePath and target required" }, { status: 400 });
  }

  try {
    const files = await findFilesToValidate(workspacePath, target);
    if (files.length === 0) {
      return NextResponse.json({
        success: false,
        message: `No files found to validate for ${target} in ${workspacePath}`,
        validations: [],
      });
    }

    const validations: FileValidation[] = [];
    for (const { file, tool, opts } of files) {
      try {
        const content = await fs.readFile(file, "utf-8");
        const relFile = path.relative(workspacePath, file);
        const result = runStaticValidator(
          tool as "xml-validator" | "cs-syntax-check" | "kotlin-syntax-check" | "gradle-kts-syntax-check",
          content,
          relFile,
          opts as { requiredClass?: string; isSettings?: boolean } | undefined
        );
        validations.push({ file: relFile, tool, result });
      } catch (err) {
        validations.push({
          file: path.relative(workspacePath, file),
          tool,
          result: { exitCode: 1, success: false, stdout: "", stderr: `Read error: ${String(err)}`, errors: [String(err)], checks: [] },
        });
      }
    }

    const allPassed = validations.every((v) => v.result.success);
    return NextResponse.json({
      success: allPassed,
      target,
      validations,
      fileCount: validations.length,
    });
  } catch (err) {
    return NextResponse.json({ error: `Validation failed: ${String(err)}` }, { status: 500 });
  }
}
