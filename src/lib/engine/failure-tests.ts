// Failure-path testing harness — 5 scenarios that intentionally break engine
// dependencies (missing SKILL.md, invalid architecture memory, failed
// generator, empty prompt, ambiguity gate) and verify Pavan degrades
// gracefully instead of crashing.
//
// Each scenario:
//   1. Sets up the broken state.
//   2. Attempts the operation via the REAL engine functions.
//   3. Records: scenario, expectedBehavior, actualBehavior, handledGracefully,
//      errorMessage, recovered, plus a details blob for the API consumer.
//
// Each scenario is wrapped in its own try/catch so one failure cannot block
// the others — the test harness itself must degrade gracefully if a scenario
// throws. This file is importable by /api/debug/failure-test/route.ts and
// any future CI/runner.

// Import through the engine index — this triggers orchestrator.bootstrap()
// AFTER orchestrator.ts has fully evaluated, avoiding the TDZ circular-dep
// crash described in /api/debug/memory-impact/route.ts.
import {
  decisionEngine,
  detectAmbiguity,
  askQuestionIfNeeded,
  AMBIGUITY_THRESHOLD,
  detectTargets,
  generateForTarget,
  readDatabaseFromMemory,
  projectMemory,
} from "@/lib/engine";
import { getSkills } from "@/lib/engine/skills/loader";

export interface ScenarioResult {
  scenario: string;
  expectedBehavior: string;
  actualBehavior: string;
  handledGracefully: boolean;
  errorMessage: string;
  recovered: boolean;
  details?: Record<string, unknown>;
}

/**
 * Scenario 1 — Missing SKILL.md (empty endorsements).
 *
 * The Skills Loader reads real SKILL.md files from /skills/<name>/SKILL.md and
 * maps them to endorsed policy IDs (see SKILL_ENDORSEMENT_MAP in
 * decision-engine.ts). If a SKILL.md is missing on disk, the corresponding
 * policy ID is simply absent from the `skillEndorsements` array — no boost
 * is applied, but the Decision Engine must still return a valid stack.
 *
 * We simulate the worst case (ALL SKILL.md files missing) by passing an
 * empty endorsements array to `decisionEngine.pickStack`. The engine must
 * fall back to no-boost scoring and still return a valid stack with a
 * non-empty `chosen` string and a numeric confidence.
 */
function runScenario1MissingSkill(): ScenarioResult {
  const scenario = "Missing SKILL.md (empty endorsements)";
  const expectedBehavior =
    "Decision Engine falls back to no-boost scoring; pickStack returns a valid stack without crashing.";
  try {
    // Sanity: confirm real SKILL.md files exist on disk so the test is
    // meaningful (otherwise we'd be testing an already-empty system).
    const realSkills = getSkills();

    // Simulate every SKILL.md file missing by passing `[]` as the
    // skillEndorsements argument (5th positional arg of pickStack).
    // This is exactly the failure mode the loader produces when a file
    // is absent — the policy ID is simply not in the array.
    const { stack, decision } = decisionEngine.pickStack(
      "web",
      "CRM app",
      [], // capabilities
      [], // nonFunctionals
      []  // skillEndorsements — empty = "no SKILL.md endorsed anything"
    );

    const validStack = typeof stack === "string" && stack.trim().length > 0;
    const validConfidence =
      typeof decision.confidence === "number" &&
      Number.isFinite(decision.confidence) &&
      decision.confidence > 0;
    const handledGracefully = validStack && validConfidence;

    return {
      scenario,
      expectedBehavior,
      actualBehavior: handledGracefully
        ? `pickStack returned stack="${stack}" (confidence ${decision.confidence}) with ${realSkills.length} real SKILL.md files on disk; empty endorsements simulated missing skills.`
        : `pickStack returned an invalid result — stack="${stack}", confidence=${decision.confidence}.`,
      handledGracefully,
      errorMessage: "",
      recovered: handledGracefully,
      details: {
        realSkillsLoaded: realSkills.length,
        chosenStack: stack,
        decisionId: decision.id,
        confidence: decision.confidence,
        rationale: decision.rationale,
      },
    };
  } catch (err) {
    return {
      scenario,
      expectedBehavior,
      actualBehavior: `pickStack threw an error: ${String(err)}`,
      handledGracefully: false,
      errorMessage: String(err),
      recovered: false,
    };
  }
}

