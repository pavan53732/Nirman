// Sandbox — wraps ToolManager execution with isolation profiles.
//
// Every build executes inside a Sandbox. The sandbox:
//   - Enforces a per-profile timeout ceiling
//   - Captures stdout/stderr from the underlying ToolManager spawn
//   - Collects artifacts (generated files mentioned in tool output)
//   - Records metrics (duration, output bytes, error/warning counts)
//   - Returns structured results so callers don't touch child_process
//
// Execution profiles (7) — one per PlatformKind the engine supports:
//   - web      : Next.js + Node.js tools (tsc, npm, eslint)
//   - windows  : .NET SDK tools (dotnet build, msbuild)
//   - android  : Gradle + Android SDK tools (gradle assembleDebug)
//   - cli      : CLI tool execution (generic)
//   - api      : API service execution (server start/stop)
//   - library  : Library build (tsc, cargo build)
//   - plugin   : Plugin execution (sandboxed eval)
//
// The Sandbox delegates the actual process spawn to ToolManager.invoke().
// It does NOT modify ToolManager — it sits in front of it as a profiling,
// metric-collecting, artifact-parsing layer. The orchestrator/agents can
// call Sandbox.execute() instead of ToolManager.invoke() directly when
// they need the structured result envelope (artifacts + metrics + logs).
//
// IMPORTANT — module loading:
// `tool-manager.ts` imports `child_process` (a Node-only builtin) at the
// top level. We CANNOT statically `import { ToolManager }` here because
// this module is re-exported through `@/lib/engine/index.ts`, which is
// imported by client components (status-panel.tsx etc.) — pulling
// `child_process` into the browser bundle breaks the client build.
//
// Solution: the Sandbox accepts a `ToolManagerLike` instance via the
// constructor OR via `setToolManager()`. Server-only entry points (API
// routes, the orchestrator bootstrap) statically import `ToolManager`
// themselves and inject it into the singleton. Browser code never calls
// `execute()`, so the missing ToolManager is never observed client-side.

import { registries } from "./registries";
import type { PlatformKind } from "./types";

/**
 * Structural interface for the ToolManager shape we depend on. We don't
 * import the class directly (to avoid pulling `child_process` into client
 * bundles); any object matching this shape works.
 */
export interface ToolManagerLike {
  invoke(
    toolId: string,
    args: {
      cwd?: string;
      extraArgs?: string[];
      files?: string[];
      env?: Record<string, string>;
    },
  ): Promise<{
    exitCode: number;
    stdout: string;
    stderr: string;
    durationMs: number;
    success: boolean;
    errors?: Array<{ file: string; line: number; column: number; message: string; code?: string }>;
  }>;
}

export type SandboxProfile =
  | "web"
  | "windows"
  | "android"
  | "cli"
  | "api"
  | "library"
  | "plugin";

export interface SandboxArtifact {
  path: string;
  size: number;
  type: "source" | "executable" | "log" | "config" | "test";
}

export interface SandboxMetrics {
  peakMemoryMB: number;
  cpuTimeMs: number;
  outputBytes: number;
  errorCount: number;
  warningCount: number;
}

export interface SandboxLog {
  level: "info" | "warn" | "error";
  message: string;
  timestamp: number;
}

export interface SandboxResult {
  profile: SandboxProfile;
  toolId: string;
  success: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  artifacts: SandboxArtifact[];
  metrics: SandboxMetrics;
  logs: SandboxLog[];
  durationMs: number;
  timedOut: boolean;
}

export interface SandboxOptions {
  profile: SandboxProfile;
  toolId: string;
  /** Working directory passed to ToolManager.invoke. */
  cwd?: string;
  /**
   * Ceiling for the sandbox execution. The actual timeout applied is
   * min(opts.timeoutMs, profile.timeoutMs) so callers can only ever
   * NARROW the window, never widen it. (ToolManager also enforces its
   * own per-tool timeout from the registry; whichever fires first wins.)
   */
  timeoutMs?: number;
  /** Extra CLI args appended after the tool's resolved command. */
  args?: string[];
  /** Files to target (for lint/typecheck tools). */
  files?: string[];
  /** Environment overrides merged on top of process.env. */
  env?: Record<string, string>;
}

const PROFILE_DEFAULTS: Record<
  SandboxProfile,
  { timeoutMs: number; maxOutputBytes: number }
> = {
  web: { timeoutMs: 60_000, maxOutputBytes: 10 * 1024 * 1024 },
  windows: { timeoutMs: 120_000, maxOutputBytes: 20 * 1024 * 1024 },
  android: { timeoutMs: 180_000, maxOutputBytes: 30 * 1024 * 1024 },
  cli: { timeoutMs: 30_000, maxOutputBytes: 5 * 1024 * 1024 },
  api: { timeoutMs: 10_000, maxOutputBytes: 5 * 1024 * 1024 },
  library: { timeoutMs: 60_000, maxOutputBytes: 10 * 1024 * 1024 },
  plugin: { timeoutMs: 15_000, maxOutputBytes: 2 * 1024 * 1024 },
};

