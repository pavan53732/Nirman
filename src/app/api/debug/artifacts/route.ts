// Debug Endpoint — Artifact Store Query API (Wave 3A).
//
// Proves the ArtifactRegistry is now queryable end-to-end. Three modes:
//
//   1. Lineage graph: GET /api/debug/artifacts?lineage=<id>
//        → returns { lineage: ArtifactLineage | undefined }
//        Uses `lineageGraph(id)` (NOT the existing flat-list `lineage(id)`,
//        which is preserved for rollback/recovery).
//
//   2. Filtered query: GET /api/debug/artifacts?type=source-code&target=web
//                      &producedBy=frontend-generator&pathContains=prisma
//                      &since=1700000000000
//        → returns { filter, count, artifacts: ArtifactRecord[] }
//        At least one filter param must be set (otherwise mode 3 runs).
//
//   3. Summary: GET /api/debug/artifacts
//        → returns { summary: ArtifactQuerySummary }
//        Aggregated counts by type / target / producer + 10 most recent
//        artifacts. Useful as an at-a-glance view when nothing is filtering.
//
// This endpoint is read-only — it never mutates the registry. Safe to hit
// at any time; an empty registry returns totalArtifacts: 0.

import { NextResponse } from "next/server";
import { artifactRegistry } from "@/lib/engine/artifact-registry";
import type { ArtifactQuery } from "@/lib/engine/artifact-registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseFilter(url: URL): ArtifactQuery {
  const sinceRaw = url.searchParams.get("since");
  const since =
    sinceRaw !== null && sinceRaw !== ""
      ? Number.parseInt(sinceRaw, 10)
      : undefined;
  return {
    type: (url.searchParams.get("type") ?? undefined) as ArtifactQuery["type"],
    target: url.searchParams.get("target") ?? undefined,
    producedBy:
      (url.searchParams.get("producedBy") ?? undefined) as ArtifactQuery["producedBy"],
    since: Number.isFinite(since) ? since : undefined,
    pathContains: url.searchParams.get("pathContains") ?? undefined,
  };
}

export async function GET(req: Request) {
  const url = new URL(req.url);

  // Mode 1 — lineage graph for a specific artifact id.
  const lineageId = url.searchParams.get("lineage");
  if (lineageId) {
    const lineage = artifactRegistry.lineageGraph(lineageId);
    if (!lineage) {
      return NextResponse.json(
        { error: `Artifact not found: ${lineageId}`, lineage: null },
        { status: 404 }
      );
    }
    return NextResponse.json({ lineage });
  }

  // Mode 2 — filtered query.
  const filter = parseFilter(url);
  const hasFilter = Object.values(filter).some(
    (v) => v !== undefined && v !== ""
  );
  if (hasFilter) {
    const results = artifactRegistry.query(filter);
    return NextResponse.json({
      filter,
      count: results.length,
      artifacts: results,
    });
  }

  // Mode 3 — summary (no filter supplied).
  return NextResponse.json({ summary: artifactRegistry.getQuerySummary() });
}
