import type {
  ProjectMeta,
  PipelineStage,
  Artifact,
  LogLine,
  ModelProvider,
  AISettings,
  ChatMessage,
  StageId,
  Agent,
  AgentRole,
  Skill,
  SkillCategory,
  TargetSpec,
} from "./types";

export const initialStages: PipelineStage[] = [
  { id: "analyze", label: "Understanding", description: "Parsing your requirements", status: "pending" },
  { id: "plan", label: "Planning", description: "Decomposing into an execution plan", status: "pending" },
  { id: "architect", label: "Architecture", description: "Designing modules & data flow", status: "pending" },
  { id: "generate", label: "Generating", description: "Writing the implementation", status: "pending" },
  { id: "build", label: "Building", description: "Compiling & self-healing errors", status: "pending" },
  { id: "test", label: "Testing", description: "Generating & running tests", status: "pending" },
  { id: "package", label: "Packaging", description: "Producing installers & artifacts", status: "pending" },
  { id: "ready", label: "Ready", description: "Deliverables available", status: "pending" },
];

export const stageOrder: StageId[] = [
  "analyze",
  "plan",
  "architect",
  "generate",
  "build",
  "test",
  "package",
  "ready",
];

export const seedProviders: ModelProvider[] = [
  { id: "prov-remote", name: "Pavan Cloud", type: "remote", model: "pavan-orion-1", status: "connected" },
  { id: "prov-local", name: "Local Runtime", type: "local", model: "qwen2.5-coder-32b", status: "connected" },
  { id: "prov-embedded", name: "Offline Nano", type: "local", model: "phi-3.5-mini", status: "disconnected" },
];

export const defaultSettings: AISettings = {
  providerId: "prov-remote",
  model: "pavan-orion-1",
  autonomy: "autonomous",
  autoDetectKind: true,
  selfHeal: true,
  generateTests: true,
  generateDocs: true,
  offlineFirst: true,
};

/* ---------------- Multi-target seed projects ---------------- */

const invoicerTargets: TargetSpec[] = [
  { id: "t1", kind: "windows", label: "Desktop App", role: "Primary invoicing workspace", stack: "WinUI 3 + .NET 8" },
];
const pulseTargets: TargetSpec[] = [
  { id: "t1", kind: "web", label: "Web App", role: "Analytics dashboard & ingestion API", stack: "Next.js + Node.js" },
];
const trailmateTargets: TargetSpec[] = [
  { id: "t1", kind: "android", label: "Android App", role: "On-device hiking companion", stack: "Flutter + Kotlin modules" },
];

export const seedProjects: ProjectMeta[] = [
  {
    id: "proj-invoicer",
    name: "Invoicer Desktop",
    kind: "windows",
    stack: "WinUI 3 + .NET 8",
    description: "Offline-first Windows invoicing app with PDF export & recurring invoices.",
    createdAt: "2025-01-12T09:14:00Z",
    prompt: "A Windows desktop invoicing app for small businesses. Offline-first, local encrypted storage, PDF export, multi-currency, recurring invoices, dashboard with charts.",
    targets: invoicerTargets,
  },
  {
    id: "proj-pulse",
    name: "Pulse Analytics",
    kind: "web",
    stack: "Next.js + Node.js",
    description: "Real-time web analytics dashboard with event ingestion and cohorts.",
    createdAt: "2025-01-03T11:00:00Z",
    prompt: "A real-time web analytics SaaS with an event ingestion API, live dashboards, funnels, retention cohorts, team management, and Stripe billing.",
    targets: pulseTargets,
  },
  {
    id: "proj-trailmate",
    name: "TrailMate",
    kind: "android",
    stack: "Flutter + Kotlin modules",
    description: "Hiking companion with offline maps and on-device AI trail recommendations.",
    createdAt: "2024-12-20T08:30:00Z",
    prompt: "An Android hiking app with offline topo maps, GPS trail recording, elevation profiles, community trails, and on-device AI recommendations.",
    targets: trailmateTargets,
  },
];