/**
 * Scenario 2 — Invalid Architecture Memory (garbage in Database record).
 *
 * Architecture Memory is the source of truth for the project's database
 * choice. An LLM agent (or a careless user) could write garbage there.
 * `readDatabaseFromMemory()` must NOT crash, NOT return garbage, and NOT
 * silently return the wrong database — it must fall back to the default
 * "sqlite" so downstream generators keep producing offline-first output.
 *
 * We write "GARBAGE_NOT_A_DB" to architecture/Database, read it back, and
 * assert we got "sqlite". After the test, we restore a known-good value so
 * subsequent builds on the same server instance aren't polluted.
 */
function runScenario2InvalidMemory(): ScenarioResult {
  const scenario = "Invalid Architecture Memory (garbage in Database record)";
  const expectedBehavior =
    "readDatabaseFromMemory() returns the default 'sqlite' instead of garbage or crashing.";
  const beforeRecords = projectMemory.read("architecture");
  try {
    // Write the garbage.
    projectMemory.write("architecture", "Database", "GARBAGE_NOT_A_DB", "failure-test");
    // Read back — must fall through both the postgres + sqlite regex checks
    // and hit the `return "sqlite"` default at the bottom of the function.
    const db = readDatabaseFromMemory();
    const isDefault = db === "sqlite";
    return {
      scenario,
      expectedBehavior,
      actualBehavior:
        `After writing "GARBAGE_NOT_A_DB" to architecture/Database, readDatabaseFromMemory() returned "${db}".`,
      handledGracefully: isDefault,
      errorMessage: "",
      recovered: isDefault,
      details: {
        garbageWritten: "GARBAGE_NOT_A_DB",
        databaseRead: db,
        recordsBeforeTest: beforeRecords.length,
      },
    };
  } catch (err) {
    return {
      scenario,
      expectedBehavior,
      actualBehavior: `Test threw an error: ${String(err)}`,
      handledGracefully: false,
      errorMessage: String(err),
      recovered: false,
    };
  } finally {
    // Always restore a known-good value so the singleton ProjectMemoryManager
    // is not polluted for subsequent builds on the same server instance.
    try {
      projectMemory.write("architecture", "Database", "sqlite", "failure-test-cleanup");
    } catch {
      // best-effort cleanup; ignore
    }
  }
}

/**
 * Scenario 3 — Failed Generator (unknown target kind).
 *
 * `generateForTarget` dispatches on `platform` (windows/android/web/cli) and
 * has a fallback path that emits a minimal README. If a caller passes an
 * unknown platform string (e.g. a typo or a future platform not yet wired
 * up), the generator must NOT crash the process — it must return the README
 * fallback or throw an error that the caller can catch.
 *
 * We pass `"unknown" as any` and assert we get back a GenerationResult with
 * a `files` array (even if it's just one README). No uncaught exception.
 */
function runScenario3FailedGenerator(): ScenarioResult {
  const scenario = "Failed Generator (unknown platform kind)";
  const expectedBehavior =
    "generateForTarget returns the README fallback (or empty result) for an unknown platform; does NOT crash the process.";
  try {
    // "unknown" is not in PlatformKind — cast to any to simulate a broken
    // caller. The dispatcher must fall through to the README fallback.
    const result = generateForTarget(
      "unknown" as never,
      "some-stack",
      "App",
      "t1",
      { prompt: "test", capabilities: [], nonFunctionals: [] }
    );
    const hasResult =
      !!result &&
      typeof result === "object" &&
      Array.isArray(result.files) &&
      typeof result.stack === "string";
    const handledGracefully = hasResult;
    return {
      scenario,
      expectedBehavior,
      actualBehavior: hasResult
        ? `generateForTarget('unknown', ...) returned ${result.files.length} file(s) with stack "${result.stack}" via the fallback path.`
        : `generateForTarget('unknown', ...) returned an unexpected shape: ${JSON.stringify(result).slice(0, 200)}`,
      handledGracefully,
      errorMessage: "",
      recovered: handledGracefully,
      details: hasResult
        ? {
            platform: result.platform,
            stack: result.stack,
            fileCount: result.files.length,
            files: result.files.map((f) => f.path),
          }
        : {},
    };
  } catch (err) {
    return {
      scenario,
      expectedBehavior,
      actualBehavior: `generateForTarget threw an error: ${String(err)}`,
      handledGracefully: false,
      errorMessage: String(err),
      recovered: false,
    };
  }
}

/**
 * Scenario 4 — Empty Prompt.
 *
 * A user (or a buggy client) could submit an empty prompt. `detectTargets`
 * must NOT crash on `""` — it must fall through to the default-web-target
 * branch (the `if (out.length === 0) { ... }` block at the bottom of
 * detectTargets) and return at least one valid target.
 */
