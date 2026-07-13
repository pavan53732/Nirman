// Export Manager — final stage of the Export Project workflow.
// Uses Platform Adapters' packagingTools. Assembles the complete versioned
// solution from the Artifact Registry: /backend /desktop /android /web-admin
// /docs /artifacts + DecisionLog.json + architecture files.
// Implementation: File System Access API (showDirectoryPicker) when available;
// falls back to a zip download. Must work offline.

import type { ProjectMeta } from "./types";
import { artifactRegistry, projectMemory, registries, generateForTarget } from "./engine";

export interface ExportResult {
  ok: boolean;
  message: string;
  path: string;
  fileCount: number;
}

interface VirtualFile {
  path: string;
  content: string;
}

/** Assemble the virtual solution tree from project + generators + memory. */
function assembleSolution(project: ProjectMeta): VirtualFile[] {
  const files: VirtualFile[] = [];

  // Per-target folders: invoke the real generator for each target and place
  // its output files under the platform-appropriate folder.
  for (const t of project.targets) {
    const folder =
      t.kind === "windows" ? "desktop" :
      t.kind === "android" ? "android" :
      t.kind === "web" ? "web-admin" :
      t.kind === "api" ? "backend" :
      t.kind === "cli" ? "cli" :
      t.kind === "library" ? "library" : "app";
    const gen = generateForTarget(t.kind, t.stack, project.name, t.id);
    for (const f of gen.files) {
      files.push({ path: `${folder}/${f.path}`, content: f.content });
    }
    files.push({ path: `${folder}/.pavan/target.json`, content: JSON.stringify({ id: t.id, kind: t.kind, label: t.label, role: t.role, stack: t.stack }, null, 2) });
  }

  // Shared backend if multi-target
  if (project.targets.length > 1) {
    files.push({ path: `backend/README.md`, content: `# ${project.name} — Shared Backend\n\nShared API + data layer for the multi-target solution.\n` });
  }

  // Docs
  files.push({ path: `docs/architecture.md`, content: `# ${project.name} — Architecture\n\n${project.description}\n\n## Targets\n${project.targets.map((t) => `- **${t.label}** (${t.stack}) — ${t.role}`).join("\n")}\n` });
  files.push({ path: `docs/README.md`, content: `# ${project.name} Documentation\n` });

  // Artifacts manifest (from Artifact Registry)
  const arts = artifactRegistry.all();
  files.push({ path: `artifacts/manifest.json`, content: JSON.stringify(arts.map((a) => ({ name: a.name, version: a.version, hash: a.hash, producedBy: a.producedBy, stage: a.stageId, type: a.type })), null, 2) });

  // Decision Log (from Decision Memory)
  const decisions = projectMemory.read("decision");
  const requirements = projectMemory.read("requirements");
  files.push({
    path: `DecisionLog.json`,
    content: JSON.stringify({
      project: project.name,
      generatedAt: new Date().toISOString(),
      requirements: requirements.map((r) => ({ title: r.title, content: r.content, version: r.version })),
      decisions: decisions.map((d) => {
        let parsed: unknown = d.content;
        try { parsed = JSON.parse(d.content); } catch { /* keep string */ }
        return { title: d.title, version: d.version, ...((typeof parsed === "object" && parsed ? parsed : { content: d.content }) as object) };
      }),
    }, null, 2),
  });

  // Top-level README
  files.push({ path: `README.md`, content: `# ${project.name}\n\n${project.description}\n\n## Built with Pavan\nThis project was designed, implemented, tested, and packaged by the Pavan autonomous orchestration engine.\n\n## Targets\n${project.targets.map((t) => `- ${t.label} — ${t.stack}`).join("\n")}\n\n## Structure\n- \`/desktop\` — Windows desktop app\n- \`/android\` — Android app\n- \`/web-admin\` — Web admin portal\n- \`/backend\` — Shared backend & API\n- \`/docs\` — Architecture & user docs\n- \`/artifacts\` — Build artifacts manifest\n- \`DecisionLog.json\` — Engine decision log\n` });

  void registries;
  return files;
}