export const seedChat: ChatMessage[] = [
  {
    id: "sys-1",
    role: "system",
    content:
      "Pavan is online. Describe what you want to build in plain language — the engine analyzes requirements, selects technologies, and orchestrates specialist agents to plan, architect, generate, build, test, and package it automatically. You never have to touch a code editor.",
    timestamp: Date.now() - 1000 * 60 * 5,
  },
];

export const starterSuggestions: { title: string; prompt: string; icon: string }[] = [
  {
    title: "CRM + Android + web",
    prompt:
      "Build me a CRM desktop application with an Android companion app and a web admin portal. Contacts, deals, pipeline, sync, and a dashboard.",
    icon: "layers",
  },
  {
    title: "Windows invoicing app",
    prompt:
      "A Windows desktop invoicing app for small businesses. Offline-first, local encrypted storage, PDF export, multi-currency, recurring invoices, and a dashboard with charts.",
    icon: "monitor",
  },
  {
    title: "Real-time analytics SaaS",
    prompt:
      "A real-time web analytics SaaS with an event ingestion API, live dashboards, funnels, retention cohorts, team workspaces, and Stripe billing.",
    icon: "globe",
  },
  {
    title: "Android hiking companion",
    prompt:
      "An Android hiking app with offline topo maps, GPS trail recording, elevation profiles, community trails, and on-device AI recommendations.",
    icon: "smartphone",
  },
];

/* ---------------- Stage detail snippets ---------------- */

export const stageDetails: Record<StageId, string[]> = {
  analyze: [
    "Detected intent & capability domains",
    "Resolved ambiguities against memory",
    "Decomposed into features & constraints",
  ],
  plan: [
    "Task graph with dependencies",
    "Agents assigned per capability",
    "Critical path identified",
  ],
  architect: [
    "Module decomposition & boundaries",
    "Technology selected per target",
    "Data flow & persistence designed",
  ],
  generate: [
    "Scaffolding solutions per target",
    "Implementing features across stacks",
    "Reviewer checking quality inline",
  ],
  build: [
    "Compiling all targets in parallel",
    "Self-healing build failures",
    "Static analysis & lint clean",
  ],
  test: [
    "Generated unit, integration, UI tests",
    "Executed suites per target",
    "Debugger repairing failures",
  ],
  package: [
    "Installers, MSIX, APK staged",
    "Source bundles & docs packaged",
    "Release artifacts signed",
  ],
  ready: ["Artifacts available for download", "Live previews running", "Ready to publish"],
};

export const seedLogs: LogLine[] = [
  { id: "l1", ts: "09:14:01", level: "info", source: "orchestrator", message: "Pavan orchestration engine started" },
  { id: "l2", ts: "09:14:02", level: "success", source: "provider", message: "Connected to Pavan Cloud (pavan-orion-1)" },
  { id: "l3", ts: "09:14:03", level: "info", source: "orchestrator", message: "10 specialist agents online · 96 skills loaded" },
];

/* ---------------- Multi-agent roster ---------------- */

