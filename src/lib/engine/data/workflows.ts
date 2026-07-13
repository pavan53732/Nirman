import type { Workflow, DecisionPolicy } from "../types";

// Workflow Engine — reusable DAGs. The orchestrator selects a workflow from
// user intent and Project Memory state, then hands it to the Execution Engine.
export const workflows: Workflow[] = [
  {
    id: "new-project",
    name: "New Project",
    description: "Full autonomous build from a natural-language requirement.",
    signals: ["build", "create", "make", "generate", "develop", "i want", "i need", "new"],
    stages: [
      { id: "analyze", label: "Understanding", description: "Parse requirements, detect capabilities", agents: ["requirements-analyst", "decision-engine"], gates: [], entryCondition: "prompt received", rollbackPolicy: "none" },
      { id: "plan", label: "Planning", description: "Decompose into a dependency-ordered plan", agents: ["planner", "project-manager"], gates: ["architecture"] },
      { id: "architect", label: "Architecture", description: "Design modules, data flow, select stacks", agents: ["solution-architect", "platform-architect", "database-architect", "api-architect", "decision-engine"], gates: ["architecture"] },
      { id: "generate", label: "Generating", description: "Implement across all targets", agents: ["frontend-generator", "desktop-generator", "android-generator", "backend-generator", "database-generator"], gates: ["compilation"] },
      { id: "build", label: "Building", description: "Compile & self-heal errors", agents: ["build-engineer", "static-analyzer"], gates: ["compilation"] },
      { id: "test", label: "Testing", description: "Generate & run tests", agents: ["test-generator", "unit-test-agent", "integration-test-agent", "ui-test-agent"], gates: ["unit-test", "regression"] },
      { id: "package", label: "Packaging", description: "Produce installers & artifacts", agents: ["packaging-engineer", "documentation-writer"], gates: ["packaging", "documentation", "security"] },
      { id: "ready", label: "Ready", description: "Deliverables available", agents: ["orchestrator"], gates: [], rollbackPolicy: "checkpoint" },
    ],
  },
  {
    id: "continue-existing",
    name: "Continue Existing Project",
    description: "Resume a project from its last checkpoint.",
    signals: ["continue", "resume", "pick up", "keep going"],
    stages: [
      { id: "restore", label: "Restore", description: "Load Project Memory and checkpoints", agents: ["project-memory-manager", "context-builder"], gates: [] },
      { id: "plan", label: "Planning", description: "Plan remaining work", agents: ["planner"], gates: ["architecture"] },
      { id: "generate", label: "Generating", description: "Continue implementation", agents: ["frontend-generator", "backend-generator"], gates: ["compilation"] },
      { id: "build", label: "Building", description: "Compile & self-heal", agents: ["build-engineer"], gates: ["compilation"] },
      { id: "test", label: "Testing", description: "Run tests", agents: ["unit-test-agent"], gates: ["unit-test", "regression"] },
      { id: "ready", label: "Ready", description: "Deliverables updated", agents: ["orchestrator"], gates: [] },
    ],
  },
  {
    id: "bug-fix",
    name: "Bug Fix",
    description: "Diagnose and repair a reported defect.",
    signals: ["fix", "bug", "broken", "error", "crash", "doesn't work", "failing"],
    stages: [
      { id: "reproduce", label: "Reproduce", description: "Reproduce the issue", agents: ["code-reviewer", "test-generator"], gates: [] },
      { id: "diagnose", label: "Diagnose", description: "Root-cause analysis", agents: ["code-reviewer", "static-analyzer"], gates: [] },
      { id: "patch", label: "Patch", description: "Apply minimal-diff fix", agents: ["frontend-generator", "backend-generator"], gates: ["compilation"] },
      { id: "verify", label: "Verify", description: "Run regression tests", agents: ["integration-test-agent"], gates: ["regression"] },
      { id: "ready", label: "Ready", description: "Fix verified", agents: ["orchestrator"], gates: [] },
    ],
  },
  {
    id: "refactor",
    name: "Refactor",
    description: "Improve structure without changing behavior.",
    signals: ["refactor", "clean up", "restructure", "simplify"],
    stages: [
      { id: "analyze", label: "Analyze", description: "Map current structure", agents: ["software-architect", "static-analyzer"], gates: [] },
      { id: "plan", label: "Plan", description: "Plan safe refactors", agents: ["refactoring-agent"], gates: ["architecture"] },
      { id: "refactor", label: "Refactor", description: "Apply behavior-preserving changes", agents: ["refactoring-agent"], gates: ["compilation"] },
      { id: "verify", label: "Verify", description: "Regression check", agents: ["integration-test-agent"], gates: ["regression"] },
      { id: "ready", label: "Ready", description: "Refactor complete", agents: ["orchestrator"], gates: [] },
    ],
  },
  {
    id: "add-feature",
    name: "Add Feature",
    description: "Extend an existing project with a new capability.",
    signals: ["add", "extend", "feature", "support", "include"],
    stages: [
      { id: "analyze", label: "Understanding", description: "Understand the new feature", agents: ["requirements-analyst"], gates: [] },
      { id: "plan", label: "Planning", description: "Plan the addition", agents: ["planner"], gates: ["architecture"] },
      { id: "architect", label: "Architecture", description: "Design the integration", agents: ["solution-architect"], gates: ["architecture"] },
      { id: "generate", label: "Generating", description: "Implement the feature", agents: ["frontend-generator", "backend-generator"], gates: ["compilation"] },
      { id: "build", label: "Building", description: "Compile", agents: ["build-engineer"], gates: ["compilation"] },
      { id: "test", label: "Testing", description: "Test the feature", agents: ["test-generator", "unit-test-agent"], gates: ["unit-test", "regression"] },
      { id: "ready", label: "Ready", description: "Feature shipped", agents: ["orchestrator"], gates: [] },
    ],
  },
  {
    id: "upgrade-framework",
    name: "Upgrade Framework",
    description: "Migrate to a newer framework/version.",
    signals: ["upgrade", "migrate", "update framework", "newer version"],
    stages: [
      { id: "assess", label: "Assess", description: "Assess upgrade impact", agents: ["migration-agent", "dependency-auditor"], gates: [] },
      { id: "plan", label: "Plan", description: "Plan migration", agents: ["migration-agent"], gates: ["architecture"] },
      { id: "migrate", label: "Migrate", description: "Apply migration", agents: ["migration-agent"], gates: ["compilation"] },
      { id: "verify", label: "Verify", description: "Regression check", agents: ["integration-test-agent"], gates: ["regression"] },
      { id: "ready", label: "Ready", description: "Upgrade complete", agents: ["orchestrator"], gates: [] },
    ],
  },
  {
    id: "package-project",
    name: "Package Project",
    description: "Produce installers and release artifacts.",
    signals: ["package", "bundle", "installer", "release build"],
    stages: [
      { id: "validate", label: "Validate", description: "Ensure gates pass", agents: ["static-analyzer"], gates: ["compilation", "security"] },
      { id: "package", label: "Packaging", description: "Build installers", agents: ["packaging-engineer", "installer-specialist"], gates: ["packaging"] },
      { id: "sign", label: "Sign", description: "Sign artifacts", agents: ["packaging-engineer"], gates: [] },
      { id: "ready", label: "Ready", description: "Packages ready", agents: ["orchestrator"], gates: [] },
    ],
  },
  {
    id: "export-project",
    name: "Export Project",
    description: "Export the complete versioned solution to a local folder.",
    signals: ["export", "download", "save to folder", "save to disk"],
    stages: [
      { id: "validate-path", label: "Validate Path", description: "Validate the chosen export path", agents: ["export-manager"], gates: [] },
      { id: "bundle", label: "Bundle", description: "Assemble /backend /desktop /android /web-admin /docs /artifacts + DecisionLog.json", agents: ["export-manager", "artifact-manager"], gates: [] },
      { id: "write", label: "Write", description: "Write solution to the chosen folder", agents: ["export-manager", "tool-manager"], gates: [] },
      { id: "ready", label: "Ready", description: "Export complete", agents: ["orchestrator"], gates: [] },
    ],
  },
];

