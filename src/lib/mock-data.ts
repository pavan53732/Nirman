import type {
  Project,
  Agent,
  Task,
  FileNode,
  ChatMessage,
  MemoryEntry,
  Diagnostic,
  LogEntry,
  BuildStep,
  Plugin,
  ModelProvider,
} from "./types";

export const seedProjects: Project[] = [
  {
    id: "proj-1",
    name: "Invoicer Desktop",
    type: "windows",
    stacks: ["WinUI 3", "C#", ".NET"],
    description:
      "A Windows-native invoicing desktop application with PDF generation, local SQLite storage, and offline-first sync.",
    path: "C:\\dev\\invoicer-desktop",
    createdAt: "2025-01-12T09:14:00Z",
    updatedAt: "2025-01-18T16:42:00Z",
    status: "implementing",
    progress: 64,
    requirements:
      "Build a Windows desktop invoicing app for small businesses. Offline-first, local SQLite, PDF export, multi-currency, recurring invoices, and a dashboard with charts.",
    repository: "github.com/pavan-labs/invoicer-desktop",
    branch: "feat/recurring-invoices",
    targetPlatform: "Windows 10/11 x64",
  },
  {
    id: "proj-2",
    name: "Pulse Analytics Web",
    type: "web",
    stacks: ["Next.js", "TypeScript", "Node.js"],
    description:
      "Full-stack real-time analytics dashboard with event ingestion, live charts, and team workspaces.",
    path: "/home/pavan/pulse-analytics",
    createdAt: "2025-01-03T11:00:00Z",
    updatedAt: "2025-01-18T15:10:00Z",
    status: "testing",
    progress: 82,
    requirements:
      "Real-time web analytics SaaS. Event ingestion API, live dashboards, funnels, retention cohorts, team management, and Stripe billing.",
    repository: "github.com/pavan-labs/pulse-analytics",
    branch: "main",
    targetPlatform: "Web (Vercel + Fly.io)",
  },
  {
    id: "proj-3",
    name: "TrailMate Android",
    type: "android",
    stacks: ["Kotlin", "Flutter"],
    description:
      "Cross-platform hiking companion with offline maps, GPS tracking, and AI-powered trail recommendations.",
    path: "/home/pavan/trailmate",
    createdAt: "2024-12-20T08:30:00Z",
    updatedAt: "2025-01-17T19:20:00Z",
    status: "ready",
    progress: 100,
    requirements:
      "Android hiking app. Offline topo maps, GPS trail recording, elevation profiles, community trails, and on-device AI recommendations.",
    repository: "github.com/pavan-labs/trailmate",
    branch: "release/1.0",
    targetPlatform: "Android 9+ / iOS via Flutter",
  },
  {
    id: "proj-4",
    name: "cargo-sync CLI",
    type: "cli",
    stacks: ["Rust"],
    description: "A fast, cross-platform CLI for synchronizing local files with remote object storage.",
    path: "/home/pavan/cargo-sync",
    createdAt: "2024-11-28T14:00:00Z",
    updatedAt: "2025-01-10T10:05:00Z",
    status: "deployed",
    progress: 100,
    requirements:
      "Rust CLI tool for incremental file sync to S3-compatible storage with checksums, retries, and parallel transfers.",
    repository: "github.com/pavan-labs/cargo-sync",
    branch: "main",
    targetPlatform: "Linux / macOS / Windows CLI",
  },
];