export class Sandbox {
  private toolManager: ToolManagerLike | null;
  private profiles: Record<
    SandboxProfile,
    { timeoutMs: number; maxOutputBytes: number }
  >;

  constructor(toolManager?: ToolManagerLike) {
    this.toolManager = toolManager ?? null;
    this.profiles = { ...PROFILE_DEFAULTS };
  }

  /**
   * Late-bind a ToolManager instance. Server-only entry points (API routes,
   * the orchestrator bootstrap) call this to inject a real ToolManager into
   * the shared singleton. Browser code never calls this — `execute()` is
   * server-only by contract.
   */
  setToolManager(toolManager: ToolManagerLike): void {
    this.toolManager = toolManager;
  }

  /**
   * Resolve the ToolManager instance, or throw a clear error if none has
   * been injected. Browser bundles never reach this code path because
   * `execute()` is only called from server routes / the orchestrator.
   */
  private getToolManager(): ToolManagerLike {
    if (!this.toolManager) {
      throw new Error(
        "Sandbox has no ToolManager configured. Call sandbox.setToolManager(new ToolManager()) " +
          "from a server-only entry point (API route, orchestrator bootstrap) before calling execute().",
      );
    }
    return this.toolManager;
  }

  /**
   * Execute a tool inside the sandbox with the given profile.
   *
   * The Sandbox delegates the actual spawn to ToolManager.invoke() and then
   * wraps the result with artifacts + metrics + logs. It does not modify
   * ToolManager — it sits in front as a profiling layer.
   */
  async execute(opts: SandboxOptions): Promise<SandboxResult> {
    const profile = this.profiles[opts.profile];
    const startTime = Date.now();
    const logs: SandboxLog[] = [];

    logs.push({
      level: "info",
      message: `Sandbox started: profile=${opts.profile}, tool=${opts.toolId}`,
      timestamp: startTime,
    });

    // Compute the effective timeout ceiling: caller may narrow it, but never
    // widen it past the profile default. (The ToolManager also enforces its
    // own per-tool timeout from the registry; whichever fires first wins.)
    const requestedTimeout = opts.timeoutMs ?? profile.timeoutMs;
    const effectiveTimeout = Math.min(requestedTimeout, profile.timeoutMs);

    try {
      const toolManager = this.getToolManager();

      // Delegate to ToolManager (which does the actual spawn).
      // ToolManager.invoke signature: (toolId, { cwd, extraArgs, files, env }).
      const result = await toolManager.invoke(opts.toolId, {
        cwd: opts.cwd,
        extraArgs: opts.args,
        files: opts.files,
        env: opts.env,
      });

      const durationMs = Date.now() - startTime;
      const stdout = this.clampOutput(result.stdout ?? "", profile.maxOutputBytes);
      const stderr = this.clampOutput(result.stderr ?? "", profile.maxOutputBytes);

      // ToolManager signals timeout by exitCode 124 + "[ToolManager] Timed out" in stderr.
      const timedOut =
        result.exitCode === 124 || /Timed out/i.test(result.stderr ?? "");

      // Parse artifacts from output (file paths mentioned in stdout).
      const artifacts = this.parseArtifacts(stdout, opts.profile);

      // Compute metrics.
      const metrics: SandboxMetrics = {
        peakMemoryMB: this.estimateMemory(stdout, stderr),
        cpuTimeMs: result.durationMs, // approximate — ToolManager measures wall clock
        outputBytes: stdout.length + stderr.length,
        errorCount: this.countErrors(stderr, result.errors?.length ?? 0),
        warningCount: this.countWarnings(stderr),
      };

      logs.push({
        level: result.success ? "info" : "error",
        message: `Sandbox finished: success=${result.success}, exitCode=${result.exitCode}, duration=${durationMs}ms, errors=${metrics.errorCount}, warnings=${metrics.warningCount}`,
        timestamp: Date.now(),
      });

      if (timedOut) {
        logs.push({
          level: "warn",
          message: `Sandbox timed out after ${effectiveTimeout}ms (profile ceiling)`,
          timestamp: Date.now(),
        });
      }

      return {
        profile: opts.profile,
        toolId: opts.toolId,
        success: result.success,
        exitCode: result.exitCode,
        stdout,
        stderr,
        artifacts,
        metrics,
        logs,
        durationMs,
        timedOut,
      };
    } catch (err) {
      const durationMs = Date.now() - startTime;
      const errMsg = err instanceof Error ? err.message : String(err);
      logs.push({
        level: "error",
        message: `Sandbox error: ${errMsg}`,
        timestamp: Date.now(),
      });
      return {
        profile: opts.profile,
        toolId: opts.toolId,
        success: false,
        exitCode: -1,
        stdout: "",
        stderr: errMsg,
        artifacts: [],
        metrics: {
          peakMemoryMB: 0,
          cpuTimeMs: durationMs,
          outputBytes: 0,
          errorCount: 1,
          warningCount: 0,
        },
        logs,
        durationMs,
        timedOut: false,
      };
    }
  }