export const agents: Agent[] = [
  { id: "orchestrator", name: "Conductor", role: "Orchestrator", icon: "network", color: "emerald", description: "Coordinates all agents and the end-to-end pipeline.", skills: 0 },
  { id: "planner", name: "Atlas", role: "Planner", icon: "list-checks", color: "amber", description: "Analyzes requirements, detects ambiguity, decomposes work.", skills: 0 },
  { id: "architect", name: "Vitruvius", role: "Architect", icon: "drafting-compass", color: "violet", description: "Designs system architecture, modules, and data flow.", skills: 0 },
  { id: "selector", name: "Edison", role: "Technology Selector", icon: "layers", color: "sky", description: "Chooses the optimal stack and toolchain per target.", skills: 0 },
  { id: "coder", name: "Forge", role: "Code Generator", icon: "code", color: "emerald", description: "Implements code across every supported language & framework.", skills: 0 },
  { id: "reviewer", name: "Sage", role: "Reviewer", icon: "scan-search", color: "teal", description: "Reviews diffs, runs static analysis, enforces quality.", skills: 0 },
  { id: "tester", name: "Probe", role: "Tester", icon: "flask-conical", color: "rose", description: "Generates and executes unit, integration, and UI tests.", skills: 0 },
  { id: "debugger", name: "Hound", role: "Debugger", icon: "bug", color: "orange", description: "Root-causes failures and applies self-healing repairs.", skills: 0 },
  { id: "builder", name: "Cargo", role: "Build & Release", icon: "package", color: "cyan", description: "Compiles, packages installers, and prepares releases.", skills: 0 },
  { id: "docs", name: "Quill", role: "Documentation", icon: "book-open", color: "indigo", description: "Generates and maintains READMEs, API refs, and guides.", skills: 0 },
];

export const stageAgentMap: Record<StageId, AgentRole[]> = {
  analyze: ["planner", "orchestrator"],
  plan: ["planner", "orchestrator"],
  architect: ["architect", "selector"],
  generate: ["coder", "reviewer"],
  build: ["builder", "debugger"],
  test: ["tester", "debugger"],
  package: ["builder", "docs"],
  ready: ["orchestrator"],
};

/* ---------------- Capability domain catalog ---------------- */

export const skillCategories: SkillCategory[] = [
  { id: "requirements", name: "Requirements", icon: "clipboard-list", description: "Understanding and structuring what to build" },
  { id: "architecture", name: "Architecture", icon: "drafting-compass", description: "System design and module decomposition" },
  { id: "scaffolding", name: "Project Generation", icon: "folder-plus", description: "Scaffolding and solution generation" },
  { id: "frontend", name: "Frontend", icon: "layout", description: "Web UI frameworks and styling" },
  { id: "windows", name: "Windows Desktop", icon: "monitor", description: "Native & cross-platform Windows apps" },
  { id: "android", name: "Android", icon: "smartphone", description: "Native and cross-platform mobile" },
  { id: "backend", name: "Backend", icon: "server", description: "Server frameworks and runtimes" },
  { id: "database", name: "Database", icon: "database", description: "Persistence and data stores" },
  { id: "ai", name: "AI", icon: "brain-circuit", description: "LLMs, RAG, and agent orchestration" },
  { id: "api", name: "API", icon: "webhook", description: "Interface design and protocols" },
  { id: "packaging", name: "Build & Packaging", icon: "package", description: "Compilers, package managers, installers" },
  { id: "testing", name: "Testing", icon: "flask-conical", description: "Verification across the pyramid" },
  { id: "security", name: "Security", icon: "shield-check", description: "Auth, crypto, and supply-chain safety" },
  { id: "debugging", name: "Debugging", icon: "bug", description: "Failure analysis and repair" },
  { id: "performance", name: "Performance", icon: "gauge", description: "Profiling and optimization" },
  { id: "devops", name: "DevOps", icon: "git-merge", description: "CI/CD and release automation" },
  { id: "documentation", name: "Documentation", icon: "book-open", description: "Generated and maintained docs" },
  { id: "git", name: "Git", icon: "git-branch", description: "Version control workflows" },
  { id: "ux", name: "UX", icon: "palette", description: "UI generation, accessibility, design systems" },
  { id: "preview", name: "Live Preview", icon: "eye", description: "Live previews and hot reload" },
  { id: "quality", name: "Quality", icon: "sparkles", description: "Refactoring, linting, debt reduction" },
];