export const seedAgents: Agent[] = [
  {
    id: "agent-planner",
    role: "planner",
    name: "Atlas",
    status: "idle",
    model: "pavan-local/qwen2.5-32b",
    tokensUsed: 184320,
    tasksCompleted: 47,
    lastActive: "2m ago",
    description: "Decomposes requirements into an ordered, dependency-aware execution plan.",
  },
  {
    id: "agent-architect",
    role: "architect",
    name: "Vitruvius",
    status: "working",
    model: "pavan-remote/claude-sonnet",
    currentTask: "Synthesizing module graph for recurring-invoices feature",
    tokensUsed: 421880,
    tasksCompleted: 132,
    lastActive: "now",
    description: "Designs system architecture, module boundaries, and data flow diagrams.",
  },
  {
    id: "agent-coder",
    role: "coder",
    name: "Forge",
    status: "working",
    model: "pavan-remote/claude-sonnet",
    currentTask: "Implementing InvoiceRepository.GenerateRecurring()",
    tokensUsed: 982144,
    tasksCompleted: 318,
    lastActive: "now",
    description: "Writes implementation code across all supported languages and stacks.",
  },
  {
    id: "agent-reviewer",
    role: "reviewer",
    name: "Sage",
    status: "waiting",
    model: "pavan-local/qwen2.5-32b",
    currentTask: "Awaiting PR #284 for review",
    tokensUsed: 256440,
    tasksCompleted: 96,
    lastActive: "5m ago",
    description: "Reviews diffs for correctness, style, and architectural alignment.",
  },
  {
    id: "agent-tester",
    role: "tester",
    name: "Probe",
    status: "working",
    model: "pavan-local/qwen2.5-14b",
    currentTask: "Generating xUnit tests for InvoiceGenerator",
    tokensUsed: 338900,
    tasksCompleted: 211,
    lastActive: "now",
    description: "Generates and executes unit, integration, and E2E tests.",
  },
  {
    id: "agent-debugger",
    role: "debugger",
    name: "Hound",
    status: "idle",
    model: "pavan-remote/claude-sonnet",
    tokensUsed: 192550,
    tasksCompleted: 74,
    lastActive: "14m ago",
    description: "Root-causes failures and applies automatic repairs in self-healing loops.",
  },
  {
    id: "agent-security",
    role: "security",
    name: "Bastion",
    status: "idle",
    model: "pavan-remote/gpt-4o",
    tokensUsed: 121300,
    tasksCompleted: 38,
    lastActive: "31m ago",
    description: "Performs threat modeling, SAST, dependency audit, and permission review.",
  },
  {
    id: "agent-docs",
    role: "docs",
    name: "Quill",
    status: "idle",
    model: "pavan-local/qwen2.5-14b",
    tokensUsed: 88700,
    tasksCompleted: 52,
    lastActive: "1h ago",
    description: "Generates and maintains READMEs, API references, and architecture docs.",
  },
  {
    id: "agent-release",
    role: "release",
    name: "Cargo",
    status: "idle",
    model: "pavan-local/qwen2.5-14b",
    tokensUsed: 64200,
    tasksCompleted: 19,
    lastActive: "3h ago",
    description: "Handles versioning, packaging, installers, and deployment pipelines.",
  },
];