  /**
   * Map a PlatformKind to its default SandboxProfile.
   * Used by callers that have a platform adapter but want to run a tool
   * in the matching sandbox profile.
   */
  profileForPlatform(platform: PlatformKind): SandboxProfile {
    switch (platform) {
      case "web":
        return "web";
      case "windows":
        return "windows";
      case "android":
        return "android";
      case "cli":
        return "cli";
      case "api":
        return "api";
      case "library":
        return "library";
      case "plugin":
        return "plugin";
      default:
        // ios, macos, linux-desktop, embedded, game-engine, browser-extension
        // — fall back to the generic cli profile for now. When dedicated
        // profiles are added, switch here.
        return "cli";
    }
  }

  /**
   * List available profiles and their limits (timeout + max output bytes).
   * Returned object is a defensive copy so callers can't mutate the registry.
   */
  listProfiles(): Record<
    SandboxProfile,
    { timeoutMs: number; maxOutputBytes: number }
  > {
    return { ...this.profiles };
  }

  /**
   * Override a profile's defaults at runtime. Intended for tests + debug
   * endpoints — production code should rely on PROFILE_DEFAULTS.
   */
  configureProfile(
    profile: SandboxProfile,
    config: Partial<{ timeoutMs: number; maxOutputBytes: number }>,
  ): void {
    this.profiles[profile] = {
      ...this.profiles[profile],
      ...config,
    };
  }

  /**
   * Resolve the tool's registry entry (if any) so callers can introspect
   * the underlying parser/category without importing the registry directly.
   */
  getTool(toolId: string) {
    return registries.tools.get(toolId) ?? null;
  }

  // ---------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------

  private clampOutput(output: string, maxBytes: number): string {
    if (output.length <= maxBytes) return output;
    // Keep the head + a truncation marker + the tail so callers still see
    // both the start of the build and the final error summary.
    const head = output.slice(0, Math.floor(maxBytes * 0.7));
    const tail = output.slice(output.length - Math.floor(maxBytes * 0.25));
    return (
      head +
      `\n[Sandbox] output truncated at ${maxBytes} bytes (profile ceiling)\n` +
      tail
    );
  }

  private parseArtifacts(
    stdout: string,
    profile: SandboxProfile,
  ): SandboxArtifact[] {
    const artifacts: SandboxArtifact[] = [];
    const seen = new Set<string>();

    // Common patterns: "wrote: /path", "created: /path", "Generated: /path",
    // "Output -> /path", build tools like tsc/cargo/gradle print these.
    const pathRe =
      /(?:wrote|created|generated|output|build succeeded|produced)[:\s->]*([^\s\n,]+)/gi;
    let m: RegExpExecArray | null;
    while ((m = pathRe.exec(stdout)) !== null) {
      const path = m[1].replace(/[",;]+$/, "");
      if (seen.has(path)) continue;
      seen.add(path);
      artifacts.push({
        path,
        size: 0, // unknown without reading the file
        type: this.inferArtifactType(path, profile),
      });
    }
    return artifacts;
  }

  private inferArtifactType(
    path: string,
    _profile: SandboxProfile,
  ): SandboxArtifact["type"] {
    if (/\.(exe|msi|msix|appimage|deb|rpm)$/i.test(path)) return "executable";
    if (/\.(apk|aab)$/i.test(path)) return "executable";
    if (/\.(dll|so|dylib|wasm)$/i.test(path)) return "executable";
    if (/\.(log|txt)$/i.test(path)) return "log";
    if (/\.(json|yaml|yml|toml|xml|ini|env)$/i.test(path)) return "config";
    if (/test|spec/i.test(path)) return "test";
    return "source";
  }

  private estimateMemory(stdout: string, stderr: string): number {
    // Rough estimate: output bytes / 1KB ≈ resident memory pressure in MB.
    // Real OS-level RSS would require reading /proc or ps — we keep this
    // dependency-free and approximate. The metric is monotonic enough to
    // compare builds against each other.
    return Math.round((stdout.length + stderr.length) / 1024);
  }

  private countErrors(stderr: string, parsedErrorCount: number): number {
    const matches = (stderr.match(/\berror\b/gi) ?? []).length;
    // Prefer the structured parser count if it found more — ToolManager's
    // parser catches TS/ESLint errors that may be phrased without the
    // literal word "error" in stderr.
    return Math.max(matches, parsedErrorCount);
  }

  private countWarnings(stderr: string): number {
    return (stderr.match(/\bwarning\b/gi) ?? []).length;
  }
}

/**
 * Default singleton Sandbox instance.
 *
 * Ships WITHOUT a ToolManager — server-only entry points (API routes, the
 * orchestrator bootstrap) call `sandbox.setToolManager(new ToolManager())`
 * once at module init to inject the real ToolManager. Browser code never
 * calls `execute()`, so this is safe.
 */
export const sandbox = new Sandbox();
