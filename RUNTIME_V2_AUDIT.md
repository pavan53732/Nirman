# Nirman Runtime V2 — Architecture Audit & Migration Plan

## Part 1: Current State Audit

### What exists (38 engine modules + 4 preview modules + 15 debug endpoints)

| Subsystem | File | Status |
|---|---|---|
| Orchestrator | `orchestrator.ts` (653 lines) | **FAT** — 43 direct subsystem calls, contains business logic |
| Execution Engine | `execution-engine.ts` | Has scheduling, parallelism, checkpoints, rollback — **missing dynamic task insertion** |
| Workflow Engine | `workflow-engine.ts` | Exists but minimal — only `select()` + `compile()`, 1 workflow |
| Agent Runtime | `agent-runtime.ts` | Tracer + executor — **collaboration NOT wired in** |
| Agent Handlers | `agent-handlers.ts` | 10 handlers — **call generators directly** |
| Agent Collaboration | `agent-collaboration.ts` | 3 patterns exist — **not integrated into runtime** |
| Dynamic Agents | `dynamic-agents.ts` | Spawn/destroy lifecycle — **not triggered by runtime** |
| Agent Teams | ❌ | **DOES NOT EXIST** — only flat agent list |
| Planning Hierarchy | `planning-hierarchy.ts` | 4-level planner — **not wired to orchestrator** |
| Context Builder | `unified-context.ts` | Exists — **agents bypass it and query memory directly** |
| Memory | `memories.ts` | 7 layered memories, versioned — **direct access from 6 files** |
| Workspace Intelligence | `workspace-intelligence.ts` | 4 graphs — **good** |
| Workspace Reasoning | `workspace-reasoning.ts` | 5 capabilities — **good** |
| Skills | `skill-injector.ts` | Injects SKILL.md — **skills don't drive tool selection** |
| Tool Manager | `tool-manager.ts` | spawn + parse + timeout — **no sandbox abstraction** |
| Sandbox | ❌ | **DOES NOT EXIST** — tools run directly via child_process |
| Verification Loop | `self-healing.ts` | Gate evaluation — **no generate→verify→fix loop** |
| Artifact Store | `artifact-registry.ts` | Versioned artifacts — **NOT queryable** |
| Preview Engine | `preview/*.ts` | Renderers + interactive state — **reads from workspace, not artifacts** |
| Event Bus | `event-bus.ts` | Pub/sub exists — **only 6 event types, not driving runtime** |
| Model Router | `provider-abstraction.ts` | Exists (`ModelRouter` class) — **not used by agents** |
| Plugin System | `plugin-system.ts` | Registry works — **good** |
| Continuous Evolution | `project-evolution.ts` | Snapshot/restore/diff — **good** |
| Observability | `observability.ts` | Event recorder — **missing runtime metrics** |

---

## Part 2: Gap Analysis (19 target points)

### 🔴 CRITICAL GAPS (blocking the V2 vision)

**1. Linear Pipeline → Mutable DAG** 🔴
- **Current**: Orchestrator calls `generateForTarget()` directly in a loop (line 193), then creates tasks. The task graph is built ONCE and never mutated.
- **Target**: Task graph is a mutable DAG continuously updated during execution. Verification failures insert new fix tasks.
- **Gap**: No `TaskGraph` class. No `insertTask()` on ExecutionEngine. No verification-driven task creation.

**2. Orchestrator Too Fat** 🔴
- **Current**: 653 lines, 43 direct subsystem calls. Contains: capability detection, ambiguity detection, target detection, memory writes, generation calls, workspace materialization, gate task creation, token budgeting.
- **Target**: Only accept requests, select workflow, init task graph, start engine, stream progress, return results.
- **Gap**: All business logic must move OUT of orchestrator into workflow engine + agent handlers + context builder.

**3. Agent Teams Don't Exist** 🔴
- **Current**: 70 flat agents in `data/agents.ts`, no team structure.
- **Target**: 6 teams (Planning, Architecture, Engineering, Quality, Delivery, System), each owning specialists.
- **Gap**: No `AgentTeam` abstraction. No team coordination logic.

**4. No Sandbox Abstraction** 🔴
- **Current**: `ToolManager` calls `child_process.spawn()` directly.
- **Target**: Every build executes inside a Sandbox (Web/Windows/Android/CLI/API/Library/Plugin profiles).
- **Gap**: No `Sandbox` class. No sandbox profiles. No stdout/stderr/artifacts/metrics/logs return structure.

**5. No Verification Loop** 🔴
- **Current**: Linear completion. Gates evaluate but don't create fix tasks.
- **Target**: Generate → Build → Verify → Pass? → Artifact Store : → Create Fix Tasks → Task Graph → Execution Engine.
- **Gap**: No `VerificationLoop` class. No fix-task creation on failure.

