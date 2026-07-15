import { NextResponse } from "next/server";
import { projectEvolution } from "@/lib/engine/project-evolution";
import { projectMemory } from "@/lib/engine/memories";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Debug endpoint for the ProjectEvolution system (Task Y — Continuous
 * Evolution).
 *
 * GET /api/debug/evolution
 *
 * Demonstrates the full continuous-evolution cycle:
 *
 *   1. SNAPSHOT  the initial project state (CRM v1)
 *   2. SIMULATE  evolution — user comes back months later and adds payments
 *   3. SNAPSHOT  the evolved state (CRM v2 with Payments)
 *   4. DIFF      the two snapshots → what changed?
 *   5. RESTORE   the original snapshot (simulating reopening the old version)
 *   6. UNDERSTAND the architecture of the restored project
 *
 * Returns:
 *   - snapshot1, snapshot2          : metadata for both snapshots
 *   - evolutionDiff                 : what changed between v1 → v2
 *   - restoredFromV1                : what the restored project looks like
 *   - availableSnapshots            : all snapshots in the session cache
 *
 * NOTE: This endpoint MUTATES the shared `projectMemory` singleton. It clears
 * memory at the start, writes demo records, takes a snapshot, mutates again,
 * takes another snapshot, then restores the v1 state. The end state of
 * `projectMemory` after this endpoint runs is the v1 state. Don't rely on
 * memory being unchanged across calls — this is a debug/demo endpoint.
 */
export async function GET() {
  // Clear existing memory for a clean demo (otherwise prior session state
  // would leak into the snapshot and pollute the diff).
  projectMemory.clear();

  // -------------------------------------------------------------------------
  // 1. Write the initial project state — simulating what the orchestrator
  //    writes during a build of a multi-target CRM.
  // -------------------------------------------------------------------------
  projectMemory.write(
    "requirements",
    "Original Prompt",
    "CRM app with contacts and deals",
    "user"
  );
  projectMemory.write(
    "requirements",
    "Detected Targets",
    "Desktop App: WinUI 3, Web Portal: Next.js, Android: Kotlin Compose",
    "decision-engine"
  );
  projectMemory.write(
    "decision",
    "Stack Selection",
    JSON.stringify({
      chosen: "WinUI 3 + Next.js + Kotlin Compose",
      rationale:
        "Multi-target CRM requires native performance on Windows, web accessibility, and mobile companion",
      confidence: 0.9,
    }),
    "decision-engine"
  );
  projectMemory.write(
    "architecture",
    "System Architecture",
    "3-target CRM with Contact and Deal entities, SQLite database, REST API",
    "solution-architect"
  );
  projectMemory.write(
    "architecture",
    "Database",
    "SQLite",
    "decision-engine"
  );
  projectMemory.write(
    "code",
    "web source",
    "schema.prisma, app/dashboard/page.tsx, app/api/contacts/route.ts",
    "frontend-generator"
  );

  // -------------------------------------------------------------------------
  // 2. SNAPSHOT the initial state.
  // -------------------------------------------------------------------------
  const snapshot1 = projectEvolution.snapshot(
    "proj-demo-v1",
    "CRM v1",
    "CRM app with contacts and deals",
    ["auth", "offline-sync"]
  );

  // -------------------------------------------------------------------------
  // 3. Simulate evolution — user comes back months later and adds payments.
  //    We add new requirements, architecture, and a decision record.
  // -------------------------------------------------------------------------
  projectMemory.write(
    "requirements",
    "New Feature",
    "Add payment processing for deals",
    "user"
  );
  projectMemory.write(
    "architecture",
    "Payments",
    "Stripe integration for deal payments",
    "solution-architect"
  );
  projectMemory.write(
    "decision",
    "Payment Provider",
    JSON.stringify({
      chosen: "Stripe",
      rationale: "Industry standard, well-documented API",
      confidence: 0.95,
    }),
    "decision-engine"
  );

  // -------------------------------------------------------------------------
  // 4. SNAPSHOT the evolved state.
  // -------------------------------------------------------------------------
  const snapshot2 = projectEvolution.snapshot(
    "proj-demo-v2",
    "CRM v2 with Payments",
    "CRM app with contacts, deals, and payments",
    ["auth", "offline-sync", "payments"]
  );

  // -------------------------------------------------------------------------
  // 5. DIFF the two snapshots → what changed between v1 and v2?
  // -------------------------------------------------------------------------
  const diff = projectEvolution.diff(snapshot1, snapshot2);

  // -------------------------------------------------------------------------
  // 6. RESTORE the original snapshot — simulating reopening v1 in a fresh
  //    environment months later. projectMemory is cleared and re-populated
  //    from snapshot1.memory, so the next agent run sees the v1 context.
  // -------------------------------------------------------------------------
  projectMemory.clear();
  const restoreResult = projectEvolution.restore(snapshot1);

  // -------------------------------------------------------------------------
  // 7. UNDERSTAND the architecture of the restored project.
  // -------------------------------------------------------------------------
  const understanding = restoreResult.understanding;

  return NextResponse.json({
    snapshot1: {
      projectId: snapshot1.projectId,
      projectName: snapshot1.projectName,
      createdAt: new Date(snapshot1.createdAt).toISOString(),
      memoryRecords: snapshot1.memory.length,
      decisions: snapshot1.decisions.length,
      capabilities: snapshot1.capabilities,
      architectureSummary: snapshot1.architectureSummary,
    },
    snapshot2: {
      projectId: snapshot2.projectId,
      projectName: snapshot2.projectName,
      createdAt: new Date(snapshot2.createdAt).toISOString(),
      memoryRecords: snapshot2.memory.length,
      decisions: snapshot2.decisions.length,
      capabilities: snapshot2.capabilities,
      architectureSummary: snapshot2.architectureSummary,
    },
    evolutionDiff: diff,
    restoredFromV1: {
      memoryRecordsRestored: restoreResult.memoryRecords,
      understanding,
    },
    availableSnapshots: projectEvolution.listSnapshots(),
  });
}
