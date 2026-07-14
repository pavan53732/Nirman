# FixTSC — Agent Work Record

**Task ID:** FixTSC
**Agent:** Z.ai Code (FixTSC)
**Scope:** Fix all 45 TypeScript compilation errors in `src/` (excluding `skills/` and `examples/`).

## What was wrong

`bun run lint` (ESLint) passed but `npx tsc --noEmit` failed with 45 type errors in `src/`. The root causes were:

1. **Duplicate type definitions** — `src/lib/types.ts` and `src/lib/engine/types.ts` both defined `AgentRole`, `StageId`, etc. with *different* values. The engine had 70 agent roles; `lib/types.ts` had ~10. Code importing from one wasn't compatible with code importing from the other.
2. **`data/skills.ts` used obsolete agent roles** — `"architect"`, `"selector"`, `"coder"`, `"reviewer"`, `"builder"`, `"tester"`, `"docs"` — that don't exist in the engine's `AgentRole` union.
3. **`DetectedTargets.policies` was typed as `DecisionPolicy[]`** but the orchestrator pushed `DecisionRecord` instances into it. Consumers then read `.topic`/`.chosen`/`.confidence` which only exist on `DecisionRecord`.
4. **`stageStatus()` returned `TaskStatus | "pending"`** but its body returned `"done"` — a value not in that union.
5. **`Checkpoint.stageStatusSnapshot` was `Record<string, TaskStatus>`** but stored `"pending"` and `"done"` (StageStatus values, not TaskStatus).
6. **`PlatformAdapter` didn't satisfy the `Registry<T extends { id: string }>` constraint** because it uses `kind`, not `id`.
7. Various smaller issues: `m` possibly null in a closure, `"auth"` passed as `NonFunctional` (it's a `Capability`), `ProjectKind` passed where `PlatformKind` was expected, `Uint8Array<ArrayBufferLike>` not assignable to `BlobPart`, `Agent.skills` (removed field) still referenced, Lucide `title` prop not in `LucideProps`.

## What I changed

### Single source of truth for shared types
- `src/lib/engine/types.ts` — added `StageId`, `StageStatus`, `SkillCategory` exports; added `"debugger"` to `AgentRole`; broadened `Checkpoint.stageStatusSnapshot` to `Record<string, string>`.
- `src/lib/types.ts` — re-exports `AgentRole`, `StageId`, `StageStatus`, `SkillCategory`, `Skill`, `Agent`, `Capability`, `PlatformKind`, `TaskStatus`, `GateId`, `WorkflowId`, etc. from `./engine/types`. Removed the duplicate `AgentRole` and `Agent` (with `skills: number`) and `Skill` definitions. Kept UI-only types (`ProjectKind`, `ProjectMeta`, `ChatMessage`, `PipelineStage`, `Artifact`, `LogLine`, `AISettings`, `PreviewTarget`, `ModelProvider`).

### Engine fixes
- `src/lib/engine/data/skills.ts` — updated `stageAgentMap` to use new engine roles.
- `src/lib/engine/decision-engine.ts` — `DetectedTargets.policies` is now `DecisionRecord[]`.
- `src/lib/engine/orchestrator.ts` — imported `AgentRole` + `GateId`; updated `checkpoint()`/`resume()` signatures to `Record<string, string>`.
- `src/lib/engine/execution-engine.ts` — broadened `stageStatus()` return type to `TaskStatus | "pending" | "done"`; updated `CheckpointManager.save/resume/restoreFromIDB` to `Record<string, string>`.
- `src/lib/engine/registries.ts` — rewrote `Registry<T>` to take a `keyOf: (item: T) => string` callback. Each registry declares its key extractor at construction (`PlatformAdapter` uses `kind`, everyone else uses `id`).
- `src/lib/engine/tool-manager.ts` — extracted `m[1]`/`m[2]` into local consts before the `.some()` closure (TS doesn't narrow `let` regex match vars through closures).
- `src/lib/engine/generators/desktop-generator.ts` — added `name: string` to `csType`'s parameter type.
- `src/lib/engine/generators/web-generator.ts` — `needsAuth` now takes `Capability[]` and checks `capabilities.includes("auth")` (was wrongly checking `nonFunctionals`).

### App-layer fixes
- `src/lib/export.ts` — added `toPlatformKind()` helper to narrow `ProjectKind`→`PlatformKind` at the `generateForTarget` call site; cast the Blob constructor args as `BlobPart[]`.
- `src/lib/mock-data.ts` — replaced `a.skills = ...` with `a.consumes = skills.filter(s => s.agent === a.role).map(s => s.id)`.
- `src/components/pavan/capabilities-dialog.tsx` — `{a.skills}` → `{a.consumes?.length ?? 0}`.
- `src/components/pavan/ai-settings-dialog.tsx` — wrapped the `Loader2` icon in a `<span title="Testing…">` (Lucide icons don't accept `title`).
- `src/hooks/use-orchestration.ts` — no change needed; once `CheckpointManager.save()` accepts `Record<string, string>`, the existing snapshot type matches.
- `src/components/pavan/status-panel.tsx` — no change needed; `@/lib/types` now re-exports the engine `AgentRole`/`StageStatus`, so the cross-package mismatch is gone.

## Verification

```
$ npx tsc --noEmit 2>&1 | grep "error TS" | grep "src/" | grep -v "skills/" | grep -v "examples/" | wc -l
0

$ bun run lint
$ eslint .
(exit code 0)
```

Remaining tsc errors (4) are all in `examples/websocket` (missing `socket.io-client` types) and `skills/*` (skill scripts, not part of the app) — both explicitly excluded from this task.

Dev server log shows clean compilation; `curl http://localhost:3000/` returns HTTP 200.

## Out of scope (per task instructions)
Did NOT touch: `test-generator.ts`, `cicd-generator.ts`, `docker-generator.ts`, `tools/lint-runner.ts`, `preview-panel.tsx`, `src-tauri/`.