export const skills: Skill[] = [
  // Requirements
  { id: "s1", name: "Requirement Analysis", category: "requirements", agent: "planner", description: "Parse natural-language specs into structured requirements." },
  { id: "s2", name: "Ambiguity Detection", category: "requirements", agent: "planner", description: "Flag underspecified or contradictory requirements." },
  { id: "s3", name: "Feature Decomposition", category: "requirements", agent: "planner", description: "Break features into buildable units of work." },
  { id: "s4", name: "User Story Generation", category: "requirements", agent: "planner", description: "Produce acceptance-criteria-driven user stories." },
  // Architecture
  { id: "s5", name: "System Design", category: "architecture", agent: "architect", description: "Design end-to-end system structure and topology." },
  { id: "s6", name: "Module Decomposition", category: "architecture", agent: "architect", description: "Define module boundaries and responsibilities." },
  { id: "s7", name: "Dependency Analysis", category: "architecture", agent: "architect", description: "Map and validate inter-module dependencies." },
  { id: "s8", name: "Design Patterns", category: "architecture", agent: "architect", description: "Apply appropriate patterns (MVVM, CQRS, repos, etc.)." },
  { id: "s9", name: "Multi-target Architecture", category: "architecture", agent: "architect", description: "Coordinate shared + target-specific layers across platforms." },
  // Project Generation
  { id: "s10", name: "Scaffolding", category: "scaffolding", agent: "coder", description: "Generate project skeletons from templates." },
  { id: "s11", name: "Solution Generation", category: "scaffolding", agent: "coder", description: "Produce multi-project solutions and workspaces." },
  { id: "s12", name: "Project Templates", category: "scaffolding", agent: "coder", description: "Use and maintain project/item templates." },
  { id: "s13", name: "Configuration", category: "scaffolding", agent: "coder", description: "Emit build configs, env, and manifests." },
  // Frontend
  { id: "s14", name: "React", category: "frontend", agent: "coder", description: "Component architecture, hooks, state." },
  { id: "s15", name: "Next.js", category: "frontend", agent: "coder", description: "App Router, RSC, server actions, routing." },
  { id: "s16", name: "Vue", category: "frontend", agent: "coder", description: "Composition API, Pinia, Nuxt." },
  { id: "s17", name: "Angular", category: "frontend", agent: "coder", description: "Modules, RxJS, standalone components." },
  { id: "s18", name: "Svelte", category: "frontend", agent: "coder", description: "SvelteKit, stores, transitions." },
  { id: "s19", name: "HTML / CSS", category: "frontend", agent: "coder", description: "Semantic markup and modern CSS." },
  { id: "s20", name: "Tailwind + shadcn/ui", category: "frontend", agent: "coder", description: "Utility-first styling and accessible components." },
  // Windows Desktop
  { id: "s21", name: "WinUI 3", category: "windows", agent: "coder", description: "Modern native Windows UI with WinAppSDK." },
  { id: "s22", name: "WPF", category: "windows", agent: "coder", description: "XAML + MVVM desktop applications." },
  { id: "s23", name: "WinForms", category: "windows", agent: "coder", description: "Rapid LOB Windows applications." },
  { id: "s24", name: "Avalonia", category: "windows", agent: "coder", description: "Cross-platform XAML desktop apps." },
  { id: "s25", name: "Tauri", category: "windows", agent: "coder", description: "Rust core + webview desktop apps." },
  { id: "s26", name: "Electron", category: "windows", agent: "coder", description: "Node.js + Chromium desktop apps." },
  { id: "s27", name: "Win32 / C++", category: "windows", agent: "coder", description: "Native Win32, COM, and modern C++ desktop." },
  // Android
  { id: "s28", name: "Kotlin", category: "android", agent: "coder", description: "Coroutines, flows, and idiomatic Kotlin." },
  { id: "s29", name: "Jetpack Compose", category: "android", agent: "coder", description: "Declarative Android UI toolkit." },
  { id: "s30", name: "Flutter", category: "android", agent: "coder", description: "Dart + Flutter cross-platform UI." },
  { id: "s31", name: "React Native", category: "android", agent: "coder", description: "JS-driven native mobile apps." },
  // Backend
  { id: "s32", name: "ASP.NET Core", category: "backend", agent: "coder", description: "Minimal APIs, DI, middleware, EF Core." },
  { id: "s33", name: "Node.js", category: "backend", agent: "coder", description: "Runtime, streams, and worker threads." },
  { id: "s34", name: "Express", category: "backend", agent: "coder", description: "Minimal Node web framework." },
  { id: "s35", name: "NestJS", category: "backend", agent: "coder", description: "Opinionated Node framework with DI." },
  { id: "s36", name: "FastAPI", category: "backend", agent: "coder", description: "Async Python APIs with type safety." },
  { id: "s37", name: "Spring Boot", category: "backend", agent: "coder", description: "Java/Kotlin enterprise backend." },
  // Database
  { id: "s38", name: "SQLite", category: "database", agent: "coder", description: "Embedded relational storage (SQLCipher aware)." },
  { id: "s39", name: "PostgreSQL", category: "database", agent: "coder", description: "Advanced relational database." },
  { id: "s40", name: "MySQL", category: "database", agent: "coder", description: "Popular relational database." },
  { id: "s41", name: "SQL Server", category: "database", agent: "coder", description: "Microsoft relational database." },
  { id: "s42", name: "MongoDB", category: "database", agent: "coder", description: "Document-oriented NoSQL." },
  { id: "s43", name: "Redis", category: "database", agent: "coder", description: "In-memory cache and streams." },
  // AI
  { id: "s44", name: "LLM Integration", category: "ai", agent: "coder", description: "Wire chat/completion APIs with streaming." },
  { id: "s45", name: "RAG", category: "ai", agent: "coder", description: "Retrieval-augmented generation pipelines." },
  { id: "s46", name: "Embeddings", category: "ai", agent: "coder", description: "Vector embeddings and similarity search." },
  { id: "s47", name: "Vector Databases", category: "ai", agent: "coder", description: "pgvector, Qdrant, Chroma integration." },
  { id: "s48", name: "Agent Orchestration", category: "ai", agent: "coder", description: "Multi-step agent loops and tool use." },
  // API
  { id: "s49", name: "REST", category: "api", agent: "coder", description: "Resource-oriented HTTP APIs." },
  { id: "s50", name: "GraphQL", category: "api", agent: "coder", description: "Schema-driven query APIs." },
  { id: "s51", name: "gRPC", category: "api", agent: "coder", description: "Typed high-performance RPC." },
  { id: "s52", name: "WebSockets", category: "api", agent: "coder", description: "Real-time bidirectional communication." },
  { id: "s53", name: "OpenAPI", category: "api", agent: "coder", description: "Spec generation and client generation." },
  // Build & Packaging
  { id: "s54", name: "MSBuild", category: "packaging", agent: "builder", description: ".NET solution builds and props." },
  { id: "s55", name: "Gradle", category: "packaging", agent: "builder", description: "Android/JVM builds and variants." },
  { id: "s56", name: "Cargo", category: "packaging", agent: "builder", description: "Rust workspace builds and releases." },
  { id: "s57", name: "npm / Bun", category: "packaging", agent: "builder", description: "JS package management and bundling." },
  { id: "s58", name: "WiX Toolset", category: "packaging", agent: "builder", description: "Windows MSI installers." },
  { id: "s59", name: "MSIX", category: "packaging", agent: "builder", description: "Modern Windows app packaging." },
  { id: "s60", name: "APK / AAB", category: "packaging", agent: "builder", description: "Android installable bundles." },
  { id: "s61", name: "Installers", category: "packaging", agent: "builder", description: "Cross-platform installer generation." },
  // Testing
  { id: "s62", name: "Unit Testing", category: "testing", agent: "tester", description: "xUnit, Jest, pytest, JUnit cases." },
  { id: "s63", name: "Integration Testing", category: "testing", agent: "tester", description: "Cross-module and API integration tests." },
  { id: "s64", name: "UI Testing", category: "testing", agent: "tester", description: "Playwright, Appium, WinAppDriver." },
  { id: "s65", name: "Performance Testing", category: "testing", agent: "tester", description: "Load and soak testing." },
  { id: "s66", name: "Regression Testing", category: "testing", agent: "tester", description: "Guard against regressions across changes." },
  // Security
  { id: "s67", name: "Authentication", category: "security", agent: "reviewer", description: "OAuth, OIDC, session, and MFA." },
  { id: "s68", name: "Authorization", category: "security", agent: "reviewer", description: "RBAC/ABAC and policy enforcement." },
  { id: "s69", name: "Encryption", category: "security", agent: "reviewer", description: "At-rest and in-transit crypto choices." },
  { id: "s70", name: "Secure Coding", category: "security", agent: "reviewer", description: "OWASP-aligned input validation and secrets." },
  { id: "s71", name: "Dependency Auditing", category: "security", agent: "reviewer", description: "Scan advisories and licenses." },
  // Debugging
  { id: "s72", name: "Build Failures", category: "debugging", agent: "debugger", description: "Diagnose and repair compile errors." },
  { id: "s73", name: "Runtime Errors", category: "debugging", agent: "debugger", description: "Trace and fix exceptions and panics." },
  { id: "s74", name: "Log Analysis", category: "debugging", agent: "debugger", description: "Correlate logs to root causes." },
  { id: "s75", name: "Root-Cause Analysis", category: "debugging", agent: "debugger", description: "Bisect failures to the offending change." },
  // Performance
  { id: "s76", name: "Profiling", category: "performance", agent: "debugger", description: "CPU, allocation, and IO profiling." },
  { id: "s77", name: "Optimization", category: "performance", agent: "debugger", description: "Hot-path and algorithmic improvements." },
  { id: "s78", name: "Memory Analysis", category: "performance", agent: "debugger", description: "Leak detection and heap analysis." },
  // DevOps
  { id: "s79", name: "CI/CD", category: "devops", agent: "builder", description: "GitHub Actions / Azure Pipelines workflows." },
  { id: "s80", name: "Docker", category: "devops", agent: "builder", description: "Container images and compose." },
  { id: "s81", name: "Deployment Pipelines", category: "devops", agent: "builder", description: "Promote artifacts across environments." },
  { id: "s82", name: "Release Automation", category: "devops", agent: "builder", description: "Version, tag, and publish releases." },
  // Documentation
  { id: "s83", name: "README", category: "documentation", agent: "docs", description: "Project overviews and quickstarts." },
  { id: "s84", name: "API Docs", category: "documentation", agent: "docs", description: "Reference docs from specs and code." },
  { id: "s85", name: "Architecture Docs", category: "documentation", agent: "docs", description: "Diagrams, ADRs, and module docs." },
  { id: "s86", name: "User Guides", category: "documentation", agent: "docs", description: "End-user documentation and onboarding." },
  // Git
  { id: "s87", name: "Commit Planning", category: "git", agent: "reviewer", description: "Structure logical, reviewable commits." },
  { id: "s88", name: "Branching", category: "git", agent: "reviewer", description: "Branch strategy and naming." },
  { id: "s89", name: "Merge Conflict Resolution", category: "git", agent: "reviewer", description: "Resolve conflicts preserving intent." },
  { id: "s90", name: "Code Review", category: "git", agent: "reviewer", description: "Review diffs for quality and correctness." },
  // UX
  { id: "s91", name: "UI Generation", category: "ux", agent: "coder", description: "Generate layouts from intent." },
  { id: "s92", name: "Accessibility", category: "ux", agent: "reviewer", description: "WCAG, ARIA, keyboard, and contrast." },
  { id: "s93", name: "Responsive Layouts", category: "ux", agent: "coder", description: "Mobile-first adaptive UI." },
  { id: "s94", name: "Design Systems", category: "ux", agent: "coder", description: "Tokens, themes, and component libraries." },
  // Live Preview
  { id: "s95", name: "Web Preview", category: "preview", agent: "builder", description: "Live web preview with hot reload." },
  { id: "s96", name: "Windows Preview", category: "preview", agent: "builder", description: "Live Windows desktop preview." },
  { id: "s97", name: "Android Preview", category: "preview", agent: "builder", description: "Emulator/device preview integration." },
  { id: "s98", name: "Hot Reload", category: "preview", agent: "builder", description: "Instant feedback on edits." },
  { id: "s99", name: "UI Inspector", category: "preview", agent: "builder", description: "Inspect and tweak rendered UI." },
  // Quality
  { id: "s100", name: "Refactoring", category: "quality", agent: "reviewer", description: "Safe, behavior-preserving refactors." },
  { id: "s101", name: "Static Analysis", category: "quality", agent: "reviewer", description: "Roslyn, ESLint, Clippy, Detekt." },
  { id: "s102", name: "Linting", category: "quality", agent: "reviewer", description: "Style and convention enforcement." },
  { id: "s103", name: "Technical Debt Reduction", category: "quality", agent: "reviewer", description: "Identify and pay down debt." },
];