export const seedTasks: Task[] = [
  {
    id: "task-1",
    title: "Define recurring invoice domain model",
    description: "Model RecurringInvoice, Schedule, and recurrence rules with timezone awareness.",
    status: "done",
    priority: "high",
    assignedAgent: "architect",
    projectId: "proj-1",
    createdAt: "2025-01-15T10:00:00Z",
    estimateHours: 3,
    tags: ["domain", "modeling"],
    subtasks: [
      { id: "s1", title: "Draft entity diagram", done: true },
      { id: "s2", title: "Validate with Planner", done: true },
    ],
  },
  {
    id: "task-2",
    title: "Implement InvoiceRepository.GenerateRecurring()",
    description: "Generate invoice instances from active schedules with idempotency keys.",
    status: "in-progress",
    priority: "critical",
    assignedAgent: "coder",
    projectId: "proj-1",
    createdAt: "2025-01-16T09:00:00Z",
    estimateHours: 5,
    tags: ["backend", "c#"],
    subtasks: [
      { id: "s1", title: "Schedule evaluator", done: true },
      { id: "s2", title: "Idempotency guard", done: true },
      { id: "s3", title: "PDF render hook", done: false },
    ],
  },
  {
    id: "task-3",
    title: "Write xUnit tests for recurrence engine",
    description: "Cover monthly, weekly, end-of-month, and DST edge cases.",
    status: "in-progress",
    priority: "high",
    assignedAgent: "tester",
    projectId: "proj-1",
    createdAt: "2025-01-16T14:00:00Z",
    estimateHours: 4,
    tags: ["testing", "xunit"],
  },
  {
    id: "task-4",
    title: "Review PR #284 — multi-currency rounding",
    description: "Verify banker's rounding and tax allocation across currencies.",
    status: "review",
    priority: "high",
    assignedAgent: "reviewer",
    projectId: "proj-1",
    createdAt: "2025-01-17T11:30:00Z",
    estimateHours: 1.5,
    tags: ["review", "finance"],
  },
  {
    id: "task-5",
    title: "Security audit: local SQLite encryption",
    description: "Confirm SQLCipher usage and key derivation parameters.",
    status: "backlog",
    priority: "critical",
    assignedAgent: "security",
    projectId: "proj-1",
    createdAt: "2025-01-18T08:00:00Z",
    estimateHours: 3,
    tags: ["security", "crypto"],
  },
  {
    id: "task-6",
    title: "Dashboard chart performance optimization",
    description: "Virtualize large dataset rendering and debounce live updates.",
    status: "planning",
    priority: "medium",
    assignedAgent: "planner",
    projectId: "proj-2",
    createdAt: "2025-01-17T16:00:00Z",
    estimateHours: 6,
    tags: ["performance", "frontend"],
  },
  {
    id: "task-7",
    title: "Event ingestion backpressure handling",
    description: "Add bounded queue and shed policy under load spikes.",
    status: "testing",
    priority: "high",
    assignedAgent: "tester",
    projectId: "proj-2",
    createdAt: "2025-01-16T13:00:00Z",
    estimateHours: 4,
    tags: ["backend", "reliability"],
  },
  {
    id: "task-8",
    title: "Generate v1.0 release installer (MSIX)",
    description: "Package, sign, and publish MSIX bundle to internal store.",
    status: "backlog",
    priority: "medium",
    assignedAgent: "release",
    projectId: "proj-1",
    createdAt: "2025-01-18T09:00:00Z",
    estimateHours: 3,
    tags: ["release", "packaging"],
  },
  {
    id: "task-9",
    title: "Document public REST API with OpenAPI",
    description: "Auto-generate OpenAPI spec and reference docs from routes.",
    status: "done",
    priority: "medium",
    assignedAgent: "docs",
    projectId: "proj-2",
    createdAt: "2025-01-14T10:00:00Z",
    estimateHours: 4,
    tags: ["docs", "api"],
  },
  {
    id: "task-10",
    title: "Fix: GPS trail drift on Android 14",
    description: "Apply Kalman filter smoothing and adaptive accuracy thresholds.",
    status: "review",
    priority: "high",
    assignedAgent: "debugger",
    projectId: "proj-3",
    createdAt: "2025-01-15T15:00:00Z",
    estimateHours: 5,
    tags: ["bug", "gps"],
  },
];

