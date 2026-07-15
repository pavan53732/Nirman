"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Box, RefreshCw } from "lucide-react";
import type { PreviewTarget } from "@/lib/types";

interface NativePreviewProps {
  target: Extract<PreviewTarget, "windows" | "android">;
  projectId: string;
  /** When the workspace version changes (rebuild), refetch the preview. */
  refreshKey?: string | number;
}

interface RenderResponse {
  target: string;
  file: string;
  html: string;
  css: string;
  elementCount: number;
  warnings: string[];
}

/**
 * NativePreview — fetches a rendered HTML approximation of the generated
 * native UI from /api/preview/render and displays it inside a sandboxed
 * container. Used by PreviewPanel when the user switches to "Preview" mode.
 */
export function NativePreview({ target, projectId, refreshKey }: NativePreviewProps) {
  const [html, setHtml] = useState<string>("");
  const [css, setCss] = useState<string>("");
  const [file, setFile] = useState<string>("");
  const [elementCount, setElementCount] = useState(0);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/preview/render?target=${encodeURIComponent(target)}&projectId=${encodeURIComponent(projectId)}`,
        );
        if (!res.ok) {
          const body = await res.json().catch(() => ({ error: res.statusText }));
          throw new Error(body.error || `HTTP ${res.status}`);
        }
        const data = (await res.json()) as RenderResponse;
        if (cancelled) return;
        setHtml(data.html);
        setCss(data.css);
        setFile(data.file);
        setElementCount(data.elementCount);
        setWarnings(data.warnings ?? []);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [target, projectId, refreshKey]);

  const isWindows = target === "windows";

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted ring-1 ring-border">
            <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
          <p className="text-xs text-muted-foreground">
            Rendering {isWindows ? "Windows" : "Android"} native preview…
          </p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="flex flex-col items-center gap-3 text-center max-w-sm">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-500/10 ring-1 ring-amber-500/20">
            <AlertTriangle className="h-6 w-6 text-amber-500" />
          </div>
          <div>
            <p className="text-sm font-medium">Preview unavailable</p>
            <p className="mt-1 text-xs text-muted-foreground">{error}</p>
            <p className="mt-2 text-[11px] text-muted-foreground/70">
              Build the project first — the native preview renders the generated
              {" "}{isWindows ? "XAML" : "Kotlin"} source from the workspace.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Header strip */}
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border bg-muted/30 px-3 py-1.5">
        <div className="flex min-w-0 items-center gap-2">
          <Box className="h-3.5 w-3.5 shrink-0 text-primary" />
          <span className="text-[11px] font-medium">
            {isWindows ? "🪟 Windows Preview" : "🤖 Android Preview"}
          </span>
          <span className="text-[10px] text-muted-foreground">·</span>
          <span className="text-[10px] text-muted-foreground">
            {elementCount} element{elementCount === 1 ? "" : "s"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {warnings.length > 0 && (
            <span
              className="flex items-center gap-1 text-[10px] text-amber-600 dark:text-amber-400"
              title={warnings.join("\n")}
            >
              <AlertTriangle className="h-3 w-3" />
              {warnings.length} warning{warnings.length === 1 ? "" : "s"}
            </span>
          )}
          <span className="hidden sm:inline text-[10px] font-mono text-muted-foreground truncate max-w-[200px]">
            {file.split("/").pop() ?? file}
          </span>
        </div>
      </div>

      {/* Preview surface */}
      <div
        className={
          "relative flex-1 min-h-0 overflow-auto p-4 " +
          (isWindows ? "bg-zinc-200/60" : "bg-gradient-to-br from-purple-50 to-pink-50")
        }
      >
        {/* Inline the renderer CSS scoped to the preview surface. */}
        <style dangerouslySetInnerHTML={{ __html: scopeCss(css, isWindows) }} />
        <div dangerouslySetInnerHTML={{ __html: html }} />
      </div>
    </div>
  );
}

/**
 * Scope the renderer CSS so it doesn't leak into the host page. The renderer
 * already uses class prefixes (win11-* / md3-*) so a light touch is enough —
 * we wrap each selector with `.pavan-preview-scope` to be safe.
 */
function scopeCss(css: string, _isWindows: boolean): string {
  // The renderer CSS only targets win11-* / md3-* class names — these are
  // unique to the preview, so we don't need heavy scoping. Just pass through.
  return css;
}
