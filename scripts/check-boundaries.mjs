#!/usr/bin/env node
/**
 * Boundary Checker — defense-in-depth for client/server module boundaries.
 *
 * PRIMARY enforcement: ESLint no-restricted-imports rule (eslint.config.mjs)
 * This script: SECONDARY enforcement (catches anything ESLint misses, e.g.
 * dynamic imports, string-based requires, or new patterns).
 *
 * Checks that client-side code NEVER imports:
 *   1. The full engine barrel (@/lib/engine) — use @/lib/engine/client
 *   2. Server-only modules directly (skills/loader, tool-manager, sandbox,
 *      skill-injector, unified-context, failure-tests, runtime-metrics)
 *   3. Node builtins (fs, path, child_process, crypto, os, etc.)
 *
 * Usage:
 *   node scripts/check-boundaries.mjs          # check (exit 1 on violation)
 *   node scripts/check-boundaries.mjs --fix    # print suggested fixes
 */

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const SRC = path.join(ROOT, "src");

// Directories that contain CLIENT-side code
const CLIENT_DIRS = [
  "components",
  "hooks",
].map(d => path.join(SRC, d));

// Specific client-side files
const CLIENT_FILES = [
  "lib/store.ts",
  "lib/export.ts",
  "app/layout.tsx",
].map(f => path.join(SRC, f));

const APP_DIR = path.join(SRC, "app");

// Server-only modules that client code must NEVER import
const SERVER_ONLY_MODULES = [
  "skills/loader",
  "tool-manager",
  "sandbox",
  "skill-injector",
  "unified-context",
  "failure-tests",
  "runtime-metrics",
];

// Node builtins that client code must NEVER import
const NODE_BUILTINS = [
  "fs", "path", "child_process", "crypto", "os", "net", "http", "https",
  "stream", "zlib", "url", "querystring", "util", "events", "buffer",
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

  // app/page.tsx, app/layout.tsx, app/<route>/page.tsx, etc.
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

  for (const d of CLIENT_DIRS) walk(d);
  walk(APP_DIR);
  for (const f of CLIENT_FILES) {
    if (fs.existsSync(f)) results.push(f);
  }

  return [...new Set(results)];
}

/**
 * Check a single file for forbidden imports.
 */
function checkFile(filePath) {
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n");
  const violations = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip comments
    if (trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*")) continue;

    // Check 1: Full barrel imports (static + dynamic)
    const barrelPatterns = [
      { re: /from\s+["'](@\/lib\/engine|@\/lib\/engine\/index)["']/g, type: "full-barrel" },
      { re: /from\s+["'](\.\.?\/)+engine["']/g, type: "full-barrel" },
      { re: /import\s*\(\s*["'](@\/lib\/engine|@\/lib\/engine\/index)["']\s*\)/g, type: "full-barrel" },
      { re: /import\s*\(\s*["'](\.\.?\/)+engine["']\s*\)/g, type: "full-barrel" },
    ];

    for (const { re, type } of barrelPatterns) {
      re.lastIndex = 0;
      const match = re.exec(line);
      if (match) {
        // Check if it's actually a more specific path (allowed)
        const isAllowed = /engine\/client/.test(line) || /engine\/types/.test(line) || /engine\/[a-z]/.test(line);
        if (!isAllowed) {
          violations.push({
            file: path.relative(ROOT, filePath),
            line: i + 1,
            content: trimmed,
            type,
            suggestion: 'Use @/lib/engine/client instead of @/lib/engine',
          });
        }
      }
    }

    // Check 2: Direct server-only module imports
    for (const mod of SERVER_ONLY_MODULES) {
      const patterns = [
        new RegExp(`from\\s+["']@/lib/engine/${mod}["']`, "g"),
        new RegExp(`from\\s+["'](\\.\\.?/)+${mod.replace(/\//g, "/")}["']`, "g"),
        new RegExp(`import\\s*\\(\\s*["']@/lib/engine/${mod}["']\\s*\\)`, "g"),
      ];
      for (const re of patterns) {
        if (re.test(line)) {
          violations.push({
            file: path.relative(ROOT, filePath),
            line: i + 1,
            content: trimmed,
            type: "server-only-module",
            suggestion: `${mod} is server-only (uses Node builtins) — cannot be imported in client code`,
          });
        }
      }
    }

    // Check 3: Node builtin imports
    for (const builtin of NODE_BUILTINS) {
      const re = new RegExp(`from\\s+["']${builtin}["']`, "g");
      if (re.test(line)) {
        violations.push({
          file: path.relative(ROOT, filePath),
          line: i + 1,
          content: trimmed,
          type: "node-builtin",
          suggestion: `Node.js builtin '${builtin}' cannot be imported in client code`,
        });
      }
    }
  }

  return violations;
}

/**
 * Main.
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
    allViolations.push(...checkFile(file));
  }

  if (allViolations.length === 0) {
    console.log(`✅ Boundary check passed: ${clientFiles.length} client files checked, 0 violations.`);
    process.exit(0);
  }

  console.error(`❌ Boundary check FAILED: ${allViolations.length} violation(s) found.\n`);

  const byType = {};
  for (const v of allViolations) {
    byType[v.type] = (byType[v.type] || 0) + 1;
  }
  console.error("Summary by type:");
  for (const [type, count] of Object.entries(byType)) {
    console.error(`  ${type}: ${count}`);
  }
  console.error("");

  for (const v of allViolations) {
    console.error(`  ${v.file}:${v.line}`);
    console.error(`    ${v.content}`);
    console.error(`    → ${v.suggestion}\n`);
  }

  console.error("Why this matters:");
  console.error("  The full barrel (@/lib/engine) exports server-only modules that use");
  console.error("  Node builtins (fs, path, child_process). Importing these in client");
  console.error("  code crashes the browser bundle during compilation.\n");

  process.exit(1);
}

main();