function runScenario4EmptyPrompt(): ScenarioResult {
  const scenario = "Empty Prompt";
  const expectedBehavior =
    "detectTargets('') falls through to the default web target; does NOT crash.";
  try {
    const targets = detectTargets("");
    const hasTarget = Array.isArray(targets) && targets.length >= 1;
    const firstKind = hasTarget ? targets[0].kind : null;
    const firstStack = hasTarget ? targets[0].stack : null;
    const validStack = typeof firstStack === "string" && firstStack.length > 0;
    const handledGracefully = hasTarget && validStack;
    return {
      scenario,
      expectedBehavior,
      actualBehavior: handledGracefully
        ? `detectTargets('') returned ${targets.length} target(s); first kind = "${firstKind}", stack = "${firstStack}".`
        : `detectTargets('') returned an invalid result: ${JSON.stringify(targets).slice(0, 200)}`,
      handledGracefully,
      errorMessage: "",
      recovered: handledGracefully,
      details: {
        targetCount: targets.length,
        targets: targets.map((t) => ({
          kind: t.kind,
          label: t.label,
          stack: t.stack,
        })),
      },
    };
  } catch (err) {
    return {
      scenario,
      expectedBehavior,
      actualBehavior: `detectTargets threw an error: ${String(err)}`,
      handledGracefully: false,
      errorMessage: String(err),
      recovered: false,
    };
  }
}

/**
 * Scenario 5 — Ambiguity Gate Trigger (maximally vague prompt).
 *
 * "build an app" is maximally vague: no entity descriptor, no features, only
 * 3 words. The Ambiguity Detector must:
 *   - score > AMBIGUITY_THRESHOLD (0.75)
 *   - set shouldAsk = true
 *   - return a non-empty question string from askQuestionIfNeeded
 *
 * Critically, the engine must NOT invent business requirements and proceed
 * autonomously — it must PAUSE and ask the user for clarification. This is
 * the autonomy gate in action.
 */
function runScenario5AmbiguityGate(): ScenarioResult {
  const scenario = "Ambiguity Gate Trigger (maximally vague prompt)";
  const expectedBehavior =
    `detectAmbiguity('build an app') scores > ${AMBIGUITY_THRESHOLD}; askQuestionIfNeeded returns a non-empty question instead of inventing requirements.`;
  try {
    const ambiguity = detectAmbiguity("build an app");
    const question = askQuestionIfNeeded("build an app");
    const overThreshold = ambiguity.score > AMBIGUITY_THRESHOLD;
    const shouldAsk = ambiguity.shouldAsk === true;
    const hasQuestion = typeof question === "string" && question.trim().length > 0;
    const handledGracefully = overThreshold && shouldAsk && hasQuestion;
    return {
      scenario,
      expectedBehavior,
      actualBehavior: handledGracefully
        ? `Score ${ambiguity.score.toFixed(2)} > ${AMBIGUITY_THRESHOLD}; shouldAsk=true; question returned (${question!.length} chars). Engine paused and asked the user instead of inventing requirements.`
        : `Score ${ambiguity.score.toFixed(2)} (threshold ${AMBIGUITY_THRESHOLD}); shouldAsk=${ambiguity.shouldAsk}; question ${hasQuestion ? "returned" : "NOT returned"}.`,
      handledGracefully,
      errorMessage: "",
      recovered: handledGracefully,
      details: {
        score: ambiguity.score,
        threshold: AMBIGUITY_THRESHOLD,
        overThreshold,
        shouldAsk: ambiguity.shouldAsk,
        questionReturned: hasQuestion,
        questionPreview: hasQuestion ? question!.slice(0, 160) : null,
        matchedChecks: ambiguity.checks
          .filter((c) => c.matched)
          .map((c) => ({ id: c.id, weight: c.weight, detail: c.detail })),
      },
    };
  } catch (err) {
    return {
      scenario,
      expectedBehavior,
      actualBehavior: `Ambiguity gate threw an error: ${String(err)}`,
      handledGracefully: false,
      errorMessage: String(err),
      recovered: false,
    };
  }
}

/**
 * Run all 5 failure-path scenarios. Each is wrapped in its own try/catch so
 * one failure cannot block the others. Returns the results in deterministic
 * order (1..5).
 */
export function runFailureTests(): ScenarioResult[] {
  return [
    runScenario1MissingSkill(),
    runScenario2InvalidMemory(),
    runScenario3FailedGenerator(),
    runScenario4EmptyPrompt(),
    runScenario5AmbiguityGate(),
  ];
}
