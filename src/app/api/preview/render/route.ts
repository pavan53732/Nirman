import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import os from "os";
import { renderXaml } from "@/lib/preview/xaml-renderer";
import { renderCompose } from "@/lib/preview/compose-renderer";
import { artifactRegistry } from "@/lib/engine/artifact-registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/preview/render?target=windows|android&projectId=<id>
 *
 * V2 path: queries the Artifact Registry for the latest UI file produced by
 * the build pipeline, then reads its content from the materialized workspace.
 * If the registry is empty (e.g. project built before the V2 wiring landed)
 * OR the registry-listed file is missing on disk, the route falls back to
 * walking the workspace folder — preserving the original V1 behavior.
 *
 * The response includes a `source` field indicating where the UI file came
 * from: `"artifact-registry"` (V2 path) or `"filesystem"` (V1 fallback).
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
    // 1. V2 path — try the Artifact Registry first.
    // The registry stores the latest versioned metadata for each generated
    // file (path, version, hash, producedBy, targetId, ...). Content is NOT
    // stored on the record (it's hashed for dedup, not retained), so after
    // picking the artifact we read its bytes from the materialized workspace.
    let uiFile: { path: string; content: string } | null = null;
    let codeBehind: { path: string; content: string } | null = null;
    let source: "artifact-registry" | "filesystem" = "filesystem";

    try {
      const picks = pickUiArtifactsFromRegistry(target);
      if (picks.main) {
        const content = await readWorkspaceFile(root, picks.main.path);
        if (content !== null) {
          uiFile = { path: picks.main.path, content };
          if (picks.codeBehind) {
            const cb = await readWorkspaceFile(root, picks.codeBehind.path);
            if (cb !== null) {
              codeBehind = { path: picks.codeBehind.path, content: cb };
            }
          }
          source = "artifact-registry";
        }
      }
    } catch {
      // Artifact registry unavailable — fall through to filesystem fallback.
    }

    // 2. V1 path — filesystem fallback (backward compat).
    // Used when the registry is empty (project built before V2 wiring) or
    // when the registry-listed file is missing on disk (workspace cleared).
    if (!uiFile) {
      source = "filesystem";
      uiFile = await findMainUiFile(root, target);
    }

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
    // resolve `Title = "..."` set in the MainWindow constructor. Use the
    // registry-provided code-behind if we have it; otherwise filesystem lookup.
    let sourceContent = uiFile.content;
    if (target === "windows") {
      const cb = codeBehind ?? (await findCodeBehind(root, uiFile.path));
      if (cb) {
        sourceContent = `${uiFile.content}\n\n<!-- code-behind: ${cb.path} -->\n${cb.content}`;
      }
    }

    const rendered =
      target === "windows"
        ? renderXaml(sourceContent)
        : renderCompose(uiFile.content);

    return NextResponse.json({
      target,
      file: uiFile.path,
      source, // "artifact-registry" | "filesystem"
      ...rendered,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

/**
 * Query the Artifact Registry for the latest UI file (and Windows code-behind).
 *
 * Uses the Wave 3A `query({ pathContains })` API — the V2 path the audit
 * brief asks for in Step 9. Mirrors the filesystem walker's scoring
 * (MainWindow +10, Views +3, App.xaml -5; ListScreen +10, ui/screens +3)
 * so the same file gets picked regardless of source. Tiebreaker: highest
 * version, then newest createdAt — this ensures the registry always surfaces
 * the most recent generation.
 *
 * Note on `pathContains: ".xaml"`: substring match also catches
 * `MainWindow.xaml.cs` (the code-behind). We exclude those with an explicit
 * `endsWith(".xaml")` filter so the main UI pick is never a code-behind file.
 * The code-behind is then located by appending `.cs` to the picked XAML path.
 */
function pickUiArtifactsFromRegistry(
  target: "windows" | "android",
): {
  main: { path: string } | null;
  codeBehind: { path: string } | null;
} {
  const candidates =
    target === "windows"
      ? artifactRegistry.query({ pathContains: ".xaml" })
      : artifactRegistry.query({ pathContains: "Screen.kt" });

  // For Windows, exclude .xaml.cs code-behind files (their path ends in .cs,
  // not .xaml — substring match catches them but endsWith does not).
  const isUi = (p: string) =>
    target === "windows" ? p.endsWith(".xaml") : /Screen\.kt$/.test(p);

  const scored = candidates
    .filter((a) => isUi(a.path))
    .map((a) => {
      let score = 1;
      if (target === "windows") {
        if (a.path.includes("MainWindow")) score += 10;
        if (a.path.includes("Views")) score += 3;
        if (a.path.includes("App.xaml")) score -= 5;
      } else {
        if (a.path.includes("ListScreen")) score += 10;
        if (a.path.includes("ui/screens")) score += 3;
      }
      // Tiebreaker: prefer higher version, then newer createdAt.
      score += a.version * 0.01;
      score += a.createdAt / 1e12; // ms-since-epoch normalized to a small bump
      return { path: a.path, score };
    })
    .sort((a, b) => b.score - a.score);

  const main = scored[0] ?? null;

  // Windows: also try to find the .xaml.cs code-behind sibling.
  let codeBehind: { path: string } | null = null;
  if (target === "windows" && main && main.path.endsWith(".xaml")) {
    const csPath = `${main.path}.cs`;
    const cb = candidates.find((a) => a.path === csPath);
    if (cb) codeBehind = { path: cb.path };
  }

  return { main: main ? { path: main.path } : null, codeBehind };
}

/** Read a file from the workspace by relative path. Returns null if missing. */
async function readWorkspaceFile(
  root: string,
  relPath: string,
): Promise<string | null> {
  const full = path.join(root, relPath);
  try {
    return await fs.readFile(full, "utf-8");
  } catch {
    return null;
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
