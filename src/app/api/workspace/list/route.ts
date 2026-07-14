import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import os from "os";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const projectId = url.searchParams.get("projectId");
  const folder = url.searchParams.get("folder");

  if (!projectId || !folder) {
    return NextResponse.json({ error: "projectId and folder required" }, { status: 400 });
  }

  // Prevent path traversal
  if (/[.]{2}|\/\//.test(projectId) || /[.]{2}|\/\//.test(folder)) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }

  const root = path.join(os.tmpdir(), "pavan", projectId, folder);

  try {
    const files: { path: string; content: string; size: number }[] = [];

    const walk = async (dir: string, rel: string) => {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const e of entries) {
        const full = path.join(dir, e.name);
        const relPath = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) {
          await walk(full, relPath);
        } else {
          // Skip node_modules, .next, .git
          if (relPath.includes("node_modules") || relPath.includes(".next") || relPath.includes(".git")) continue;
          try {
            const content = await fs.readFile(full, "utf-8");
            const stat = await fs.stat(full);
            files.push({ path: relPath, content, size: stat.size });
          } catch {
            // skip unreadable files (binary)
          }
        }
      }
    };

    await walk(root, "");
    return NextResponse.json({ files, count: files.length });
  } catch {
    return NextResponse.json({ files: [], count: 0 });
  }
}
