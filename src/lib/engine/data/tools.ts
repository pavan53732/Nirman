import type { Tool } from "../types";

// Tool Registry — execution only. Sandboxed with timeout + structured parser.
export const tools: Tool[] = [
  { id: "dotnet-build", name: "dotnet build", category: "Build", description: "Compile .NET solutions and projects.", timeoutMs: 120000, parser: "dotnet-build" },
  { id: "dotnet-test", name: "dotnet test", category: "Test", description: "Run .NET unit and integration tests.", timeoutMs: 180000, parser: "generic" },
  { id: "dotnet-publish", name: "dotnet publish", category: "Publish", description: "Produce ready-to-run .NET output.", timeoutMs: 120000, parser: "generic" },
  { id: "msbuild", name: "MSBuild", category: "Build", description: "Build Visual Studio solutions.", timeoutMs: 180000, parser: "dotnet-build" },
  { id: "wix", name: "WiX Toolset", category: "Packaging", description: "Author Windows MSI installers.", timeoutMs: 120000, parser: "generic" },
  { id: "tauri-bundler", name: "Tauri Bundler", category: "Packaging", description: "Produce NSIS .exe + MSI via Tauri.", timeoutMs: 180000, parser: "generic" },
  { id: "gradle-assemble", name: "gradlew assembleRelease", category: "Build", description: "Assemble Android release APK/AAB.", timeoutMs: 240000, parser: "gradle" },
  { id: "npm-build", name: "npm build", category: "Build", description: "Bundle JS/TS web apps.", timeoutMs: 120000, parser: "npm" },
  { id: "cargo-build", name: "cargo build", category: "Build", description: "Compile Rust workspaces.", timeoutMs: 240000, parser: "cargo" },
  { id: "eslint", name: "ESLint", category: "Static Analysis", description: "Lint JS/TS sources.", timeoutMs: 60000, parser: "eslint" },
  { id: "roslyn-analyzers", name: "Roslyn Analyzers", category: "Static Analysis", description: "C# static analysis and diagnostics.", timeoutMs: 60000, parser: "roslyn" },
  { id: "detekt", name: "detekt", category: "Static Analysis", description: "Kotlin static analysis.", timeoutMs: 60000, parser: "generic" },
  { id: "fs-read", name: "fs.read", category: "Filesystem", description: "Read a file from the workspace.", timeoutMs: 5000, parser: "generic" },
  { id: "fs-write", name: "fs.write", category: "Filesystem", description: "Write a file to the workspace/export path.", timeoutMs: 10000, parser: "generic" },
  { id: "zip", name: "zip", category: "Packaging", description: "Create a zip archive of files/folders.", timeoutMs: 60000, parser: "generic" },
  { id: "code-sign", name: "code-sign", category: "Packaging", description: "Sign installers and packages.", timeoutMs: 60000, parser: "generic" },
];
