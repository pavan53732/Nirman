"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Box, RefreshCw } from "lucide-react";
import type { PreviewTarget } from "@/lib/types";
import type {
  PreviewAction,
  PreviewScreen,
} from "@/lib/preview/preview-state";

interface NativePreviewProps {
  target: Extract<PreviewTarget, "windows" | "android">;
  projectId: string;
  /** When the workspace version changes (rebuild), refetch the preview. */
  refreshKey?: string | number;
}

interface PreviewStateInfo {
  currentScreen: PreviewScreen;
  entities: { id: string; name: string }[];
  lastAction: string | null;
}

interface InteractiveResponse {
  html: string;
  css: string;
  state: PreviewStateInfo;
  availableActions: { action: string; label: string; elementId: string }[];
  target: string;
  projectId: string;
}

/**
 * NativePreview — fetches an INTERACTIVE HTML approximation of the generated
 * native UI from /api/preview/interact and wires up click + input handlers
 * via event delegation so the user can navigate between screens, edit form
 * fields, add/edit/delete entities, and see state changes in real time.
 *
 * The preview simulates a stateful native app:
 *   - list screen  → click a row → detail screen → back
 *   - list screen  → "+ Add Contact" → form screen → save → back to list
 *   - form inputs  → type → server stores formValues → save persists
 *   - delete button → entity removed → list updates
 *
 * All actions go through POST /api/preview/interact, which reduces the action
 * against a server-side state store and returns the new rendered HTML. Input
 * events update server state WITHOUT replacing the HTML (preserves focus);
 * click events replace the HTML to reflect the new screen.
 */
export function NativePreview({ target, projectId, refreshKey }: NativePreviewProps) {
  const [data, setData] = useState<InteractiveResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Serialize all action POSTs so they're applied in order (prevents the
  // race where a fast "type then save" interleaves with stale responses).
  const actionQueueRef = useRef<Promise<void>>(Promise.resolve());

  const loadPreview = useCallback(async (reset: boolean) => {
    setLoading(true);
    setError(null);
    try {
      const url =
        `/api/preview/interact?target=${encodeURIComponent(target)}` +
        `&projectId=${encodeURIComponent(projectId)}` +
        (reset ? `&reset=1` : "");
      const res = await fetch(url);
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const d = (await res.json()) as InteractiveResponse;
      setData(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [target, projectId]);

  // Initial load + reset when refreshKey (workspace version) changes.
  useEffect(() => {
    loadPreview(true);
  }, [loadPreview, refreshKey]);

  /**
   * Dispatch an action to the server and merge the response. For input
   * events, we DON'T replace the HTML body (preserves user focus + cursor
   * position); we just update the state info for the header strip. For
   * click events, we replace the HTML to reflect the new screen.
   */
  const dispatchAction = useCallback(
    (action: PreviewAction, isInput: boolean) => {
      // Chain onto the previous action so they're processed in order.
      actionQueueRef.current = actionQueueRef.current
        .then(async () => {
          try {
            const res = await fetch(`/api/preview/interact`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ target, projectId, action }),
            });
            if (!res.ok) {
              const body = await res
                .json()
                .catch(() => ({ error: res.statusText }));
              throw new Error(body.error || `HTTP ${res.status}`);
            }
            const d = (await res.json()) as InteractiveResponse;
            setData((prev) => {
              if (isInput && prev) {
                // Preserve HTML/CSS (keep focus) — only refresh state info.
                return { ...prev, state: d.state, availableActions: d.availableActions };
              }
              return d;
            });
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
          }
        })
        .catch(() => {
          // Swallow errors so the queue keeps draining.
        });
    },
    [target, projectId],
  );

  // Attach click + input handlers via event delegation on the preview surface.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const onClick = (e: MouseEvent) => {
      const targetEl = (e.target as HTMLElement).closest<HTMLElement>(
        "[data-action]",
      );
      if (!targetEl) return;
      e.preventDefault();
      const action = targetEl.getAttribute("data-action");
      if (!action) return;

      // Build the action payload from the element's data-* attributes.
      switch (action) {
        case "select":
        case "delete": {
          const entityId = targetEl.getAttribute("data-entity-id") ?? "";
          dispatchAction(
            { type: action as "select" | "delete", entityId },
            false,
          );
          break;
        }
        case "navigate": {
          const screen = targetEl.getAttribute("data-screen") as PreviewScreen;
          if (screen) dispatchAction({ type: "navigate", screen }, false);
          break;
        }
        case "add":
        case "save":
        case "back":
          dispatchAction({ type: action as "add" | "save" | "back" }, false);
          break;
        default:
          // Unknown action — ignore.
          break;
      }
    };

    const onInput = (e: Event) => {
      const targetEl = e.target as HTMLElement;
      if (!targetEl.hasAttribute("data-input")) return;
      const field = targetEl.getAttribute("data-input") ?? "";
      const value = (targetEl as HTMLInputElement).value ?? "";
      dispatchAction({ type: "input", field, value }, true);
    };

    container.addEventListener("click", onClick);
    container.addEventListener("input", onInput);
    return () => {
      container.removeEventListener("click", onClick);
      container.removeEventListener("input", onInput);
    };
  }, [data, dispatchAction]);

  const isWindows = target === "windows";

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted ring-1 ring-border">
            <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
          <p className="text-xs text-muted-foreground">
            Loading interactive {isWindows ? "Windows" : "Android"} preview…
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
              The interactive preview simulates a native app — try rebuilding
              the project if the error persists.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
        No preview available
      </div>
    );
  }

  const screen = data.state.currentScreen;
  const itemCount = data.state.entities.length;
  const lastAction = data.state.lastAction ?? "init";

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Header strip — shows current screen + live state info */}
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border bg-muted/30 px-3 py-1.5">
        <div className="flex min-w-0 items-center gap-2">
          <Box className="h-3.5 w-3.5 shrink-0 text-primary" />
          <span className="text-[11px] font-medium">
            {isWindows ? "🪟 Windows Preview" : "🤖 Android Preview"}
          </span>
          <span className="text-[10px] text-muted-foreground">·</span>
          <span className="text-[10px] text-muted-foreground">
            {screen} screen
          </span>
          <span className="text-[10px] text-muted-foreground">·</span>
          <span className="text-[10px] text-muted-foreground">
            {itemCount} item{itemCount === 1 ? "" : "s"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="hidden sm:inline text-[10px] font-mono text-muted-foreground truncate max-w-[200px]">
            last: {lastAction}
          </span>
        </div>
      </div>

      {/* Preview surface — interactive HTML with event delegation */}
      <div
        className={
          "relative flex-1 min-h-0 overflow-auto p-4 " +
          (isWindows ? "bg-zinc-200/60" : "bg-gradient-to-br from-purple-50 to-pink-50")
        }
        ref={containerRef}
      >
        <style dangerouslySetInnerHTML={{ __html: data.css }} />
        <div dangerouslySetInnerHTML={{ __html: data.html }} />
      </div>
    </div>
  );
}
