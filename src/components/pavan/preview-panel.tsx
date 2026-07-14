"use client";

import { useMemo, useState, useEffect } from "react";
import { useApp } from "@/lib/store";
import { cn } from "@/lib/utils";
import { Monitor, Smartphone, Globe, RefreshCw, Layers, FileCode, Zap } from "lucide-react";
import type { PreviewTarget, ProjectMeta, TargetSpec } from "@/lib/types";

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
        {!active && !isBuilding && (
          <EmptyPreview />
        )}
        {active && !previewReady && !isBuilding && (
          <EmptyPreview hasProject={active.name} />
        )}
        {isBuilding && (
          <BuildingPreview projectName={active?.name} targetKind={activeTargetKind} />
        )}
        {active && previewReady && !isBuilding && (
          <CodeViewer project={active} targetKind={activeTargetKind} />
        )}
      </div>
    </div>
  );
}

/** Empty state — no build yet */
function EmptyPreview({ hasProject }: { hasProject?: string }) {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="flex flex-col items-center gap-3 text-center max-w-xs">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted ring-1 ring-border">
          <FileCode className="h-7 w-7 text-muted-foreground" />
        </div>
        <div>
          <p className="text-sm font-medium">
            {hasProject ? "Build complete — preview ready" : "No build yet"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {hasProject
              ? "Generated source files are available. Use Export to download the full solution."
              : "Describe your app idea in the chat to generate a real preview."}
          </p>
        </div>
      </div>
    </div>
  );
}

/** Building state — spinner with real status */
function BuildingPreview({ projectName, targetKind }: { projectName?: string; targetKind: PreviewTarget }) {
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

/**
 * Code Viewer — shows real generated source files from the workspace.
 * Fetches file listing from /api/workspace and displays actual file contents.
 * No mock UI — only real generated code.
 */
function CodeViewer({ project, targetKind }: { project: ProjectMeta; targetKind: PreviewTarget }) {
  const [files, setFiles] = useState<{ path: string; content: string; size: number }[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const target = project.targets.find((t) => kindToPreview[t.kind] === targetKind);
  const folder = target?.kind === "windows" ? "desktop" : target?.kind === "android" ? "android" : "web-admin";

  useEffect(() => {
    if (!project) return;
    let cancelled = false;
    // Fetch the generated files from the workspace API
    const projectId = project.id;
    fetch(`/api/workspace/list?projectId=${encodeURIComponent(projectId)}&folder=${encodeURIComponent(folder)}`)
      .then((res) => res.ok ? res.json() : { files: [] })
      .then((data) => {
        if (cancelled) return;
        const fileList = data.files ?? [];
        setFiles(fileList);
        if (fileList.length > 0 && !selectedFile) {
          setSelectedFile(fileList[0].path);
        }
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setFiles([]);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [project, folder, selectedFile]);

  const selectedContent = files.find((f) => f.path === selectedFile)?.content ?? "";
  const fileExt = selectedFile?.split(".").pop() ?? "txt";

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (files.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-2 text-center">
          <FileCode className="h-8 w-8 text-muted-foreground" />
          <p className="text-xs text-muted-foreground">
            Generated files for {folder} not found on disk. Export to download them.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-background">
      {/* File tabs */}
      <div className="flex shrink-0 overflow-x-auto border-b border-border bg-muted/30">
        {files.map((f) => (
          <button
            key={f.path}
            onClick={() => setSelectedFile(f.path)}
            className={cn(
              "shrink-0 px-3 py-1.5 text-[10px] font-mono border-r border-border transition",
              selectedFile === f.path
                ? "bg-background text-foreground font-medium"
                : "text-muted-foreground hover:text-foreground hover:bg-background/50"
            )}
            title={`${f.path} (${(f.size / 1024).toFixed(1)} KB)`}
          >
            {f.path.split("/").pop()}
          </button>
        ))}
      </div>
      {/* File content */}
      <div className="ide-scroll flex-1 min-h-0 overflow-auto">
        <pre className="p-3 text-[11px] leading-relaxed font-mono text-foreground whitespace-pre-wrap break-all">
          <code>{selectedContent || "// Empty file"}</code>
        </pre>
      </div>
      {/* Status bar */}
      <div className="shrink-0 flex items-center justify-between border-t border-border bg-muted/20 px-3 py-1">
        <span className="text-[9px] text-muted-foreground font-mono">{selectedFile}</span>
        <span className="text-[9px] text-muted-foreground">
          {files.length} files · {(selectedContent.length / 1024).toFixed(1)} KB
        </span>
      </div>
    </div>
  );
}
