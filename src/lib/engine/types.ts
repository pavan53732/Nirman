// Core engine types for Pavan's internal architecture.
// Registry layering: Skill -> Tool -> Agent -> PlatformAdapter -> PreviewProvider
//                    -> Provider Abstraction -> Workflow Engine -> Execution Engine -> Orchestrator

/* ---------------- Registy primitives ---------------- */

export interface RegistryEntry {
  id: string;
  name: string;
}

export type Capability =
  | "opengl"
  | "directx"
  | "gpu"
  | "bluetooth"
  | "camera"
  | "microphone"
  | "location"
  | "offline-sync"
  | "realtime"
  | "pdf"
  | "printing"
  | "barcode"
  | "notifications"
  | "payments"
  | "auth"
  | "encryption";

/* ---------------- Skill Registry (AI reasoning) ---------------- */

/** Identifier for a registered skill (the Skill.id). */
export type SkillId = string;

export interface Skill extends RegistryEntry {
  category: string;
  description: string;
  agent: AgentRole;
  /** Skills that produce concrete artifacts via tools. */
  usesTools?: string[];
  tags?: string[];
}

/* ---------------- Tool Registry (execution) ---------------- */

export interface Tool extends RegistryEntry {
  category: string;
  description: string;
  /** Sandbox profile: timeout ms + max output bytes. */
  timeoutMs: number;
  /** Structured result parser id. */
  parser?: "dotnet-build" | "gradle" | "cargo" | "npm" | "eslint" | "roslyn" | "generic";
}

/* ---------------- Agent Registry ---------------- */

export type AgentRole =
  // Layer 1 — Executive
  | "orchestrator"
  | "project-manager"
  | "planner"
  | "decision-engine"
  | "context-builder"
  // Layer 2 — Architecture
  | "requirements-analyst"
  | "business-analyst"
  | "domain-expert"
  | "solution-architect"
  | "software-architect"
  | "platform-architect"
  | "database-architect"
  | "api-architect"
  | "uiux-architect"
  | "security-architect"
  | "ai-architect"
  | "infrastructure-architect"
  // Layer 3 — Engineering generators
  | "frontend-generator"
  | "desktop-generator"
  | "android-generator"
  | "backend-generator"
  | "database-generator"
  | "ai-generator"
  // Layer 4 — Quality & Delivery
  | "code-reviewer"
  | "static-analyzer"
  | "security-auditor"
  | "dependency-auditor"
  | "performance-optimizer"
  | "memory-optimizer"
  | "accessibility-auditor"
  | "documentation-writer"
  | "test-generator"
  | "unit-test-agent"
  | "integration-test-agent"
  | "ui-test-agent"
  | "build-engineer"
  | "packaging-engineer"
  | "release-engineer"
  | "export-manager"
  | "migration-agent"
  | "refactoring-agent"
  // Layer 5 — Cross-cutting services
  | "project-memory-manager"
  | "knowledge-base-manager"
  | "artifact-manager"
  | "tool-manager"
  | "skill-manager"
  | "provider-manager"
  | "model-router"
  | "cost-optimizer"
  | "token-budget-manager"
  | "cache-manager"
  // Layer 6 — Dynamic sub-agents (spawned on demand)
  | "auth-specialist"
  | "payments-specialist"
  | "notifications-specialist"
  | "email-specialist"
  | "ocr-specialist"
  | "pdf-specialist"
  | "reporting-specialist"
  | "charts-specialist"
  | "filesystem-specialist"
  | "bluetooth-specialist"
  | "camera-specialist"
  | "printing-specialist"
  | "barcode-specialist"
  | "localization-specialist"
  | "theme-specialist"
  | "offline-sync-specialist"
  | "search-specialist"
  | "background-service-specialist"
  | "installer-specialist";

export type AgentLayer =
  | "executive"
  | "architecture"
  | "engineering"
  | "quality"
  | "cross-cutting"
  | "dynamic";

export interface Agent extends RegistryEntry {
  role: AgentRole;
  layer: AgentLayer;
  icon: string;
  color: string;
  description: string;
  /** Always-active flag (Layer 1). */
  alwaysActive?: boolean;
  /** For dynamic agents: the capability/signal that spawns this agent. */
  spawnedBy?: Capability | "on-demand";
  /**
   * Skills this agent consumes (derived at bootstrap from Skill.agent).
   * The inverse of Skill.agent: both directions exist so consumers can
   * traverse agent→skills and skill→agent.
   */
  consumes?: SkillId[];
}

/* ---------------- Platform Adapter Registry ---------------- */

export type PlatformKind =
  | "windows"
  | "web"
  | "android"
  | "cli"
  | "library"
  | "api"
  | "plugin"
  // future, interface-ready
  | "ios"
  | "macos"
  | "linux-desktop"
  | "embedded"
  | "game-engine"
  | "browser-extension";

export interface PlatformAdapter {
  kind: PlatformKind;
  name: string;
  generators: AgentRole[];
  packagingTools: string[]; // tool ids
  previewProvider: PreviewProviderId;
  capabilities: Capability[];
  requiredPermissions: string[];
  defaultStack: string;
  /** Whether this adapter is currently enabled (future adapters can be toggled). */
  enabled: boolean;
}

/* ---------------- Preview Provider Registry ---------------- */

export type PreviewProviderId = "web" | "windows" | "android";

export interface PreviewProvider {
  id: PreviewProviderId;
  name: string;
  supportsHotReload: boolean;
  supportsInspector: boolean;
}

/* ---------------- Provider Abstraction Layer ---------------- */

export type ProviderCapability =
  | "llm"
  | "embedding"
  | "speech-tts"
  | "speech-asr"
  | "image-generation"
  | "ocr"
  | "vector-db";

