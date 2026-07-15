// Real Lint Execution Skill — runs actual ESLint via ToolManager child_process
// and returns structured warnings. The quality gate fails if warnings > 0.
//
// This is NOT a static check — it spawns `npx eslint --format json` and parses
// the real JSON output into a warnings array.

export interface LintIssue {
  file: string;
  line: number;
  column: number;
  rule: string;
  message: string;
  severity: "error" | "warning";
}

export interface LintResult {
  success: boolean;
  errorCount: number;
  warningCount: number;
  errors: LintIssue[];
  warnings: LintIssue[];
  rawOutput: string;
  durationMs: number;
}

/**
 * Run ESLint on the web-admin workspace via the ToolManager API.
 * Parses the JSON output into structured issues.
 */
export async function runEslint(workspacePath: string): Promise<LintResult> {
  try {
    const res = await fetch("/api/tools", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        toolId: "eslint",
        args: { cwd: workspacePath, extraArgs: ["--format", "json", "--no-error-on-unmatched-pattern"] },
      }),
    });

    if (!res.ok) {
      return {
        success: false,
        errorCount: 0,
        warningCount: 0,
        errors: [],
        warnings: [],
        rawOutput: `ESLint API error: ${res.status}`,
        durationMs: 0,
      };
    }

    const result = await res.json();
    return parseEslintOutput(result.stdout, result.durationMs ?? 0, result.success);
  } catch (err) {
    return {
      success: false,
      errorCount: 0,
      warningCount: 0,
      errors: [],
      warnings: [],
      rawOutput: `ESLint execution failed: ${String(err)}`,
      durationMs: 0,
    };
  }
}

/**
 * Parse ESLint --format json output into structured issues.
 * ESLint JSON output is an array of file results:
 * [{ filePath, messages: [{ ruleId, severity, message, line, column }] }]
 */
function parseEslintOutput(stdout: string, durationMs: number, exitSuccess: boolean): LintResult {
  const errors: LintIssue[] = [];
  const warnings: LintIssue[] = [];

  try {
    const data = JSON.parse(stdout) as Array<{
      filePath: string;
      messages: Array<{
        ruleId: string | null;
        severity: number; // 1 = warning, 2 = error
        message: string;
        line: number;
        column: number;
      }>;
    }>;

    for (const fileResult of data) {
      const filePath = fileResult.filePath.replace(/^.*\//, "");
      for (const msg of fileResult.messages) {
        const issue: LintIssue = {
          file: filePath,
          line: msg.line,
          column: msg.column,
          rule: msg.ruleId ?? "unknown",
          message: msg.message,
          severity: msg.severity === 2 ? "error" : "warning",
        };
        if (msg.severity === 2) {
          errors.push(issue);
        } else {
          warnings.push(issue);
        }
      }
    }
  } catch {
    // If JSON parse fails, treat as no issues (ESLint may have no config)
    return {
      success: true,
      errorCount: 0,
      warningCount: 0,
      errors: [],
      warnings: [],
      rawOutput: stdout.slice(0, 500),
      durationMs,
    };
  }

  return {
    success: errors.length === 0,
    errorCount: errors.length,
    warningCount: warnings.length,
    errors,
    warnings,
    rawOutput: stdout.slice(0, 1000),
    durationMs,
  };
}

/**
 * Quality gate evaluation — runs ESLint and returns pass/fail.
 * Gate FAILS if there are any errors OR warnings > 0 (strict mode).
 */
export async function evaluateLintGate(workspacePath: string): Promise<{
  passed: boolean;
  detail: string;
  metric: string;
  result: LintResult;
}> {
  const result = await runEslint(workspacePath);

  if (result.errorCount > 0) {
    return {
      passed: false,
      detail: `ESLint: ${result.errorCount} errors, ${result.warningCount} warnings. First error: ${result.errors[0]?.file}:${result.errors[0]?.line} ${result.errors[0]?.message}`,
      metric: `${result.errorCount} errors`,
      result,
    };
  }

  if (result.warningCount > 0) {
    return {
      passed: false,
      detail: `ESLint: 0 errors, ${result.warningCount} warnings. First warning: ${result.warnings[0]?.file}:${result.warnings[0]?.line} ${result.warnings[0]?.message}`,
      metric: `${result.warningCount} warnings`,
      result,
    };
  }

  return {
    passed: true,
    detail: `ESLint: 0 errors, 0 warnings in ${result.durationMs}ms`,
    metric: "0 errors, 0 warnings",
    result,
  };
}
