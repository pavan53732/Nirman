"use client";

import { useMemo, useState, useEffect } from "react";
import { useApp } from "@/lib/store";
import { cn } from "@/lib/utils";
import { Monitor, Smartphone, Globe, RefreshCw, Layers, FileCode, Zap, Eye, Code2 } from "lucide-react";
import type { PreviewTarget, ProjectMeta, TargetSpec } from "@/lib/types";
import { NativePreview } from "./native-preview";

const kindToPreview: Record<string, PreviewTarget> = {
  windows: "windows",
  web: "web",
  android: "android",
};

const previewIcon: Record<PreviewTarget, typeof Monitor> = {
  web: Globe,
  windows: Monitor,
  android: Smartphone,
};

interface WorkspaceFile {
  path: string;
  content: string;
  size: number;
}

export function PreviewPanel() {
  const activeProjectId = useApp((s) => s.activeProjectId);
  const projects = useApp((s) => s.projects);
  const previewTarget = useApp((s) => s.previewTarget);
  const setPreviewTarget = useApp((s) => s.setPreviewTarget);
  const previewReady = useApp((s) => s.previewReady);
  const hotReloading = useApp((s) => s.hotReloading);
  const isBuilding = useApp((s) => s.isBuilding);

  const active = projects.length > 0
    ? (projects.find((p) => p.id === activeProjectId) ?? projects[0])
    : undefined;

  const tabs = useMemo(() => {
    if (!active) return [];
    if (active.targets.length > 1) {
      const seen = new Set<PreviewTarget>();
      return active.targets
        .map((t) => {
          const pt = kindToPreview[t.kind];
          if (!pt || seen.has(pt)) return null;
          seen.add(pt);
          return { id: pt, label: t.label, target: t };
        })
        .filter(Boolean) as { id: PreviewTarget; label: string; target: TargetSpec }[];
    }
    const base = [
      { id: "web" as PreviewTarget, label: "Web", target: undefined },
      { id: "windows" as PreviewTarget, label: "Windows", target: undefined },
      { id: "android" as PreviewTarget, label: "Android", target: undefined },
    ];
    return base
      .filter((t) => active.kind === "android" ? t.id === "android" || t.id === "web" : true)
      .filter((t) => active.kind === "web" ? t.id === "web" || t.id === "windows" : true)
      .map((t) => ({ ...t, target: undefined as TargetSpec | undefined }));
  }, [active]);

  const activeTab = tabs.find((t) => t.id === previewTarget) ?? tabs[0];
  const activeTargetKind = activeTab?.id ?? previewTarget;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground shrink-0">
            Live Preview
          </span>
          {active && active.targets.length > 1 && (
            <span className="flex items-center gap-1 text-[10px] text-muted-foreground shrink-0">
              <Layers className="h-3 w-3" />
              {active.targets.length} targets
            </span>
          )}
          {hotReloading && (
            <span className="flex items-center gap-1 text-[10px] text-primary shrink-0">
              <Zap className="h-3 w-3" /> hot reload
            </span>
          )}
        </div>
        {tabs.length > 0 && (
          <div className="flex items-center gap-0.5 rounded-lg bg-muted/60 p-0.5 overflow-x-auto max-w-full">
            {tabs.map((t) => {
              const Icon = previewIcon[t.id];
              return (
                <button
                  key={t.id}
                  onClick={() => setPreviewTarget(t.id)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium transition whitespace-nowrap",
                    activeTargetKind === t.id
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" />
                  <span className="hidden sm:inline">{t.label}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="relative flex-1 min-h-0 overflow-hidden bg-muted/30 p-3">
        {!active && !isBuilding && <EmptyState />}
        {active && !previewReady && !isBuilding && (
          <EmptyState hasProject={active.name} />
        )}
        {isBuilding && (
          <BuildingState projectName={active?.name} targetKind={activeTargetKind} />
        )}
        {active && previewReady && !isBuilding && (
          <RealPreview project={active} targetKind={activeTargetKind} />
        )}
      </div>
    </div>
  );
}

/* ---- Empty State ---- */
function EmptyState({ hasProject }: { hasProject?: string }) {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="flex flex-col items-center gap-3 text-center max-w-sm">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted ring-1 ring-border">
          <FileCode className="h-7 w-7 text-muted-foreground" />
        </div>
        <div>
          <p className="text-sm font-medium">
            {hasProject ? "Build complete — preview ready" : "No build yet"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {hasProject
              ? "Generated source files are available below. Use Export to download the full solution."
              : "Describe your app idea in the chat. AI will ask for clarification if needed, auto-select the tech stack, and build end to end."}
          </p>
        </div>
      </div>
    </div>
  );
}

/* ---- Building State ---- */
function BuildingState({ projectName, targetKind }: { projectName?: string; targetKind: PreviewTarget }) {
  const label = targetKind === "web" ? "Web" : targetKind === "android" ? "Android" : "Windows";
  return (
    <div className="flex h-full items-center justify-center">
      <div className="flex flex-col items-center gap-3 text-center">
        <div className="relative flex h-16 w-16 items-center justify-center">
          <div className="absolute inset-0 rounded-2xl bg-primary/10 animate-ping" />
          <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 ring-1 ring-primary/20">
            <RefreshCw className="h-6 w-6 text-primary animate-spin" />
          </div>
        </div>
        <div>
          <p className="text-sm font-medium">Generating {label} target…</p>
          <p className="mt-1 text-xs text-muted-foreground max-w-[220px]">
            {projectName ?? "Your app"} · Real source files being generated by the engine.
          </p>
        </div>
      </div>
    </div>
  );
}

/* ---- Real Preview — fetches actual generated files from workspace ---- */
function RealPreview({ project, targetKind }: { project: ProjectMeta; targetKind: PreviewTarget }) {
  const [files, setFiles] = useState<WorkspaceFile[]>([]);
  const [loading, setLoading] = useState(true);
  // "code" shows generated source; "preview" shows the rendered native UI.
  // Only windows + android get the Preview tab — web target already IS the preview.
  const supportsPreview = targetKind === "windows" || targetKind === "android";
  const [mode, setMode] = useState<"code" | "preview">(supportsPreview ? "preview" : "code");

  const target = project.targets.find((t) => kindToPreview[t.kind] === targetKind);
  const folder = target?.kind === "windows" ? "desktop" : target?.kind === "android" ? "android" : "web-admin";

  useEffect(() => {
    if (!project) return;
    let cancelled = false;
    fetch(`/api/workspace/list?projectId=${encodeURIComponent(project.id)}&folder=${encodeURIComponent(folder)}`)
      .then((res) => res.ok ? res.json() : { files: [] })
      .then((data) => {
        if (cancelled) return;
        setFiles(data.files ?? []);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setFiles([]);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [project, folder]);

  // Note: mode is only relevant for windows/android (supportsPreview=true).
  // For the web target, the toggle is hidden and CodeViewer is always shown
  // regardless of the mode value — see the targetKind === "web" branch below.

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (files.length === 0) {
    // For native targets, the preview can render even when the file list is
    // empty here (the render endpoint reads the workspace directly). So show
    // the native preview in preview mode even without a file list.
    if (supportsPreview && mode === "preview") {
      return (
        <div className="flex h-full min-h-0 flex-col">
          <ModeToggle mode={mode} setMode={setMode} supportsPreview={supportsPreview} />
          <div className="flex-1 min-h-0">
            <NativePreview
              target={targetKind as "windows" | "android"}
              projectId={project.id}
              refreshKey={`${project.id}-${folder}-${project.createdAt}`}
            />
          </div>
        </div>
      );
    }
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-2 text-center">
          <FileCode className="h-8 w-8 text-muted-foreground" />
          <p className="text-xs text-muted-foreground">
            Generated files for {folder} not found on disk. Use Export to download them.
          </p>
        </div>
      </div>
    );
  }

  // Preview mode: render the native UI approximation.
  if (mode === "preview" && supportsPreview) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <ModeToggle mode={mode} setMode={setMode} supportsPreview={supportsPreview} />
        <div className="flex-1 min-h-0">
          <NativePreview
            target={targetKind as "windows" | "android"}
            projectId={project.id}
            refreshKey={`${project.id}-${folder}-${project.createdAt}`}
          />
        </div>
      </div>
    );
  }

  // Code mode (default for web, opt-in for windows/android):
  // Web target: show single CodeViewer with file tabs
  if (targetKind === "web") {
    return <CodeViewer files={files} title="Web — Next.js source" />;
  }

  // Desktop target: show split view (XAML + ViewModel)
  if (targetKind === "windows") {
    const xamlFile = files.find((f) => f.path.endsWith(".xaml") && f.path.includes("MainWindow"));
    const vmFile = files.find((f) => f.path.endsWith(".cs") && f.path.includes("MainViewModel"));
    return (
      <div className="flex h-full min-h-0 flex-col">
        <ModeToggle mode={mode} setMode={setMode} supportsPreview={supportsPreview} />
        <div className="flex-1 min-h-0">
          <SplitCodeViewer
            files={files}
            leftFile={xamlFile}
            rightFile={vmFile}
            title="Windows — WinUI 3 source"
            note="Export and open .sln in Visual Studio to run"
          />
        </div>
      </div>
    );
  }

  // Android target: show split view (Screen + MainActivity)
  const screenFile = files.find((f) => f.path.endsWith(".kt") && f.path.includes("ListScreen"));
  const mainFile = files.find((f) => f.path.endsWith(".kt") && f.path.includes("MainActivity"));
  return (
    <div className="flex h-full min-h-0 flex-col">
      <ModeToggle mode={mode} setMode={setMode} supportsPreview={supportsPreview} />
      <div className="flex-1 min-h-0">
        <SplitCodeViewer
          files={files}
          leftFile={screenFile}
          rightFile={mainFile}
          title="Android — Jetpack Compose source"
          note="Export and open in Android Studio to run"
        />
      </div>
    </div>
  );
}

/* ---- Mode toggle (Code | Preview) shown above windows/android views ---- */
function ModeToggle({
  mode,
  setMode,
  supportsPreview,
}: {
  mode: "code" | "preview";
  setMode: (m: "code" | "preview") => void;
  supportsPreview: boolean;
}) {
  if (!supportsPreview) return null;
  return (
    <div className="flex shrink-0 items-center justify-end gap-0.5 border-b border-border bg-muted/30 px-3 py-1.5">
      <div className="flex items-center gap-0.5 rounded-lg bg-muted/60 p-0.5">
        <button
          onClick={() => setMode("preview")}
          className={cn(
            "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-medium transition",
            mode === "preview"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
          aria-pressed={mode === "preview"}
        >
          <Eye className="h-3.5 w-3.5" />
          Preview
        </button>
        <button
          onClick={() => setMode("code")}
          className={cn(
            "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-medium transition",
            mode === "code"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
          aria-pressed={mode === "code"}
        >
          <Code2 className="h-3.5 w-3.5" />
          Code
        </button>
      </div>
    </div>
  );
}

/* ---- Single Code Viewer (web target) ---- */
function CodeViewer({ files, title }: { files: WorkspaceFile[]; title: string }) {
  const [selected, setSelected] = useState(0);

  // Auto-select the most interesting file (dashboard page)
  useEffect(() => {
    const idx = files.findIndex((f) => f.path.includes("dashboard") && f.path.endsWith("page.tsx"));
    if (idx >= 0) {
      queueMicrotask(() => setSelected(idx));
    }
  }, [files]);

  const file = files[selected];
  if (!file) return null;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-background">
      <div className="flex shrink-0 items-center justify-between border-b border-border bg-muted/30 px-3 py-1.5">
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{title}</span>
        <span className="text-[9px] text-muted-foreground">{files.length} files</span>
      </div>
      {/* File tabs */}
      <div className="flex shrink-0 overflow-x-auto border-b border-border bg-muted/20">
        {files.map((f, i) => (
          <button
            key={f.path}
            onClick={() => setSelected(i)}
            className={cn(
              "shrink-0 px-2.5 py-1 text-[10px] font-mono border-r border-border transition",
              selected === i
                ? "bg-background text-foreground font-medium border-b-2 border-b-primary"
                : "text-muted-foreground hover:text-foreground hover:bg-background/50"
            )}
            title={`${f.path} (${(f.size / 1024).toFixed(1)} KB)`}
          >
            {f.path.split("/").pop()}
          </button>
        ))}
      </div>
      {/* File content with line numbers */}
      <div className="ide-scroll flex-1 min-h-0 overflow-auto bg-zinc-950">
        <CodeBlock content={file.content} path={file.path} size={file.size} />
      </div>
      {/* Status bar */}
      <div className="shrink-0 flex items-center justify-between border-t border-border bg-muted/20 px-3 py-1">
        <span className="text-[9px] text-muted-foreground font-mono truncate">{file.path}</span>
        <span className="text-[9px] text-muted-foreground">{(file.size / 1024).toFixed(1)} KB · {file.content.split("\n").length} lines</span>
      </div>
    </div>
  );
}

/* ---- Split Code Viewer (desktop + android targets) ---- */
function SplitCodeViewer({
  files,
  leftFile,
  rightFile,
  title,
  note,
}: {
  files: WorkspaceFile[];
  leftFile?: WorkspaceFile;
  rightFile?: WorkspaceFile;
  title: string;
  note: string;
}) {
  const [allFiles] = useState(files);
  const [leftIdx, setLeftIdx] = useState(0);
  const [rightIdx, setRightIdx] = useState(1);

  // Auto-select the recommended files
  useEffect(() => {
    let lIdx = 0;
    let rIdx = 1;
    if (leftFile) {
      const idx = files.findIndex((f) => f.path === leftFile.path);
      if (idx >= 0) lIdx = idx;
    }
    if (rightFile) {
      const idx = files.findIndex((f) => f.path === rightFile.path);
      if (idx >= 0) rIdx = idx;
    }
    // Use a microtask to avoid synchronous setState in effect
    queueMicrotask(() => {
      setLeftIdx(lIdx);
      setRightIdx(rIdx);
    });
  }, [leftFile, rightFile, files]);

  const left = allFiles[leftIdx];
  const right = allFiles[rightIdx];

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-background">
      <div className="flex shrink-0 items-center justify-between border-b border-border bg-muted/30 px-3 py-1.5">
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{title}</span>
        <span className="text-[9px] text-muted-foreground">{note}</span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
        {/* Left panel */}
        <div className="flex min-h-0 flex-1 flex-col border-b border-border sm:border-b-0 sm:border-r">
          <FileSelector files={allFiles} selected={leftIdx} onSelect={setLeftIdx} />
          <div className="ide-scroll flex-1 min-h-0 overflow-auto bg-zinc-950">
            {left && <CodeBlock content={left.content} path={left.path} size={left.size} />}
          </div>
        </div>
        {/* Right panel */}
        <div className="flex min-h-0 flex-1 flex-col">
          <FileSelector files={allFiles} selected={rightIdx} onSelect={setRightIdx} />
          <div className="ide-scroll flex-1 min-h-0 overflow-auto bg-zinc-950">
            {right && <CodeBlock content={right.content} path={right.path} size={right.size} />}
          </div>
        </div>
      </div>
      <div className="shrink-0 flex items-center justify-between border-t border-border bg-muted/20 px-3 py-1">
        <span className="text-[9px] text-muted-foreground font-mono truncate">
          L: {left?.path ?? "—"} · R: {right?.path ?? "—"}
        </span>
        <span className="text-[9px] text-muted-foreground">{allFiles.length} files total</span>
      </div>
    </div>
  );
}

/* ---- File selector dropdown ---- */
function FileSelector({
  files,
  selected,
  onSelect,
}: {
  files: WorkspaceFile[];
  selected: number;
  onSelect: (i: number) => void;
}) {
  return (
    <div className="flex shrink-0 overflow-x-auto border-b border-border bg-muted/20">
      {files.map((f, i) => (
        <button
          key={f.path}
          onClick={() => onSelect(i)}
          className={cn(
            "shrink-0 px-2 py-1 text-[10px] font-mono border-r border-border transition",
            selected === i
              ? "bg-background text-foreground font-medium border-b-2 border-b-primary"
              : "text-muted-foreground hover:text-foreground hover:bg-background/50"
          )}
          title={`${f.path} (${(f.size / 1024).toFixed(1)} KB)`}
        >
          {f.path.split("/").pop()}
        </button>
      ))}
    </div>
  );
}

/* ---- Code block with line numbers ---- */
function CodeBlock({ content, path, size }: { content: string; path: string; size: number }) {
  const lines = content.split("\n");
  const ext = path.split(".").pop() ?? "txt";

  return (
    <div className="flex">
      {/* Line numbers */}
      <div className="shrink-0 select-none border-r border-zinc-800 px-2 py-3 text-right font-mono text-[10px] leading-relaxed text-zinc-600">
        {lines.map((_, i) => (
          <div key={i}>{i + 1}</div>
        ))}
      </div>
      {/* Code */}
      <pre className="flex-1 overflow-x-auto py-3 pl-3 pr-4 text-[11px] leading-relaxed font-mono text-zinc-300">
        <code>{content}</code>
      </pre>
    </div>
  );
}
