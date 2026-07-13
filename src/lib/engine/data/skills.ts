import type { Skill } from "../types";

// Skill Registry — AI reasoning only. Expanded with Export, Capability
// Detection, and Workspace Intelligence per the final architecture spec.
export const skills: Skill[] = [
  // Requirements
  { id: "req-analysis", name: "Requirement Analysis", category: "Requirements", agent: "requirements-analyst", description: "Parse natural-language specs into structured requirements." },
  { id: "req-ambiguity", name: "Ambiguity Detection", category: "Requirements", agent: "requirements-analyst", description: "Flag underspecified or contradictory requirements." },
  { id: "req-decomposition", name: "Feature Decomposition", category: "Requirements", agent: "planner", description: "Break features into buildable units of work." },
  { id: "req-stories", name: "User Story Generation", category: "Requirements", agent: "business-analyst", description: "Produce acceptance-criteria-driven user stories." },
  // Architecture
  { id: "arch-system", name: "System Design", category: "Architecture", agent: "solution-architect", description: "Design end-to-end system structure and topology." },
  { id: "arch-modules", name: "Module Decomposition", category: "Architecture", agent: "software-architect", description: "Define module boundaries and responsibilities." },
  { id: "arch-deps", name: "Dependency Analysis", category: "Architecture", agent: "software-architect", description: "Map and validate inter-module dependencies." },
  { id: "arch-patterns", name: "Design Patterns", category: "Architecture", agent: "software-architect", description: "Apply MVVM, CQRS, repo, and other patterns." },
  { id: "arch-multi-target", name: "Multi-target Architecture", category: "Architecture", agent: "platform-architect", description: "Coordinate shared + target-specific layers across platforms." },
  // Project Generation
  { id: "gen-scaffold", name: "Scaffolding", category: "Project Generation", agent: "frontend-generator", description: "Generate project skeletons from templates." },
  { id: "gen-solution", name: "Solution Generation", category: "Project Generation", agent: "build-engineer", description: "Produce multi-project solutions and workspaces." },
  { id: "gen-templates", name: "Project Templates", category: "Project Generation", agent: "frontend-generator", description: "Use and maintain project/item templates." },
  { id: "gen-config", name: "Configuration", category: "Project Generation", agent: "build-engineer", description: "Emit build configs, env, and manifests." },
  // Frontend
  { id: "fe-react", name: "React", category: "Frontend", agent: "frontend-generator", description: "Component architecture, hooks, state." },
  { id: "fe-nextjs", name: "Next.js", category: "Frontend", agent: "frontend-generator", description: "App Router, RSC, server actions." },
  { id: "fe-vue", name: "Vue", category: "Frontend", agent: "frontend-generator", description: "Composition API, Pinia, Nuxt." },
  { id: "fe-angular", name: "Angular", category: "Frontend", agent: "frontend-generator", description: "Modules, RxJS, standalone components." },
  { id: "fe-svelte", name: "Svelte", category: "Frontend", agent: "frontend-generator", description: "SvelteKit, stores, transitions." },
  { id: "fe-htmlcss", name: "HTML / CSS", category: "Frontend", agent: "frontend-generator", description: "Semantic markup and modern CSS." },
  { id: "fe-tailwind", name: "Tailwind + shadcn/ui", category: "Frontend", agent: "frontend-generator", description: "Utility-first styling and accessible components." },
  // Windows Desktop
  { id: "win-winui3", name: "WinUI 3", category: "Windows Desktop", agent: "desktop-generator", description: "Modern native Windows UI with WinAppSDK." },
  { id: "win-wpf", name: "WPF", category: "Windows Desktop", agent: "desktop-generator", description: "XAML + MVVM desktop applications." },
  { id: "win-winforms", name: "WinForms", category: "Windows Desktop", agent: "desktop-generator", description: "Rapid LOB Windows applications." },
  { id: "win-avalonia", name: "Avalonia", category: "Windows Desktop", agent: "desktop-generator", description: "Cross-platform XAML desktop apps." },
  { id: "win-tauri", name: "Tauri", category: "Windows Desktop", agent: "desktop-generator", description: "Rust core + webview desktop apps." },
  { id: "win-electron", name: "Electron", category: "Windows Desktop", agent: "desktop-generator", description: "Node.js + Chromium desktop apps." },
  { id: "win-win32", name: "Win32 / C++", category: "Windows Desktop", agent: "desktop-generator", description: "Native Win32, COM, modern C++ desktop." },
  // Android
  { id: "and-kotlin", name: "Kotlin", category: "Android", agent: "android-generator", description: "Coroutines, flows, idiomatic Kotlin." },
  { id: "and-compose", name: "Jetpack Compose", category: "Android", agent: "android-generator", description: "Declarative Android UI toolkit." },
  { id: "and-flutter", name: "Flutter", category: "Android", agent: "android-generator", description: "Dart + Flutter cross-platform UI." },
  { id: "and-rn", name: "React Native", category: "Android", agent: "android-generator", description: "JS-driven native mobile apps." },
  // Backend
  { id: "be-aspnet", name: "ASP.NET Core", category: "Backend", agent: "backend-generator", description: "Minimal APIs, DI, middleware, EF Core." },
  { id: "be-node", name: "Node.js", category: "Backend", agent: "backend-generator", description: "Runtime, streams, worker threads." },
  { id: "be-nestjs", name: "NestJS", category: "Backend", agent: "backend-generator", description: "Opinionated Node framework with DI." },
  { id: "be-fastapi", name: "FastAPI", category: "Backend", agent: "backend-generator", description: "Async Python APIs with type safety." },
  { id: "be-spring", name: "Spring Boot", category: "Backend", agent: "backend-generator", description: "Java/Kotlin enterprise backend." },
  // Database
  { id: "db-sqlite", name: "SQLite", category: "Database", agent: "database-generator", description: "Embedded relational storage (SQLCipher aware)." },
  { id: "db-postgres", name: "PostgreSQL", category: "Database", agent: "database-generator", description: "Advanced relational database." },
  { id: "db-mysql", name: "MySQL", category: "Database", agent: "database-generator", description: "Popular relational database." },
  { id: "db-sqlserver", name: "SQL Server", category: "Database", agent: "database-generator", description: "Microsoft relational database." },
  { id: "db-mongo", name: "MongoDB", category: "Database", agent: "database-generator", description: "Document-oriented NoSQL." },
  { id: "db-redis", name: "Redis", category: "Database", agent: "database-generator", description: "In-memory cache and streams." },
  // AI
  { id: "ai-llm", name: "LLM Integration", category: "AI", agent: "ai-generator", description: "Wire chat/completion APIs with streaming." },
  { id: "ai-rag", name: "RAG", category: "AI", agent: "ai-generator", description: "Retrieval-augmented generation pipelines." },
  { id: "ai-embeddings", name: "Embeddings", category: "AI", agent: "ai-generator", description: "Vector embeddings and similarity search." },
  { id: "ai-vector", name: "Vector Databases", category: "AI", agent: "ai-generator", description: "pgvector, Qdrant, Chroma integration." },
  { id: "ai-agent-flow", name: "Agent Orchestration", category: "AI", agent: "ai-generator", description: "Multi-step agent loops and tool use." },
  // API
  { id: "api-rest", name: "REST", category: "API", agent: "api-architect", description: "Resource-oriented HTTP APIs." },
  { id: "api-graphql", name: "GraphQL", category: "API", agent: "api-architect", description: "Schema-driven query APIs." },
  { id: "api-grpc", name: "gRPC", category: "API", agent: "api-architect", description: "Typed high-performance RPC." },
  { id: "api-ws", name: "WebSockets", category: "API", agent: "api-architect", description: "Real-time bidirectional communication." },
  { id: "api-openapi", name: "OpenAPI", category: "API", agent: "api-architect", description: "Spec + client generation." },
  // Build & Packaging
  { id: "pkg-msbuild", name: "MSBuild", category: "Build & Packaging", agent: "build-engineer", description: ".NET solution builds and props.", usesTools: ["dotnet-build"] },
  { id: "pkg-gradle", name: "Gradle", category: "Build & Packaging", agent: "build-engineer", description: "Android/JVM builds and variants.", usesTools: ["gradle-assemble"] },
  { id: "pkg-cargo", name: "Cargo", category: "Build & Packaging", agent: "build-engineer", description: "Rust workspace builds and releases.", usesTools: ["cargo-build"] },
  { id: "pkg-npm", name: "npm / Bun", category: "Build & Packaging", agent: "build-engineer", description: "JS package management and bundling.", usesTools: ["npm-build"] },
  { id: "pkg-wix", name: "WiX Toolset", category: "Build & Packaging", agent: "packaging-engineer", description: "Windows MSI installers.", usesTools: ["wix"] },
  { id: "pkg-msix", name: "MSIX", category: "Build & Packaging", agent: "packaging-engineer", description: "Modern Windows app packaging." },
  { id: "pkg-apk", name: "APK / AAB", category: "Build & Packaging", agent: "packaging-engineer", description: "Android installable bundles." },
  { id: "pkg-tauri-bundle", name: "Tauri Bundler", category: "Build & Packaging", agent: "packaging-engineer", description: "NSIS .exe + MSI via Tauri.", usesTools: ["tauri-bundler"] },
  { id: "pkg-installers", name: "Installers", category: "Build & Packaging", agent: "installer-specialist", description: "Cross-platform installer generation." },
  // Testing
  { id: "test-unit", name: "Unit Testing", category: "Testing", agent: "unit-test-agent", description: "xUnit, Jest, pytest, JUnit cases." },
  { id: "test-integration", name: "Integration Testing", category: "Testing", agent: "integration-test-agent", description: "Cross-module and API integration tests." },
  { id: "test-ui", name: "UI Testing", category: "Testing", agent: "ui-test-agent", description: "Playwright, Appium, WinAppDriver." },
  { id: "test-perf", name: "Performance Testing", category: "Testing", agent: "performance-optimizer", description: "Load and soak testing." },
  { id: "test-regression", name: "Regression Testing", category: "Testing", agent: "integration-test-agent", description: "Guard against regressions across changes." },
  // Security
  { id: "sec-auth", name: "Authentication", category: "Security", agent: "security-architect", description: "OAuth, OIDC, session, MFA." },
  { id: "sec-authz", name: "Authorization", category: "Security", agent: "security-architect", description: "RBAC/ABAC and policy enforcement." },
  { id: "sec-encryption", name: "Encryption", category: "Security", agent: "security-architect", description: "At-rest and in-transit crypto choices." },
  { id: "sec-secure-coding", name: "Secure Coding", category: "Security", agent: "security-auditor", description: "OWASP-aligned input validation & secrets." },
  { id: "sec-deps", name: "Dependency Auditing", category: "Security", agent: "dependency-auditor", description: "Scan advisories and licenses." },
  // Debugging
  { id: "dbg-build", name: "Build Failures", category: "Debugging", agent: "build-engineer", description: "Diagnose and repair compile errors." },
  { id: "dbg-runtime", name: "Runtime Errors", category: "Debugging", agent: "code-reviewer", description: "Trace and fix exceptions and panics." },
  { id: "dbg-logs", name: "Log Analysis", category: "Debugging", agent: "code-reviewer", description: "Correlate logs to root causes." },
  { id: "dbg-rca", name: "Root-Cause Analysis", category: "Debugging", agent: "code-reviewer", description: "Bisect failures to the offending change." },
  // Performance
  { id: "perf-profile", name: "Profiling", category: "Performance", agent: "performance-optimizer", description: "CPU, allocation, and IO profiling." },
  { id: "perf-optimize", name: "Optimization", category: "Performance", agent: "performance-optimizer", description: "Hot-path and algorithmic improvements." },
  { id: "perf-memory", name: "Memory Analysis", category: "Performance", agent: "memory-optimizer", description: "Leak detection and heap analysis." },
  // DevOps
  { id: "ops-cicd", name: "CI/CD", category: "DevOps", agent: "release-engineer", description: "GitHub Actions / Azure Pipelines workflows." },
  { id: "ops-docker", name: "Docker", category: "DevOps", agent: "release-engineer", description: "Container images and compose." },
  { id: "ops-pipelines", name: "Deployment Pipelines", category: "DevOps", agent: "release-engineer", description: "Promote artifacts across environments." },
  { id: "ops-release", name: "Release Automation", category: "DevOps", agent: "release-engineer", description: "Version, tag, and publish releases." },
  // Documentation
  { id: "doc-readme", name: "README", category: "Documentation", agent: "documentation-writer", description: "Project overviews and quickstarts." },
  { id: "doc-api", name: "API Docs", category: "Documentation", agent: "documentation-writer", description: "Reference docs from specs and code." },
  { id: "doc-arch", name: "Architecture Docs", category: "Documentation", agent: "documentation-writer", description: "Diagrams, ADRs, and module docs." },
  { id: "doc-guide", name: "User Guides", category: "Documentation", agent: "documentation-writer", description: "End-user documentation and onboarding." },
  // Git
  { id: "git-commit", name: "Commit Planning", category: "Git", agent: "code-reviewer", description: "Structure logical, reviewable commits." },
  { id: "git-branch", name: "Branching", category: "Git", agent: "code-reviewer", description: "Branch strategy and naming." },
  { id: "git-merge", name: "Merge Conflict Resolution", category: "Git", agent: "code-reviewer", description: "Resolve conflicts preserving intent." },
  { id: "git-review", name: "Code Review", category: "Git", agent: "code-reviewer", description: "Review diffs for quality and correctness." },
  // UX
  { id: "ux-ui-gen", name: "UI Generation", category: "UX", agent: "uiux-architect", description: "Generate layouts from intent." },
  { id: "ux-a11y", name: "Accessibility", category: "UX", agent: "accessibility-auditor", description: "WCAG, ARIA, keyboard, and contrast." },
  { id: "ux-responsive", name: "Responsive Layouts", category: "UX", agent: "uiux-architect", description: "Mobile-first adaptive UI." },
  { id: "ux-design-system", name: "Design Systems", category: "UX", agent: "uiux-architect", description: "Tokens, themes, component libraries." },
  // Live Preview
  { id: "pv-web", name: "Web Preview", category: "Live Preview", agent: "build-engineer", description: "Live web preview with hot reload." },
  { id: "pv-windows", name: "Windows Preview", category: "Live Preview", agent: "build-engineer", description: "Live Windows desktop preview." },
  { id: "pv-android", name: "Android Preview", category: "Live Preview", agent: "build-engineer", description: "Emulator/device preview integration." },
  { id: "pv-hotreload", name: "Hot Reload", category: "Live Preview", agent: "build-engineer", description: "Instant feedback on edits." },
  { id: "pv-inspector", name: "UI Inspector", category: "Live Preview", agent: "uiux-architect", description: "Inspect and tweak rendered UI." },
  // Quality
  { id: "q-refactor", name: "Refactoring", category: "Quality", agent: "refactoring-agent", description: "Safe, behavior-preserving refactors." },
  { id: "q-static", name: "Static Analysis", category: "Quality", agent: "static-analyzer", description: "Roslyn, ESLint, Clippy, Detekt.", usesTools: ["roslyn-analyzers", "eslint"] },
  { id: "q-lint", name: "Linting", category: "Quality", agent: "static-analyzer", description: "Style and convention enforcement." },
  { id: "q-debt", name: "Technical Debt Reduction", category: "Quality", agent: "refactoring-agent", description: "Identify and pay down debt." },
  // Export (new)
  { id: "export-folder", name: "Export to Folder", category: "Export", agent: "export-manager", description: "Copy the complete versioned solution to a local path.", usesTools: ["fs-write", "zip"] },
  { id: "export-validate-path", name: "Path Validation", category: "Export", agent: "export-manager", description: "Validate the chosen export path is writable and well-formed." },
  { id: "export-bundle", name: "Solution Bundling", category: "Export", agent: "export-manager", description: "Assemble /backend /desktop /android /web-admin /docs /artifacts + DecisionLog.json." },
  // Capability Detection (new)
  { id: "cap-detect", name: "Capability Detection", category: "Capability Detection", agent: "decision-engine", description: "Infer required capabilities (GPU, Bluetooth, Camera, Offline Sync) from requirements." },
  { id: "cap-adapter-match", name: "Adapter Matching", category: "Capability Detection", agent: "decision-engine", description: "Match detected capabilities to platform adapters." },
  // Workspace Intelligence (new)
  { id: "ws-symbol-index", name: "Symbol Index", category: "Workspace Intelligence", agent: "knowledge-base-manager", description: "Index symbols for fast navigation." },
  { id: "ws-xref", name: "Cross-Reference Index", category: "Workspace Intelligence", agent: "knowledge-base-manager", description: "Index references between symbols." },
  { id: "ws-type-index", name: "Type Index", category: "Workspace Intelligence", agent: "knowledge-base-manager", description: "Index types and members." },
  { id: "ws-file-index", name: "File Index", category: "Workspace Intelligence", agent: "knowledge-base-manager", description: "Index files and their roles." },
  { id: "ws-api-index", name: "API Index", category: "Workspace Intelligence", agent: "knowledge-base-manager", description: "Index public API surface." },
  { id: "ws-dep-index", name: "Dependency Index", category: "Workspace Intelligence", agent: "knowledge-base-manager", description: "Track internal and external dependencies." },
  { id: "ws-semantic", name: "Semantic Index", category: "Workspace Intelligence", agent: "knowledge-base-manager", description: "Embedding-based semantic search index." },
  { id: "ws-code-graph", name: "Code Graph", category: "Workspace Intelligence", agent: "knowledge-base-manager", description: "Graph of code relationships." },
  { id: "ws-arch-graph", name: "Architecture Graph", category: "Workspace Intelligence", agent: "knowledge-base-manager", description: "Graph of architecture decisions and modules." },
];
