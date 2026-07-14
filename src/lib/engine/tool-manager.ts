// Real ToolManager — executes actual toolchain commands server-side.
// This is the bridge between the orchestration engine and real compilers/linters.
//
// Runs ONLY on the server (Node.js) via child_process.spawn. The browser-side
// execution engine calls this through the /api/tools API route.
// For Tauri production builds, the same interface would use @tauri-apps/api/shell
// Command — but for the web dev path we use child_process here.

import { spawn } from "child_process";
import type { Tool } from "./types";
import { registries } from "./registries";

export interface ToolInvocationResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  success: boolean;
  /** Parsed structured errors (for self-healing). */
  errors?: ToolError[];
}

export interface ToolError {
  file: string;
  line: number;
  column: number;
  message: string;
  code?: string;
}

export interface ToolInvocationArgs {
  /** Working directory for the command. */
  cwd?: string;
  /** Extra arguments appended to the tool's default command. */
  extraArgs?: string[];
  /** Files to target (for lint/typecheck). */
  files?: string[];
  /** Environment overrides. */
  env?: Record<string, string>;
}

/** Resolve a binary name to a real command + args for the platform. */
function resolveCommand(
  toolId: string,
  args: ToolInvocationArgs
): { command: string; cmdArgs: string[] } | null {
  const tool = registries.tools.get(toolId);
  if (!tool) return null;

  const cwd = args.cwd ?? process.cwd();

  switch (toolId) {
    case "npm-build":
      return { command: "npm", cmdArgs: ["run", "build", "--prefix", cwd] };
    case "tsc-no-emit":
      // Not in the registry as a separate tool, but supported as an alias
      return { command: "npx", cmdArgs: ["--yes", "typescript", "tsc", "--noEmit", "-p", cwd] };
    case "eslint":
      return {
        command: "npx",
        cmdArgs: ["--yes", "eslint", ...(args.files ?? ["."]), "--cwd", cwd],
      };
    case "dotnet-build":
      return { command: "dotnet", cmdArgs: ["build", cwd] };
    case "dotnet-test":
      return { command: "dotnet", cmdArgs: ["test", cwd] };
    case "cargo-build":
      return { command: "cargo", cmdArgs: ["build", "--manifest-path", `${cwd}/Cargo.toml`] };
    case "gradle-assemble":
      return {
        command: process.platform === "win32" ? "gradlew.bat" : "./gradlew",
        cmdArgs: ["assembleDebug", "-p", cwd],
      };
    default:
      return null;
  }
}

/** Parse compiler/linter output into structured errors. */
function parseErrors(stdout: string, stderr: string, toolId: string): ToolError[] {
  const errors: ToolError[] = [];
  const output = stdout + "\n" + stderr;
  // TypeScript: file(line,col): error TSxxxx: message
  const tsRe = /([^\s(]+)\((\d+),(\d+)\):\s*(error|warning)\s+(TS\d+):\s*(.+)/g;
  let m: RegExpExecArray | null;
  while ((m = tsRe.exec(output)) !== null) {
    errors.push({
      file: m[1],
      line: parseInt(m[2], 10),
      column: parseInt(m[3], 10),
      message: m[6],
      code: m[5],
    });
  }
  // ESLint: file:line:column: message
  const eslintRe = /([^\s:]+):(\d+):(\d+):\s*(.+)/g;
  while ((m = eslintRe.exec(output)) !== null) {
    const file = m[1];
    const line = parseInt(m[2], 10);
    if (!errors.some((e) => e.file === file && e.line === line)) {
      errors.push({
        file,
        line,
        column: parseInt(m[3], 10),
        message: m[4],
      });
    }
  }
  return errors;
}

export class ToolManager {
  /**
   * Invoke a registered tool with real process execution.
   * Captures stdout/stderr, enforces the tool's timeout, and parses errors.
   */
  async invoke(
    toolId: string,
    args: ToolInvocationArgs = {}
  ): Promise<ToolInvocationResult> {
    const resolved = resolveCommand(toolId, args);
    if (!resolved) {
      return {
        exitCode: -1,
        stdout: "",
        stderr: `Tool '${toolId}' is not executable (no command resolved).`,
        durationMs: 0,
        success: false,
      };
    }

    const tool = registries.tools.get(toolId);
    const timeoutMs = tool?.timeoutMs ?? 60000;
    const startedAt = Date.now();

    return new Promise<ToolInvocationResult>((resolve) => {
      const env = { ...process.env, ...args.env };
      const child = spawn(resolved.command, resolved.cmdArgs, {
        env,
        shell: process.platform === "win32", // needed for npx/gradlew on Windows
        cwd: args.cwd ?? process.cwd(),
      });

      let stdout = "";
      let stderr = "";
      let timedOut = false;

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
        setTimeout(() => child.kill("SIGKILL"), 2000);
      }, timeoutMs);

      child.stdout?.on("data", (data: Buffer) => {
        stdout += data.toString();
      });
      child.stderr?.on("data", (data: Buffer) => {
        stderr += data.toString();
      });

      child.on("close", (code: number | null) => {
        clearTimeout(timer);
        const durationMs = Date.now() - startedAt;
        const exitCode = code ?? (timedOut ? 124 : 1);
        const success = exitCode === 0;
        const errors = success ? [] : parseErrors(stdout, stderr, toolId);

        if (timedOut) {
          stderr += `\n[ToolManager] Timed out after ${timeoutMs}ms`;
        }

        resolve({
          exitCode,
          stdout,
          stderr,
          durationMs,
          success,
          errors,
        });
      });

      child.on("error", (err: Error) => {
        clearTimeout(timer);
        const durationMs = Date.now() - startedAt;
        resolve({
          exitCode: -1,
          stdout,
          stderr: stderr + `\n[ToolManager] spawn error: ${err.message}`,
          durationMs,
          success: false,
          errors: [],
        });
      });
    });
  }

  /** List all registered tools. */
  list(): Tool[] {
    return registries.tools.all();
  }
}

export const toolManager = new ToolManager();