### 🟡 MODERATE GAPS (need wiring, not new subsystems)

**6. Workflow Engine Minimal**
- **Current**: 1 workflow (`new-project`), `select()` + `compile()` only.
- **Target**: 7+ workflows (New Project, Continue, Bug Fix, Refactor, Upgrade, Package, Export).
- **Gap**: Need workflow definitions for each type.

**7. Execution Engine Missing Dynamic Insertion**
- **Current**: Has scheduling, parallelism, checkpoints, rollback. Missing `insertTask()` for runtime task insertion.
- **Target**: Dynamic task insertion (for verification-driven fix tasks).
- **Gap**: Add `insertTask(task)` method.

**8. Agent Runtime Doesn't Own Collaboration**
- **Current**: `agent-collaboration.ts` exists but is a standalone module. `AgentRuntime.executeTask()` doesn't use it.
- **Target**: Agent Runtime owns team coordination, peer review, critique/refine.
- **Gap**: Wire `collaborationEngine` into `AgentRuntime.executeTask()`.

**9. Context Builder Bypassed**
- **Current**: `unified-context.ts` exists but 6 files call `projectMemory.read/write` directly (orchestrator, decision-engine, agent-runtime, execution-engine, project-evolution).
- **Target**: Every agent receives context EXCLUSIVELY through Context Builder. Agents never query memory directly.
- **Gap**: Remove direct memory access from all non-memory modules.

**10. Skills Don't Drive Tool Selection**
- **Current**: `skill-injector.ts` injects SKILL.md content into agent context, but agents don't use skills to choose tools.
- **Target**: Agent reads Skills → reasons → chooses Tool → executes Tool.
- **Gap**: No skill→tool mapping logic in agent handlers.

**11. Artifact Store Not Queryable**
- **Current**: `artifact-registry.ts` has `produce()` + `get()` but no query API.
- **Target**: Artifacts queryable by type, target, hash, lineage.
- **Gap**: Add `query()`, `byType()`, `byTarget()`, `lineage()`.

**12. Preview Reads Workspace, Not Artifacts**
- **Current**: Preview endpoints read from `/api/workspace/list` (filesystem).
- **Target**: Preview Engine consumes artifacts from the Artifact Store.
- **Gap**: Wire preview to read from `artifactRegistry` instead of filesystem.

**13. Event Bus Not Driving Runtime**
- **Current**: 6 event types, only used for logging. Execution doesn't react to events.
- **Target**: Everything communicates through events. TaskCompleted → triggers verification. BuildFailed → triggers fix.
- **Gap**: Wire event bus subscribers to submit follow-up tasks.

### 🟢 MINOR GAPS (exist but need enhancement)

**14. Model Router Not Used by Agents**
- **Current**: `ModelRouter` class exists in `provider-abstraction.ts`.
- **Target**: No subsystem chooses models directly — all go through Model Router.
- **Gap**: Agents call `modelRouter.chooseModel()` instead of hardcoding.

**15. Observability Missing Runtime Metrics**
- **Current**: Records events. Missing agent utilization, parallelism, latency, cache hit rate, graph query latency.
- **Target**: Full diagnostics dashboard.
- **Gap**: Add metric collection to observability.

**16. Memory Architecture**
- **Current**: 7 layered memories, versioned. Missing "Workspace Memory" and "Build Memory" as distinct layers (Build exists, Workspace does not).
- **Target**: 9 memory kinds (add Workspace + Build).
- **Gap**: Add "workspace" memory kind.

---

## Part 3: Required Refactors (Priority Order)

### Phase 1: Foundation (no behavior change)
1. **Create `TaskGraph` class** — mutable DAG wrapper around the current task list
2. **Add `insertTask()` to ExecutionEngine** — enables dynamic task insertion
3. **Create `Sandbox` abstraction** — wraps ToolManager with profiles
4. **Create `AgentTeam` abstraction** — groups agents by team
5. **Create `VerificationLoop`** — generate→build→verify→fix cycle

### Phase 2: Wiring (behavior preserved, internals refactored)
6. **Move business logic out of Orchestrator** — into Workflow Engine + Agent Handlers
7. **Wire Agent Collaboration into AgentRuntime** — executeTask uses critique-refine
8. **Enforce Context Builder exclusivity** — remove direct memory access
9. **Wire Event Bus to drive runtime** — subscribers submit follow-up tasks
10. **Make Artifact Store queryable** — add query API

### Phase 3: Integration (new capabilities from existing pieces)
11. **Wire Preview to consume Artifacts** — not filesystem
12. **Add 6 more Workflow definitions** — Continue, Bug Fix, Refactor, etc.
13. **Wire Skills to drive Tool selection** — skill→tool mapping
14. **Wire Model Router into agents** — no direct model choice
15. **Add runtime metrics to Observability** — utilization, latency, cache