export const seedFileTree: FileNode[] = [
  {
    id: "f-src",
    name: "src",
    type: "folder",
    path: "src",
    children: [
      {
        id: "f-invoicing",
        name: "Invoicing",
        type: "folder",
        path: "src/Invoicing",
        children: [
          {
            id: "f-repo",
            name: "InvoiceRepository.cs",
            type: "file",
            path: "src/Invoicing/InvoiceRepository.cs",
            language: "csharp",
            status: "modified",
            size: 8420,
          },
          {
            id: "f-gen",
            name: "InvoiceGenerator.cs",
            type: "file",
            path: "src/Invoicing/InvoiceGenerator.cs",
            language: "csharp",
            status: "modified",
            size: 5210,
          },
          {
            id: "f-rec",
            name: "RecurringInvoiceService.cs",
            type: "file",
            path: "src/Invoicing/RecurringInvoiceService.cs",
            language: "csharp",
            status: "added",
            size: 3180,
          },
          {
            id: "f-currency",
            name: "CurrencyConverter.cs",
            type: "file",
            path: "src/Invoicing/CurrencyConverter.cs",
            language: "csharp",
            status: "clean",
            size: 2940,
          },
        ],
      },
      {
        id: "f-data",
        name: "Data",
        type: "folder",
        path: "src/Data",
        children: [
          {
            id: "f-ctx",
            name: "AppDbContext.cs",
            type: "file",
            path: "src/Data/AppDbContext.cs",
            language: "csharp",
            status: "clean",
            size: 4120,
          },
          {
            id: "f-migrations",
            name: "Migrations",
            type: "folder",
            path: "src/Data/Migrations",
            children: [
              {
                id: "f-mig1",
                name: "20250115100000_Initial.cs",
                type: "file",
                path: "src/Data/Migrations/20250115100000_Initial.cs",
                language: "csharp",
                status: "clean",
                size: 6200,
              },
              {
                id: "f-mig2",
                name: "20250118120000_RecurringInvoices.cs",
                type: "file",
                path: "src/Data/Migrations/20250118120000_RecurringInvoices.cs",
                language: "csharp",
                status: "added",
                size: 2480,
              },
            ],
          },
        ],
      },
      {
        id: "f-ui",
        name: "UI",
        type: "folder",
        path: "src/UI",
        children: [
          {
            id: "f-mainwin",
            name: "MainWindow.xaml",
            type: "file",
            path: "src/UI/MainWindow.xaml",
            language: "xml",
            status: "clean",
            size: 7820,
          },
          {
            id: "f-dash",
            name: "DashboardView.xaml",
            type: "file",
            path: "src/UI/DashboardView.xaml",
            language: "xml",
            status: "modified",
            size: 5310,
          },
        ],
      },
    ],
  },
  {
    id: "f-tests",
    name: "tests",
    type: "folder",
    path: "tests",
    children: [
      {
        id: "f-rec-test",
        name: "RecurringInvoiceServiceTests.cs",
        type: "file",
        path: "tests/RecurringInvoiceServiceTests.cs",
        language: "csharp",
        status: "added",
        size: 4120,
      },
      {
        id: "f-curr-test",
        name: "CurrencyConverterTests.cs",
        type: "file",
        path: "tests/CurrencyConverterTests.cs",
        language: "csharp",
        status: "clean",
        size: 2680,
      },
    ],
  },
  {
    id: "f-docs",
    name: "docs",
    type: "folder",
    path: "docs",
    children: [
      {
        id: "f-arch",
        name: "architecture.md",
        type: "file",
        path: "docs/architecture.md",
        language: "markdown",
        status: "clean",
        size: 9100,
      },
      {
        id: "f-readme",
        name: "README.md",
        type: "file",
        path: "README.md",
        language: "markdown",
        status: "modified",
        size: 3400,
      },
    ],
  },
  {
    id: "f-csproj",
    name: "Invoicer.Desktop.csproj",
    type: "file",
    path: "Invoicer.Desktop.csproj",
    language: "xml",
    status: "clean",
    size: 1860,
  },
];

export const seedChat: ChatMessage[] = [
  {
    id: "m1",
    role: "system",
    content:
      "Session started. Pavan orchestration engine is online with 9 agents. Active project: Invoicer Desktop.",
    timestamp: "2025-01-18T16:30:00Z",
  },
  {
    id: "m2",
    role: "user",
    content:
      "Add support for recurring invoices with monthly and end-of-month schedules. Make sure it's idempotent and covered by tests.",
    timestamp: "2025-01-18T16:31:00Z",
  },
  {
    id: "m3",
    role: "agent",
    agentRole: "planner",
    content:
      "Decomposed into 6 tasks across 5 agents. Critical path: domain model → repository → PDF hook → tests → review. Estimated 21h, parallelizable to ~9h. Proceeding with architecture synthesis.",
    timestamp: "2025-01-18T16:31:40Z",
    actions: [
      { label: "View plan", type: "open-tasks" },
      { label: "Approve", type: "approve" },
    ],
  },
  {
    id: "m4",
    role: "agent",
    agentRole: "architect",
    content:
      "Designed `RecurringInvoiceService` with a `RecurrenceRule` value object. Idempotency handled via a composite key (scheduleId + periodStart). Migration `20250118120000_RecurringInvoices` drafted.",
    timestamp: "2025-01-18T16:34:00Z",
    actions: [{ label: "Open architecture", type: "open-architecture" }],
  },
  {
    id: "m5",
    role: "agent",
    agentRole: "coder",
    content:
      "Implemented `GenerateRecurring()` and wired the PDF render hook. 2 files modified, 1 added (+3,180 LOC). Build green locally.",
    timestamp: "2025-01-18T16:40:00Z",
  },
  {
    id: "m6",
    role: "assistant",
    content:
      "The Tester agent is now generating xUnit coverage for monthly, weekly, end-of-month, and DST edge cases. I'll surface results in the Build console as they land.",
    timestamp: "2025-01-18T16:42:00Z",
  },
];