// Decision policies — reusable rules used by the Decision Engine.
// Each has structured match criteria { platform, capabilities, nonFunctionals }
// used for scoring, plus a human-readable `when` summary. The engine scores
// every policy against the request's actual platform + capabilities +
// non-functionals and picks the highest-scoring one, logging alternatives
// rejected to Decision Memory.
export const decisionPolicies: DecisionPolicy[] = [
  {
    id: "db-offline-single",
    when: "offline-first single-user desktop",
    match: { nonFunctionals: ["offline-first"] },
    choose: "SQLite (SQLCipher)",
    rationale: "Offline-first apps with a single local user need an embedded, encrypted store.",
    confidence: 0.95,
  },
  {
    id: "db-enterprise-multi-tenant",
    when: "enterprise multi-tenant SaaS",
    match: { nonFunctionals: ["enterprise", "multi-tenant"] },
    choose: "PostgreSQL + RLS",
    rationale: "Multi-tenant SaaS benefits from row-level security and a robust server DB.",
    confidence: 0.92,
  },
  {
    id: "db-embedded-low-memory",
    when: "embedded low-memory target",
    match: { nonFunctionals: ["embedded", "low-memory"] },
    choose: "LiteDB",
    rationale: "Embedded targets with tight memory use a lightweight document store.",
    confidence: 0.88,
  },
  {
    id: "ui-windows-native",
    when: "windows native rich-controls",
    match: { platform: "windows", nonFunctionals: ["native", "rich-controls"] },
    choose: "WinUI 3 + .NET 8",
    rationale: "Native Windows desktops with rich controls get the best UX from WinUI 3.",
    confidence: 0.9,
  },
  {
    id: "ui-windows-cross-platform",
    when: "windows cross-platform",
    match: { platform: "windows", nonFunctionals: ["cross-platform"] },
    choose: "Tauri + Rust",
    rationale: "Cross-platform desktop needs a non-WinUI stack to ship on other OSes.",
    confidence: 0.85,
  },
  {
    id: "ui-android-native",
    when: "android native performance",
    match: { platform: "android", nonFunctionals: ["native", "performance"] },
    choose: "Kotlin + Jetpack Compose",
    rationale: "Native Android performance and platform integration favor Compose.",
    confidence: 0.9,
  },
  {
    id: "ui-android-cross-platform",
    when: "android cross-platform",
    match: { platform: "android", nonFunctionals: ["cross-platform"] },
    choose: "Flutter",
    rationale: "Cross-platform mobile with one codebase favors Flutter.",
    confidence: 0.84,
  },
  {
    id: "web-marketing",
    when: "web marketing",
    match: { platform: "web", nonFunctionals: ["marketing"] },
    choose: "Next.js + Tailwind",
    rationale: "Marketing sites need SEO, speed, and responsive design — Next.js excels.",
    confidence: 0.93,
  },
  {
    id: "web-realtime",
    when: "web realtime",
    match: { platform: "web", nonFunctionals: ["realtime"] },
    choose: "Next.js + WebSockets",
    rationale: "Live dashboards need bidirectional low-latency channels over a Next.js frontend.",
    confidence: 0.9,
  },
  {
    id: "cli-rust",
    when: "cli performance cross-platform",
    match: { platform: "cli", nonFunctionals: ["performance", "cross-platform"] },
    choose: "Rust + clap",
    rationale: "Performance-critical cross-platform CLIs favor Rust.",
    confidence: 0.88,
  },
  {
    id: "ai-rag-stack",
    when: "ai knowledge base",
    match: { capabilities: ["offline-sync"], nonFunctionals: [] },
    choose: "Embeddings + vector DB",
    rationale: "Knowledge-grounded AI needs embeddings and a vector store for retrieval.",
    confidence: 0.9,
  },
];
