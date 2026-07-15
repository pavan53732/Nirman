#!/usr/bin/env node
/**
 * Boundary Checker — enforces client/server module boundaries.
 *
 * Ensures that client-side code NEVER imports from the full engine barrel
 * (@/lib/engine or ./engine), which includes server-only modules that use
 * Node builtins (fs, path, child_process). Client code MUST import from
 * @/lib/engine/client (or ./engine/client) instead.
 *
 * This script is automatically run as part of `bun run lint` and CI.
 * If it fails, the build is broken — fix the imports before merging.
 *
 * Usage:
 *   node scripts/check-boundaries.mjs          # check (exit 1 on violation)
 *   node scripts/check-boundaries.mjs --fix    # print suggested fixes
 */

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const SRC = path.join(ROOT, "src");

// Directories that contain CLIENT-side code (must not import server modules)
const CLIENT_DIRS = [
  "components",
  "hooks",
].map(d => path.join(SRC, d));

// Specific client-side files (not in the above directories)
const CLIENT_FILES = [
  "lib/store.ts",
  "lib/export.ts",
  "app/layout.tsx",
].map(f => path.join(SRC, f));

// All .tsx files in app/ that are NOT API routes (page.tsx, layout.tsx, etc.)
// API routes (app/api/**) are server-side and CAN use the full barrel.
const APP_DIR = path.join(SRC, "app");

// Patterns that indicate a server-only barrel import (FORBIDDEN in client code)
// Matches:
//   from "@/lib/engine"        (exact, no /client, no /specific-module)
//   from "@/lib/engine/index"
//   from "./engine"            (relative)
//   from "../engine"
//   from "../../engine"
//   import("@/lib/engine")     (dynamic import)
const FORBIDDEN_PATTERNS = [
  // Static imports: from "@/lib/engine" (but NOT "@/lib/engine/client" or "@/lib/engine/types")
  /from\s+["'](@\/lib\/engine|@\/lib\/engine\/index)["']/g,
  // Static imports: from "./engine" or "../engine" (relative, exact — not "./engine/client")
  /from\s+["'](\.\.?\/)+engine["']/g,
  // Dynamic imports: import("@/lib/engine")
  /import\s*\(\s*["'](@\/lib\/engine|@\/lib\/engine\/index)["']\s*\)/g,
  // Dynamic imports: import("./engine")
  /import\s*\(\s*["'](\.\.?\/)+engine["']\s*\)/g,
];

// Allowed client-safe import patterns
const ALLOWED_PATTERNS = [
  /from\s+["']@\/lib\/engine\/client["']/,
  /from\s+["']@\/lib\/engine\/types["']/,
  /from\s+["'](\.\.?\/)+engine\/client["']/,
  /from\s+["'](\.\.?\/)+engine\/types["']/,
  // Direct module imports (e.g., ./engine/orchestrator) are also allowed
  /from\s+["']@\/lib\/engine\/[a-z][^"']*["']/,
  /from\s+["'](\.\.?\/)+engine\/[a-z][^"']*["']/,
];

/**
 * Check if a file is client-side.
 */
function isClientFile(filePath) {
  const rel = path.relative(SRC, filePath);

  // API routes are server-side
  if (rel.startsWith("app/api/")) return false;

  // Check specific client files
  if (CLIENT_FILES.some(f => path.relative(SRC, f) === rel)) return true;

  // Check client directories
  if (CLIENT_DIRS.some(d => filePath.startsWith(d))) return true;

  // app/page.tsx, app/layout.tsx, app/<route>/page.tsx, etc. are client-side
  // (they're React Server Components that render client components)
  if (rel.startsWith("app/") && (rel.endsWith("page.tsx") || rel.endsWith("layout.tsx"))) {
    return true;
  }

  return false;
}

/**
 * Find all client-side files.
 */
function findClientFiles() {
  const results = [];

  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && (full.endsWith(".ts") || full.endsWith(".tsx"))) {
        if (isClientFile(full)) {
          results.push(full);
        }
      }
    }
  }

  // Walk client directories
  for (const d of CLIENT_DIRS) walk(d);

  // Walk app/ directory (for page.tsx, layout.tsx — but skip api/)
  walk(APP_DIR);

  // Add specific client files
  for (const f of CLIENT_FILES) {
    if (fs.existsSync(f)) results.push(f);
  }

  return [...new Set(results)];
}

/**
 * Check a single file for forbidden imports.
 * Returns an array of violations.
 */
function checkFile(filePath) {
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n");
  const violations = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Skip comments
    const trimmed = line.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*")) continue;

    for (const pattern of FORBIDDEN_PATTERNS) {
      // Reset lastIndex for global regex
      pattern.lastIndex = 0;
      const match = pattern.exec(line);
      if (match) {
        // Check if this is actually an allowed pattern (more specific path)
        const isAllowed = ALLOWED_PATTERNS.some(p => p.test(line));
        if (isAllowed) continue;

        violations.push({
          file: path.relative(ROOT, filePath),
          line: i + 1,
          content: line.trim(),
          import: match[0],
        });
      }
    }
  }

  return violations;
}

/**
 * Main: check all client files, report violations.
 */
function main() {
  const wantFix = process.argv.includes("--fix");
  const clientFiles = findClientFiles();

  if (clientFiles.length === 0) {
    console.log("ℹ️  No client files found to check.");
    process.exit(0);
  }

  let allViolations = [];
  for (const file of clientFiles) {
    const violations = checkFile(file);
    allViolations.push(...violations);
  }

  if (allViolations.length === 0) {
    console.log(`✅ Boundary check passed: ${clientFiles.length} client files checked, 0 violations.`);
    console.log("   All client-side code imports from @/lib/engine/client or specific modules.");
    process.exit(0);
  }

  console.error(`❌ Boundary check FAILED: ${allViolations.length} violation(s) found.`);
  console.error("");
  console.error("Client-side code must NOT import from the full engine barrel (@/lib/engine).");
  console.error("Use @/lib/engine/client instead (browser-safe subset).");
  console.error("");
  console.error("Violations:");

  for (const v of allViolations) {
    console.error(`  ${v.file}:${v.line}`);
    console.error(`    ${v.content}`);
    if (wantFix) {
      const fixed = v.content
        .replace(/@\/lib\/engine["']/g, '@/lib/engine/client"')
        .replace(/@\/lib\/engine\/index["']/g, '@/lib/engine/client"')
        .replace(/(\.\.?\/)+engine["']/g, (m) => m.replace(/engine["']$/, 'engine/client"'));
      console.error(`    → Suggested fix: ${fixed}`);
    }
    console.error("");
  }

  if (wantFix) {
    console.error("To fix automatically, run: node scripts/check-boundaries.mjs --fix");
    console.error("(This script does not auto-apply fixes — review the suggestions manually.)");
  }

  console.error("Why this matters:");
  console.error("  The full barrel (@/lib/engine) exports server-only modules that use");
  console.error("  Node builtins (fs, path, child_process). Importing these in client");
  console.error("  code crashes the browser bundle during compilation.");
  console.error("");

  process.exit(1);
}

main();