export const seedMemory: MemoryEntry[] = [
  {
    id: "mem-1",
    category: "decision",
    title: "Use SQLCipher for local SQLite encryption",
    content:
      "All local databases must use SQLCipher with AES-256 and PBKDF2 key derivation (210k iterations). Decision recorded 2025-01-10 after security review.",
    confidence: 0.96,
    createdAt: "2025-01-10T12:00:00Z",
    source: "agent",
    pinned: true,
  },
  {
    id: "mem-2",
    category: "architecture",
    title: "WinUI 3 + MVVM Toolkit pattern",
    content:
      "Views use WinUI 3 XAML with ViewModels from CommunityToolkit.Mvvm. DI via Microsoft.Extensions. Navigation through a central INavigationService.",
    confidence: 0.92,
    createdAt: "2025-01-08T09:00:00Z",
    source: "agent",
    pinned: true,
  },
  {
    id: "mem-3",
    category: "preference",
    title: "C# naming: file-scoped namespaces",
    content: "User prefers file-scoped namespaces, nullable reference types enabled, and 4-space indentation.",
    confidence: 0.88,
    createdAt: "2025-01-05T14:00:00Z",
    source: "user",
    pinned: false,
  },
  {
    id: "mem-4",
    category: "constraint",
    title: "Offline-first is mandatory",
    content: "Desktop apps must function fully offline. Network calls are enhancement-only with queued sync.",
    confidence: 0.99,
    createdAt: "2025-01-04T10:00:00Z",
    source: "user",
    pinned: true,
  },
  {
    id: "mem-5",
    category: "pattern",
    title: "Idempotency via composite keys",
    content: "Recurring/scheduled operations use (sourceId, periodKey) composite keys to guarantee at-most-once execution.",
    confidence: 0.9,
    createdAt: "2025-01-18T16:34:00Z",
    source: "agent",
    pinned: false,
  },
  {
    id: "mem-6",
    category: "context",
    title: "Target Windows 10+ x64 only",
    content: "Invoicer Desktop targets net8.0-windows10.0.19041. No ARM64 or legacy Windows support in scope.",
    confidence: 0.95,
    createdAt: "2025-01-12T09:20:00Z",
    source: "user",
    pinned: false,
  },
];

export const seedDiagnostics: Diagnostic[] = [
  {
    id: "d1",
    severity: "warning",
    message: "Async method lacks await operators and will run synchronously",
    file: "src/Invoicing/RecurringInvoiceService.cs",
    line: 42,
    column: 21,
    code: "CS1998",
    rule: "async-without-await",
  },
  {
    id: "d2",
    severity: "info",
    message: "Consider using 'var' for local declaration",
    file: "src/Invoicing/InvoiceGenerator.cs",
    line: 118,
    column: 13,
    code: "IDE0007",
    rule: "use-var",
  },
  {
    id: "d3",
    severity: "error",
    message: "Null reference possible return value",
    file: "src/Invoicing/InvoiceRepository.cs",
    line: 207,
    column: 16,
    code: "CS8603",
    rule: "nullable-return",
  },
  {
    id: "d4",
    severity: "hint",
    message: "Field could be made readonly",
    file: "src/Data/AppDbContext.cs",
    line: 14,
    column: 17,
    code: "IDE0044",
    rule: "readonly-field",
  },
  {
    id: "d5",
    severity: "warning",
    message: "Unused using directive",
    file: "tests/RecurringInvoiceServiceTests.cs",
    line: 3,
    column: 1,
    code: "CS8019",
    rule: "unused-using",
  },
];