---

## Part 4: Migration Steps (Incremental, Backward Compatible)

### Migration Principle
Each step is a **single PR-sized change** that:
- Passes `tsc --noEmit` (0 errors)
- Passes `bun run lint` (clean)
- Passes `node scripts/regression-tests.mjs` (5/5)
- Preserves all existing API contracts
- Adds new capabilities without removing old ones (deprecation path)

### Step 1: TaskGraph + ExecutionEngine.insertTask()
- Create `task-graph.ts` with `TaskGraph` class (wraps `Task[]` with mutation methods)
- Add `insertTask(task)` to `ExecutionEngine` (inserts into running graph)
- Orchestrator uses `TaskGraph` internally (no external change)
- **Backward compat**: existing `submitAll()` still works

### Step 2: Sandbox Abstraction
- Create `sandbox.ts` with `Sandbox` class + profiles (web/windows/android/cli)
- `ToolManager` delegates to `Sandbox` internally
- **Backward compat**: `ToolManager.execute()` signature unchanged

### Step 3: Agent Teams
- Create `agent-teams.ts` with `AgentTeam` class + 6 teams
- Teams map to existing agents (no agent removal)
- **Backward compat**: `data/agents.ts` unchanged, teams are a grouping layer

### Step 4: Verification Loop
- Create `verification-loop.ts` with `VerificationLoop` class
- On task failure, creates fix tasks and inserts them via `ExecutionEngine.insertTask()`
- **Backward compat**: existing gate evaluation still works, verification is additive

### Step 5: Orchestrator Slimming
- Move capability detection → `workflow-engine.ts` (workflow produces initial tasks)
- Move target detection → `workflow-engine.ts`
- Move memory writes → `agent-handlers.ts` (agents write their own memory via context)
- Move generation calls → `agent-handlers.ts` (already done, remove the duplicate in orchestrator)
- Orchestrator becomes ~100 lines: accept → select workflow → init graph → start engine → stream → return
- **Backward compat**: `startBuild()` signature unchanged, behavior identical

### Step 6: Context Builder Exclusivity
- Remove `projectMemory` imports from: `orchestrator.ts`, `decision-engine.ts`, `agent-runtime.ts`, `execution-engine.ts`
- All memory access goes through `contextBuilder` or `unifiedContextBuilder`
- **Backward compat**: `projectMemory` still exported for external consumers, just not used internally

### Step 7: Event-Driven Runtime
- Add event subscribers that submit follow-up tasks:
  - `task-succeeded` (generate) → submit build task
  - `task-succeeded` (build) → submit verify task
  - `task-failed` (verify) → submit fix task
- **Backward compat**: existing event bus unchanged, new subscribers are additive

### Step 8: Artifact Store Queryable
- Add `query(filter)`, `byType(type)`, `byTarget(target)`, `lineage(id)` to `ArtifactRegistry`
- **Backward compat**: existing `produce()` + `get()` unchanged

### Step 9: Preview Consumes Artifacts
- Preview endpoints read from `artifactRegistry` instead of filesystem
- **Backward compat**: filesystem fallback if artifact not in registry

### Step 10: Workflow Definitions
- Add 6 workflows: Continue, Bug Fix, Refactor, Upgrade, Package, Export
- Each produces a different task graph
- **Backward compat**: `new-project` workflow unchanged

### Step 11: Skills Drive Tool Selection
- Add `skillToTool` mapping in `skill-injector.ts`
- Agent handlers read skill recommendations before choosing tools
- **Backward compat**: existing tool selection still works as fallback

### Step 12: Model Router Integration
- Agent handlers call `modelRouter.chooseModel(task)` instead of hardcoding
- **Backward compat**: default model used if router returns null

### Step 13: Runtime Observability
- Add metric collection: agent utilization, task latency, cache hit rate
- New `/api/debug/metrics` endpoint
- **Backward compat**: existing events unchanged

---

## Part 5: Implementation Order

Execute in 4 parallel waves (each wave is independently shippable):

**Wave 1 (Foundation):** Steps 1-4 (TaskGraph, Sandbox, Teams, VerificationLoop)
**Wave 2 (Slimming):** Steps 5-7 (Orchestrator slim, Context exclusivity, Event-driven)
**Wave 3 (Store):** Steps 8-9 (Artifact query, Preview from artifacts)
**Wave 4 (Polish):** Steps 10-13 (Workflows, Skills→Tools, Model Router, Metrics)

Each wave verified with: tsc 0, lint clean, regression 5/5, new endpoint demo.
