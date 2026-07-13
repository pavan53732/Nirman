import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import os from "os";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface WorkspaceFile {
  path: string;
  content: string;
}

interface WriteRequestBody {
  projectId: string;
  targetFolder: string; // e.g. "web-admin", "desktop", "android"
  files: WorkspaceFile[];
}

/**
 * Materialize generated virtual files to a real on-disk workspace so the
 * ToolManager can run real compilers/linters against them. Returns the
 * absolute path to the written folder.
 */
export async function POST(req: NextRequest) {
  let body: WriteRequestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { projectId, targetFolder, files } = body;
  if (!projectId || !targetFolder || !files?.length) {
    return NextResponse.json(
      { error: "projectId, targetFolder, and files are required" },
      { status: 400 }
    );
  }

  // Workspace root: os.tmpdir()/pavan/<projectId>/<targetFolder>
  const root = path.join(os.tmpdir(), "pavan", projectId, targetFolder);
  try {
    await fs.mkdir(root, { recursive: true });
    for (const f of files) {
      const fullPath = path.join(root, f.path);
      // Prevent path traversal
      const rel = path.relative(root, fullPath);
      if (rel.startsWith("..") || path.isAbsolute(rel)) {
        return NextResponse.json(
          { error: `Invalid file path: ${f.path}` },
          { status: 400 }
        );
      }
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, f.content, "utf-8");
    }
    return NextResponse.json({ ok: true, path: root, fileCount: files.length });
  } catch (err) {
    return NextResponse.json(
      { error: `Workspace write failed: ${String(err)}` },
      { status: 500 }
    );
  }
}

/** GET: retrieve a file from the workspace (for repair reads). */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const workspacePath = url.searchParams.get("path");
  const filePath = url.searchParams.get("file");
  if (!workspacePath || !filePath) {
    return NextResponse.json({ error: "path and file params required" }, { status: 400 });
  }
  try {
    const fullPath = path.join(workspacePath, filePath);
    const rel = path.relative(workspacePath, fullPath);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      return NextResponse.json({ error: "Invalid path" }, { status: 400 });
    }
    const content = await fs.readFile(fullPath, "utf-8");
    return NextResponse.json({ content });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 404 });
  }
}

/** PATCH: update a file in the workspace (after repair). */
export async function PATCH(req: NextRequest) {
  let body: { path: string; file: string; content: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { path: workspacePath, file, content } = body;
  if (!workspacePath || !file) {
    return NextResponse.json({ error: "path and file required" }, { status: 400 });
  }
  try {
    const fullPath = path.join(workspacePath, file);
    const rel = path.relative(workspacePath, fullPath);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      return NextResponse.json({ error: "Invalid path" }, { status: 400 });
    }
    await fs.writeFile(fullPath, content, "utf-8");
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