export interface ProviderModel {
  id: string;
  name: string;
  contextWindow: number;
  capabilities: ProviderCapability[];
  costPer1kTokens?: number; // for cost optimizer
}

export interface Provider {
  id: string;
  name: string;
  type: "local" | "remote";
  status: "connected" | "disconnected";
  models: ProviderModel[];
}

/* ---------------- Execution Engine ---------------- */

export type TaskStatus =
  | "queued"
  | "ready"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "skipped";

export interface Task {
  id: string;
  workflowId: string;
  stageId: string;
  title: string;
  description: string;
  agent: AgentRole;
  /** Tool the agent will invoke (if any). */
  toolId?: string;
  /** Task ids that must complete before this can run. */
  dependsOn: string[];
  status: TaskStatus;
  /** Estimated/runtime duration in ms. */
  durationMs: number;
  startedAt?: number;
  finishedAt?: number;
  result?: string;
  /** Retry state for self-healing. */
  retryLevel?: number;
  /** Quality gate this task represents (if any). */
  gate?: GateId;
}

export type GateId =
  | "architecture"
  | "compilation"
  | "security"
  | "performance"
  | "accessibility"
  | "documentation"
  | "packaging"
  | "regression"
  | "unit-test";

export interface GateResult {
  gate: GateId;
  passed: boolean;
  detail: string;
  metric?: string;
}

export interface EngineEvent {
  id: string;
  ts: number;
  type:
    | "task-queued"
    | "task-started"
    | "task-succeeded"
    | "task-failed"
    | "task-retried"
    | "gate-evaluated"
    | "checkpoint-saved"
    | "checkpoint-restored"
    | "stage-transition"
    | "workflow-selected"
    | "decision-made"
    | "capability-detected"
    | "artifact-produced"
    | "memory-written";
  taskId?: string;
  stageId?: string;
  workflowId?: string;
  message: string;
  level: "debug" | "info" | "warn" | "error" | "success";
}

/* ---------------- Workflow Engine ---------------- */

export type WorkflowId =
  | "new-project"
  | "continue-existing"
  | "bug-fix"
  | "refactor"
  | "add-feature"
  | "upgrade-framework"
  | "package-project"
  | "export-project";

export interface WorkflowStage {
  id: string;
  label: string;
  description: string;
  /** Agents required for this stage. */
  agents: AgentRole[];
  /** Quality gates that must pass before transitioning. */
  gates?: GateId[];
  entryCondition?: string;
  rollbackPolicy?: "none" | "checkpoint" | "full";
}

export interface Workflow {
  id: WorkflowId;
  name: string;
  description: string;
  /** Entry signals (keywords) used by the workflow selector. */
  signals: string[];
  stages: WorkflowStage[];
}

/* ---------------- Memories (7 layered) ---------------- */

export type MemoryKind =
  | "requirements"
  | "architecture"
  | "decision"
  | "code"
  | "build"
  | "artifact"
  | "conversation";

export interface MemoryRecord {
  id: string;
  kind: MemoryKind;
  title: string;
  content: string;
  version: number;
  createdAt: number;
  source: string;
  pinned?: boolean;
}

/* ---------------- Artifact Registry ---------------- */

export type ArtifactType =
  | "source-code"
  | "installer"
  | "apk"
  | "documentation"
  | "architecture-file"
  | "decision-log"
  | "test-report"
  | "build-log"
  | "performance-report";

export interface ArtifactRecord {
  id: string;
  type: ArtifactType;
  name: string;
  version: number;
  hash: string;
  producedBy: AgentRole;
  workflowId: WorkflowId;
  stageId: string;
  /** targetId if this artifact belongs to a specific generation target. */
  targetId?: string;
  path: string;
  dependencies: string[];
  sizeLabel: string;
  createdAt: number;
}

/* ---------------- Decision Engine ---------------- */

/** Non-functional requirements inferred from the prompt. */
export type NonFunctional =
  | "offline-first"
  | "cross-platform"
  | "enterprise"
  | "multi-tenant"
  | "embedded"
  | "low-memory"
  | "performance"
  | "realtime"
  | "marketing"
  | "native"
  | "rich-controls";

export interface DecisionPolicy {
  id: string;
  /** Human-readable summary of the match condition. */
  when: string;
  /** Structured match criteria used for scoring. */
  match: {
    platform?: PlatformKind;
    capabilities?: Capability[];
    nonFunctionals?: NonFunctional[];
  };
  choose: string;
  rationale: string;
  confidence: number;
}

export interface DecisionRecord {
  id: string;
  policyId: string;
  topic: string;
  chosen: string;
  rationale: string;
  confidence: number;
  alternativesRejected: { option: string; reason: string }[];
  createdAt: number;
}

/* ---------------- Self-healing ---------------- */

export type SelfHealLevel =
  | "fastfix"
  | "incremental-patch"
  | "module-rewrite"
  | "architecture-reevaluation"
  | "human-question";

export interface SelfHealPolicy {
  retryLimitsPerLevel: Record<SelfHealLevel, number>;
  escalationThreshold: number;
  patchStrategy: "minimal-diff" | "module-rewrite";
  rollbackBehavior: "auto" | "manual";
}

/* ---------------- Checkpointing ---------------- */

export interface Checkpoint {
  id: string;
  workflowId: WorkflowId;
  stageId: string;
  taskId?: string;
  ts: number;
  stageStatusSnapshot: Record<string, TaskStatus>;
  memoryVersion: number;
}

/* ---------------- Observability ---------------- */

export interface ObservabilityMetric {
  agent: AgentRole;
  tasksCompleted: number;
  tokensUsed: number;
  costEstimate: number;
  avgDurationMs: number;
  failures: number;
}