export const seedLogs: LogEntry[] = [
  { id: "l1", level: "info", source: "orchestrator", message: "Orchestration cycle #1284 started", timestamp: "16:42:01" },
  { id: "l2", level: "success", source: "coder", message: "InvoiceRepository.GenerateRecurring() compiled successfully", timestamp: "16:40:14" },
  { id: "l3", level: "info", source: "indexer", message: "Indexed 1,204 symbols in src/ (12ms)", timestamp: "16:39:50" },
  { id: "l4", level: "warn", source: "security", message: "Dependency 'Newtonsoft.Json 13.0.1' has advisory GHSA-5crp-9r3c-p9vr", timestamp: "16:35:22" },
  { id: "l5", level: "info", source: "architect", message: "Module graph regenerated: 7 modules, 23 edges", timestamp: "16:34:08" },
  { id: "l6", level: "success", source: "planner", message: "Plan committed: 6 tasks, 5 agents assigned", timestamp: "16:31:42" },
  { id: "l7", level: "debug", source: "provider", message: "Switched coder → pavan-remote/claude-sonnet (context: 184k)", timestamp: "16:31:00" },
  { id: "l8", level: "error", source: "tester", message: "xUnit runner crashed on test 14/32, restarting", timestamp: "16:43:55" },
];

export const seedBuildSteps: BuildStep[] = [
  { id: "b1", label: "Restore dependencies", status: "success", duration: 4.2, log: "Restored 42 packages in 4.2s" },
  { id: "b2", label: "Static analysis (Roslyn)", status: "success", duration: 2.1, log: "5 diagnostics (1 error, 2 warnings)" },
  { id: "b3", label: "Compile solution", status: "success", duration: 11.8, log: "Build succeeded. 0 errors after auto-repair." },
  { id: "b4", label: "Generate tests", status: "running", log: "Probe generating xUnit cases..." },
  { id: "b5", label: "Execute unit tests", status: "pending" },
  { id: "b6", label: "Integration tests", status: "pending" },
  { id: "b7", label: "Package (MSIX)", status: "pending" },
  { id: "b8", label: "Sign & notarize", status: "pending" },
];

export const seedPlugins: Plugin[] = [
  { id: "p1", name: "GitHub Integration", description: "Issues, PRs, and Actions workflows", version: "2.4.1", author: "Pavan Labs", enabled: true, category: "integration", icon: "git-branch" },
  { id: "p2", name: "Docker Packager", description: "Containerize any project type", version: "1.8.0", author: "Pavan Labs", enabled: true, category: "tool", icon: "box" },
  { id: "p3", name: "Ollama Provider", description: "Run local models via Ollama", version: "0.9.2", author: "Community", enabled: true, category: "provider", icon: "cpu" },
  { id: "p4", name: "Filesystem MCP", description: "Sandboxed file operations server", version: "1.2.0", author: "Pavan Labs", enabled: true, category: "mcp", icon: "folder-tree" },
  { id: "p5", name: "Android Emulator Bridge", description: "Launch and control AVDs for live preview", version: "0.6.3", author: "Pavan Labs", enabled: false, category: "tool", icon: "smartphone" },
  { id: "p6", name: "WinUI 3 Template Pack", description: "Project and item templates for WinUI 3", version: "3.1.0", author: "Pavan Labs", enabled: true, category: "template", icon: "layout-template" },
  { id: "p7", name: "Sentry MCP", description: "Error monitoring and triage server", version: "0.4.1", author: "Community", enabled: false, category: "mcp", icon: "shield-alert" },
  { id: "p8", name: "PostgreSQL Provider", description: "Local PostgreSQL for development", version: "1.0.7", author: "Pavan Labs", enabled: true, category: "provider", icon: "database" },
];