/** Try the File System Access API to write to a real folder the user picks. */
async function tryFileSystemAccess(files: VirtualFile[]): Promise<boolean> {
  const w = window as unknown as { showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle> };
  if (!w.showDirectoryPicker) return false;
  try {
    const dirHandle = await w.showDirectoryPicker();
    for (const f of files) {
      const parts = f.path.split("/");
      let current = dirHandle;
      for (let i = 0; i < parts.length - 1; i++) {
        current = await current.getDirectoryHandle(parts[i], { create: true });
      }
      const fileHandle = await current.getFileHandle(parts[parts.length - 1], { create: true });
      const writable = await (fileHandle as unknown as { createWritable: () => Promise<{ write: (s: string) => Promise<void>; close: () => Promise<void> }> }).createWritable();
      await writable.write(f.content);
      await writable.close();
    }
    return true;
  } catch {
    return false; // user cancelled or permission denied
  }
}

/** Fallback: build a minimal zip in-memory and trigger a download. */
function downloadZipFallback(files: VirtualFile[], projectName: string): void {
  // Minimal ZIP writer (store method, no compression) — works offline, no deps.
  const blob = buildZip(files);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${projectName.replace(/[^a-zA-Z0-9]/g, "")}.zip`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Minimal ZIP (uncompressed/store) builder — CRC32 + local file headers + central dir.
function buildZip(files: VirtualFile[]): Blob {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  const crcTable = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  const crc32 = (data: Uint8Array) => {
    let c = 0xffffffff;
    for (let i = 0; i < data.length; i++) c = crcTable[(c ^ data[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const u16 = (n: number) => [n & 0xff, (n >>> 8) & 0xff];
  const u32 = (n: number) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];

  for (const f of files) {
    const nameBytes = enc.encode(f.path);
    const dataBytes = enc.encode(f.content);
    const crc = crc32(dataBytes);
    const local = new Uint8Array([
      0x50, 0x4b, 0x03, 0x04, 20, 0, 0, 0, 0, 0, ...u16(0), ...u16(0), ...u32(crc),
      ...u32(dataBytes.length), ...u32(dataBytes.length), ...u16(nameBytes.length), ...u16(0),
      ...nameBytes, ...dataBytes,
    ]);
    chunks.push(local);
    const cent = new Uint8Array([
      0x50, 0x4b, 0x01, 0x02, 20, 0, 20, 0, 0, 0, 0, 0, ...u16(0), ...u16(0),
      ...u32(crc), ...u32(dataBytes.length), ...u32(dataBytes.length),
      ...u16(nameBytes.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
      ...u32(0), ...u32(offset), ...nameBytes,
    ]);
    central.push(cent);
    offset += local.length;
  }
  const centralOffset = offset;
  let centralSize = 0;
  for (const c of central) centralSize += c.length;
  const end = new Uint8Array([
    0x50, 0x4b, 0x05, 0x06, 0, 0, 0, 0,
    ...u16(files.length), ...u16(files.length), ...u32(centralSize), ...u32(centralOffset), ...u16(0),
  ]);
  return new Blob([...chunks, ...central, end], { type: "application/zip" });
}

/** Public: export the active project to a folder (or zip fallback). */
export async function exportSolution(project: ProjectMeta, requestedPath: string): Promise<ExportResult> {
  const files = assembleSolution(project);
  const wrote = await tryFileSystemAccess(files);
  if (wrote) {
    return {
      ok: true,
      message: `Exported ${files.length} files to folder via File System Access API.`,
      path: requestedPath,
      fileCount: files.length,
    };
  }
  downloadZipFallback(files, project.name);
  return {
    ok: true,
    message: `Folder picker unavailable — downloaded ${project.name}.zip (${files.length} files) instead.`,
    path: requestedPath,
    fileCount: files.length,
  };
}
