import { NextResponse } from "next/server";
import {
  createInitialState,
  reducePreviewState,
  type PreviewState,
  type PreviewAction,
  type PreviewTarget,
} from "@/lib/preview/preview-state";
import { renderInteractive } from "@/lib/preview/interactive-renderer";
import { artifactRegistry } from "@/lib/engine/artifact-registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Module-level state store keyed by `${projectId}:${target}`. Each project +
// platform combo has its own independent preview state. State survives HMR
// reloads within the same server process; on cold start it's re-created with
// the default sample entities.
const stateStore = new Map<string, PreviewState>();

function stateKey(projectId: string, target: PreviewTarget): string {
  return `${projectId}:${target}`;
}

function getState(projectId: string, target: PreviewTarget): PreviewState {
  const key = stateKey(projectId, target);
  let state = stateStore.get(key);
  if (!state) {
    state = createInitialState(target);
    stateStore.set(key, state);
  }
  return state;
}

function resetState(projectId: string, target: PreviewTarget): PreviewState {
  const key = stateKey(projectId, target);
  const state = createInitialState(target);
  stateStore.set(key, state);
  return state;
}

function isPreviewTarget(value: string | null | undefined): value is PreviewTarget {
  return value === "windows" || value === "android";
}

/**
 * Determine whether the Artifact Registry has any UI artifacts for the given
 * target. Used to annotate the interactive preview response with a `source`
 * field mirroring the /api/preview/render endpoint.
 *
 * NOTE: this is a GLOBAL registry probe (not per-project). ArtifactRecord
 * carries `targetId` (a build target identifier like "t1-pg"), not a
 * projectId, so we can't filter to "artifacts produced for THIS project".
 * The flag therefore answers: "has ANY build produced a UI file for this
 * target on this server?" — useful as an at-a-glance V2-readiness indicator.
 *
 * The interactive preview state itself is still created via
 * `createInitialState(target)` (sample entities) — the registry is consulted
 * for observability only. A future wave can wire artifact content into the
 * state initializer once `preview-state.ts` accepts a content parameter
 * (out of scope here — preview-state.ts is in the "DO NOT touch" list).
 */
function artifactSourceForTarget(
  target: PreviewTarget,
): "artifact-registry" | "default" {
  try {
    const matches =
      target === "windows"
        ? artifactRegistry.query({ pathContains: ".xaml" })
        : artifactRegistry.query({ pathContains: "Screen.kt" });
    // For Windows, exclude .xaml.cs code-behind files (substring match catches
    // them but endsWith(".xaml") does not).
    const has = matches.some((a) =>
      target === "windows" ? a.path.endsWith(".xaml") : true,
    );
    return has ? "artifact-registry" : "default";
  } catch {
    return "default";
  }
}

/**
 * GET /api/preview/interact?target=windows|android&projectId=<id>[&reset=1]
 *
 * Returns the current interactive preview (HTML + CSS + state). If `reset=1`
 * is set, the state is re-initialized first — used when the workspace is
 * rebuilt (refreshKey changes) so the preview reflects a fresh app launch.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const targetRaw = url.searchParams.get("target");
  const projectId = url.searchParams.get("projectId") ?? "default";
  const reset = url.searchParams.get("reset") === "1";

  if (!isPreviewTarget(targetRaw)) {
    return NextResponse.json(
      { error: `target must be 'windows' or 'android', got '${targetRaw ?? "(missing)"}'` },
      { status: 400 },
    );
  }

  const state = reset ? resetState(projectId, targetRaw) : getState(projectId, targetRaw);
  const preview = renderInteractive(state);
  const source = artifactSourceForTarget(targetRaw);
  return NextResponse.json({ ...preview, projectId, target: targetRaw, source });
}

/**
 * POST /api/preview/interact
 *   body: { target, projectId?, action: PreviewAction }
 *
 * Applies the action to the current preview state and returns the new
 * rendered preview. The action shape matches PreviewAction in
 * preview-state.ts — e.g. { type: "add" }, { type: "input", field: "name",
 * value: "X" }, { type: "select", entityId: "1" }.
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      target?: string;
      projectId?: string;
      action?: PreviewAction;
    };
    const targetRaw = body.target;
    const projectId = body.projectId ?? "default";

    if (!isPreviewTarget(targetRaw)) {
      return NextResponse.json(
        { error: `target must be 'windows' or 'android', got '${targetRaw ?? "(missing)"}'` },
        { status: 400 },
      );
    }
    if (!body.action || typeof body.action !== "object" || !("type" in body.action)) {
      return NextResponse.json(
        { error: "action is required and must have a 'type' field" },
        { status: 400 },
      );
    }

    const state = getState(projectId, targetRaw);
    const newState = reducePreviewState(state, body.action);
    stateStore.set(stateKey(projectId, targetRaw), newState);

    const preview = renderInteractive(newState);
    const source = artifactSourceForTarget(targetRaw);
    return NextResponse.json({ ...preview, projectId, target: targetRaw, source });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
