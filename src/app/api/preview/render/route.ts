import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import os from "os";
import { renderXaml } from "@/lib/preview/xaml-renderer";
import { renderCompose } from "@/lib/preview/compose-renderer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/preview/render?target=windows|android&projectId=<id>
 *
 * Loads the main UI file from the project workspace on disk, renders it via
 * the appropriate renderer (XAML → Windows, Kotlin → Android Material 3),
 * and returns the HTML+CSS approximation of the native UI.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const target = url.searchParams.get("target") as "windows" | "android" | null;
  const projectId = url.searchParams.get("projectId");

  if (!target || !projectId) {
    return NextResponse.json(
      { error: "target (windows|android) and projectId are required" },
      { status: 400 },
    );
  }
  if (target !== "windows" && target !== "android") {
    return NextResponse.json(
      { error: `target must be 'windows' or 'android', got '${target}'` },
      { status: 400 },
    );
  }
  // Path traversal guard.
  if (/[.]{2}|\/\//.test(projectId)) {
    return NextResponse.json({ error: "Invalid projectId" }, { status: 400 });
  }

  const folder = target === "windows" ? "desktop" : "android";
  const root = path.join(os.tmpdir(), "pavan", projectId, folder);

  try {
    const uiFile = await findMainUiFile(root, target);
    if (!uiFile) {
      return NextResponse.json(
        {
          error: `No ${target === "windows" ? ".xaml" : "Screen.kt"} file found in workspace. Build the project first.`,
          root,
        },
        { status: 404 },
      );
    }

    // For Windows, also pull the code-behind (.xaml.cs) so the renderer can
    // resolve `Title = "..."` set in the MainWindow constructor.
    let source = uiFile.content;
    if (target === "windows") {
      const codeBehind = await findCodeBehind(root, uiFile.path);
      if (codeBehind) {
        source = `${uiFile.content}\n\n<!-- code-behind: ${codeBehind.path} -->\n${codeBehind.content}`;
      }
    }

    const rendered =
      target === "windows"
        ? renderXaml(source)
        : renderCompose(uiFile.content);

    return NextResponse.json({
      target,
      file: uiFile.path,
      ...rendered,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

/** Walk the workspace folder and find the primary UI file. */
async function findMainUiFile(
  root: string,
  target: "windows" | "android",
): Promise<{ path: string; content: string } | null> {
  let exists = false;
  try {
    await fs.access(root);
    exists = true;
  } catch {
    exists = false;
  }
  if (!exists) return null;

  const matches: { path: string; content: string; score: number }[] = [];

  const walk = async (dir: string, rel: string) => {
    let entries: import("fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      const relPath = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (
          relPath.includes("node_modules") ||
          relPath.includes(".next") ||
          relPath.includes(".git") ||
          relPath.includes("build") ||
          relPath.includes("gradle")
        ) {
          continue;
        }
        await walk(full, relPath);
      } else {
        if (target === "windows") {
          if (!relPath.endsWith(".xaml")) continue;
          let score = 1;
          if (relPath.includes("MainWindow")) score += 10;
          if (relPath.includes("Views")) score += 3;
          if (relPath.includes("App.xaml")) score -= 5;
          try {
            const content = await fs.readFile(full, "utf-8");
            matches.push({ path: relPath, content, score });
          } catch {
            // skip binary / unreadable
          }
        } else {
          if (!relPath.endsWith(".kt")) continue;
          if (!/Screen\.kt$/.test(relPath)) continue;
          let score = 1;
          if (relPath.includes("ListScreen")) score += 10;
          if (relPath.includes("ui/screens")) score += 3;
          try {
            const content = await fs.readFile(full, "utf-8");
            matches.push({ path: relPath, content, score });
          } catch {
            // skip binary / unreadable
          }
        }
      }
    }
  };

  await walk(root, "");

  if (matches.length === 0) return null;
  matches.sort((a, b) => b.score - a.score);
  const best = matches[0];
  return { path: best.path, content: best.content };
}

/** For a given .xaml file, find its sibling .xaml.cs code-behind. */
async function findCodeBehind(
  root: string,
  xamlRelPath: string,
): Promise<{ path: string; content: string } | null> {
  if (!xamlRelPath.endsWith(".xaml")) return null;
  const csRelPath = `${xamlRelPath}.cs`;
  const csFull = path.join(root, csRelPath);
  try {
    const content = await fs.readFile(csFull, "utf-8");
    return { path: csRelPath, content };
  } catch {
    return null;
  }
}