export const seedProviders: ModelProvider[] = [
  {
    id: "prov-local",
    name: "Pavan Local Runtime",
    type: "local",
    status: "connected",
    endpoint: "http://127.0.0.1:11434",
    models: [
      { id: "qwen2.5-32b", name: "Qwen2.5 32B", context: "128k", capabilities: ["chat", "code", "tools"] },
      { id: "qwen2.5-14b", name: "Qwen2.5 14B", context: "128k", capabilities: ["chat", "code"] },
      { id: "deepseek-coder-v2", name: "DeepSeek Coder V2", context: "128k", capabilities: ["code"] },
    ],
  },
  {
    id: "prov-remote",
    name: "Pavan Remote Gateway",
    type: "remote",
    status: "connected",
    endpoint: "https://gateway.pavan.dev",
    models: [
      { id: "claude-sonnet", name: "Claude Sonnet 4.5", context: "200k", capabilities: ["chat", "code", "vision", "tools"] },
      { id: "gpt-4o", name: "GPT-4o", context: "128k", capabilities: ["chat", "vision", "tools"] },
      { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro", context: "1M", capabilities: ["chat", "vision", "tools"] },
    ],
  },
  {
    id: "prov-embedded",
    name: "Embedded Nano (offline)",
    type: "local",
    status: "disconnected",
    models: [
      { id: "phi-3.5-mini", name: "Phi-3.5 Mini", context: "32k", capabilities: ["chat"] },
    ],
  },
];

// Mock source files for the code editor view
export const fileContents: Record<string, string> = {
  "src/Invoicing/RecurringInvoiceService.cs": `using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Invoicing.Data;
using Invoicing.Domain;
using Microsoft.EntityFrameworkCore;

namespace Invoicing;

/// <summary>
/// Generates invoice instances from active recurring schedules.
/// Idempotent via (ScheduleId, PeriodStart) composite key.
/// </summary>
public sealed class RecurringInvoiceService
{
    private readonly AppDbContext _db;
    private readonly InvoiceGenerator _generator;

    public RecurringInvoiceService(AppDbContext db, InvoiceGenerator generator)
    {
        _db = db;
        _generator = generator;
    }

    public async Task<IReadOnlyList<Invoice>> RunForDateAsync(
        DateTime asOfUtc,
        CancellationToken ct = default)
    {
        var schedules = await _db.RecurringInvoices
            .Where(s => s.NextRunUtc <= asOfUtc && s.IsActive)
            .ToListAsync(ct);

        var generated = new List<Invoice>();

        foreach (var schedule in schedules)
        {
            var periodStart = schedule.EvaluatedPeriodStart(asOfUtc);

            // Idempotency guard: never regenerate the same period
            var exists = await _db.Invoices
                .AnyAsync(i => i.SourceScheduleId == schedule.Id
                            && i.PeriodStartUtc == periodStart, ct);
            if (exists)
            {
                schedule.AdvanceNextRun(asOfUtc);
                continue;
            }

            var invoice = _generator.FromSchedule(schedule, periodStart);
            _db.Invoices.Add(invoice);
            schedule.AdvanceNextRun(asOfUtc);
            generated.Add(invoice);
        }

        await _db.SaveChangesAsync(ct);
        return generated;
    }
}`,
  "src/Invoicing/InvoiceGenerator.cs": `using System;
using Invoicing.Domain;

namespace Invoicing;

public sealed class InvoiceGenerator
{
    private readonly ICurrencyConverter _currency;

    public InvoiceGenerator(ICurrencyConverter currency) => _currency = currency;

    public Invoice FromSchedule(RecurringInvoice schedule, DateTime periodStartUtc)
    {
        var total = schedule.Amount;
        if (schedule.Currency != schedule.Customer.BaseCurrency)
        {
            total = _currency.Convert(
                schedule.Amount,
                schedule.Currency,
                schedule.Customer.BaseCurrency,
                periodStartUtc);
        }

        return new Invoice
        {
            Id = Guid.NewGuid(),
            Number = InvoiceNumber.Next(),
            CustomerId = schedule.CustomerId,
            SourceScheduleId = schedule.Id,
            PeriodStartUtc = periodStartUtc,
            DueDateUtc = periodStartUtc.AddDays(schedule.PaymentTermsDays),
            Currency = schedule.Currency,
            Subtotal = total,
            Tax = total * schedule.TaxRate,
            Status = InvoiceStatus.Draft,
        };
    }

    public Invoice FromManual(DraftInvoice draft)
    {
        // TODO: implement manual invoice path
        throw new NotImplementedException();
    }
}`,
  "src/Invoicing/InvoiceRepository.cs": `using System;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Invoicing.Data;
using Invoicing.Domain;
using Microsoft.EntityFrameworkCore;

namespace Invoicing;

public sealed class InvoiceRepository
{
    private readonly AppDbContext _db;

    public InvoiceRepository(AppDbContext db) => _db = db;

    public Task<Invoice?> FindAsync(Guid id, CancellationToken ct = default) =>
        _db.Invoices.FirstOrDefaultAsync(i => i.Id == id, ct);

    public Task<List<Invoice>> ForCustomerAsync(Guid customerId, int limit = 50) =>
        _db.Invoices
            .Where(i => i.CustomerId == customerId)
            .OrderByDescending(i => i.IssuedUtc)
            .Take(limit)
            .ToListAsync();
}`,
  "tests/RecurringInvoiceServiceTests.cs": `using System;
using System.Threading;
using System.Threading.Tasks;
using Invoicing;
using Invoicing.Domain;
using Xunit;

namespace Invoicing.Tests;

public class RecurringInvoiceServiceTests
{
    [Fact]
    public async Task Does_not_regenerate_same_period_twice()
    {
        // Arrange
        var fixture = await Fixture.WithSchedule(monthly: true, nextRun: Jan1);
        var sut = fixture.GetService<RecurringInvoiceService>();

        // Act
        await sut.RunForDateAsync(Jan1, CancellationToken.None);
        await sut.RunForDateAsync(Jan1, CancellationToken.None); // idempotent

        // Assert
        var invoices = fixture.InvoicesForPeriod(Jan1);
        Assert.Single(invoices);
    }

    [Theory]
    [InlineData("2025-01-31", "2025-02-28")] // end-of-month February
    [InlineData("2025-03-31", "2025-04-30")] // end-of-month April
    public async Task End_of_month_schedules_clamp_correctly(string start, string expected)
    {
        var fixture = await Fixture.WithSchedule(eom: true, nextRun: DateTime.Parse(start));
        var sut = fixture.GetService<RecurringInvoiceService>();

        await sut.RunForDateAsync(DateTime.Parse(start).AddDays(1));

        var next = Assert.Single(fixture.Schedules).NextRunUtc;
        Assert.Equal(DateTime.Parse(expected), next.Date);
    }
}`,
  "docs/architecture.md": `# Invoicer Desktop — Architecture

## Overview
Invoicer Desktop is an offline-first WinUI 3 application targeting
net8.0-windows10.0.19041. It follows an MVVM pattern with a layered
domain model and a local SQLCipher-encrypted SQLite store.

## Layers
| Layer | Responsibility |
|-------|---------------|
| UI (WinUI 3) | XAML views + ViewModels |
| Application | Use-case orchestration, services |
| Domain | Entities, value objects, rules |
| Data | EF Core + SQLCipher persistence |

## Modules
- **Invoicing** — generation, recurrence, currency
- **Customers** — CRM-lite
- **Payments** — reconciliation
- **Dashboard** — analytics & charts
- **Sync** — queued background sync

## Persistence
SQLCipher (AES-256, PBKDF2 210k iterations). Migrations via EF Core.

## Idempotency
Scheduled operations keyed on (SourceScheduleId, PeriodStartUtc).
`,
  "README.md": `# Invoicer Desktop

A Windows-native invoicing application built with WinUI 3 and .NET 8.

## Features
- Offline-first with local encrypted storage
- Recurring invoices (monthly, end-of-month, weekly)
- Multi-currency with historical FX rates
- PDF export and email
- Analytics dashboard

## Built with Pavan Full Stack App Builder
This project was designed, implemented, tested, and packaged by the
Pavan autonomous orchestration engine.
`,
};