// Derive skill counts per agent
export const agentSkillCounts: Record<AgentRole, number> = skills.reduce(
  (acc, s) => {
    acc[s.agent] = (acc[s.agent] ?? 0) + 1;
    return acc;
  },
  {} as Record<AgentRole, number>
);

// Patch agent skill counts
agents.forEach((a) => {
  a.skills = agentSkillCounts[a.id] ?? 0;
});

export function makeArtifacts(projectName: string, _kind: string, targets: TargetSpec[]): Artifact[] {
  const arts: Artifact[] = [];
  for (const t of targets) {
    const slug = projectName.replace(/[^a-zA-Z0-9]/g, "");
    if (t.kind === "windows") {
      arts.push({ id: `a-${t.id}-exe`, name: `${slug}-Setup.exe`, kind: "installer", platform: "Windows", targetId: t.id, sizeLabel: "84.2 MB", ready: false, url: "#" });
      arts.push({ id: `a-${t.id}-msix`, name: `${slug}.msix`, kind: "installer", platform: "Windows", targetId: t.id, sizeLabel: "79.5 MB", ready: false, url: "#" });
    } else if (t.kind === "android") {
      arts.push({ id: `a-${t.id}-apk`, name: `${slug}.apk`, kind: "installer", platform: "Android", targetId: t.id, sizeLabel: "42.1 MB", ready: false, url: "#" });
      arts.push({ id: `a-${t.id}-aab`, name: `${slug}.aab`, kind: "package", platform: "Android", targetId: t.id, sizeLabel: "38.7 MB", ready: false, url: "#" });
    } else if (t.kind === "web") {
      arts.push({ id: `a-${t.id}-web`, name: `${slug}-web.zip`, kind: "package", platform: "Web", targetId: t.id, sizeLabel: "8.4 MB", ready: false, url: "#" });
    } else if (t.kind === "cli") {
      arts.push({ id: `a-${t.id}-bin`, name: `${slug}-${t.kind}`, kind: "app", platform: "Cross-platform", targetId: t.id, sizeLabel: "6.2 MB", ready: false, url: "#" });
    } else {
      arts.push({ id: `a-${t.id}-pkg`, name: `${slug}-${t.kind}.zip`, kind: "package", platform: "All", targetId: t.id, sizeLabel: "5.0 MB", ready: false, url: "#" });
    }
  }
  // shared artifacts
  arts.push({ id: "a-src", name: `${projectName.replace(/[^a-zA-Z0-9]/g, "")}-source.zip`, kind: "source", platform: "All", sizeLabel: "12.4 MB", ready: false, url: "#" });
  arts.push({ id: "a-docs", name: `architecture.pdf`, kind: "docs", platform: "All", sizeLabel: "1.1 MB", ready: false, url: "#" });
  return arts;
}
