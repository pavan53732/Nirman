#!/usr/bin/env node
/**
 * Pavan Performance Benchmark — 20-run statistical methodology.
 *
 * Measures generator throughput across 20 iterations, computes mean/median/stddev,
 * and captures full environment metadata for reproducibility.
 *
 * IMPORTANT: "files" in this benchmark = in-memory generated string artifacts
 * (the VirtualFile[] returned by generateForTarget). These are NOT filesystem
 * writes — they are template-generated strings that WOULD be written to disk
 * by the workspace API. The metric measures generation throughput, not I/O.
 *
 * Usage:
 *   node scripts/benchmark.mjs              # 20 runs, default scenarios
 *   node scripts/benchmark.mjs --runs=50    # custom run count
 */
import { execSync } from "node:child_process";
import { hostname, platform, arch, cpus, totalmem, freemem } from "node:os";
import fs from "node:fs";

const BASE = process.env.PAVAN_BASE_URL || "http://localhost:3000";
const RUNS = parseInt(process.argv.find((a) => a.startsWith("--runs="))?.split("=")[1] || "20", 10);

// ---------- Pre-flight: check server ----------
try {
  await fetch(`${BASE}/api/debug/perf-profile`, { signal: AbortSignal.timeout(3000) });
} catch {
  console.error(`✗ Dev server not reachable at ${BASE}`);
  console.error(`  Start it with: bun run dev`);
  process.exit(1);
}

// ---------- Environment metadata ----------
function getEnvInfo() {
  const nodeVersion = process.version;
  const platformStr = `${platform()} ${arch()}`;
  const cpuInfo = cpus()[0] ?? { model: "unknown", speed: 0 };
  const cpuCount = cpus().length;
  const totalRamGB = (totalmem() / 1024 / 1024 / 1024).toFixed(2);
  const freeRamGB = (freemem() / 1024 / 1024 / 1024).toFixed(2);
  const hostnameStr = hostname();

  // Filesystem type (best-effort)
  let fsType = "unknown";
  try {
    const dfOutput = execSync("df -T / 2>/dev/null", { encoding: "utf-8" });
    const lines = dfOutput.trim().split("\n");
    if (lines.length >= 2) {
      fsType = lines[1].split(/\s+/)[1] || "unknown";
    }
  } catch { /* ignore */ }

  return {
    nodeVersion,
    platform: platformStr,
    hostname: hostnameStr,
    cpu: { model: cpuInfo.model, cores: cpuCount, speedMHz: cpuInfo.speed },
    ram: { totalGB: parseFloat(totalRamGB), freeGB: parseFloat(freeRamGB) },
    filesystem: fsType,
    timestamp: new Date().toISOString(),
  };
}

// ---------- Statistics ----------
function stats(arr) {
  const sorted = [...arr].sort((a, b) => a - b);
  const n = sorted.length;
  const mean = sorted.reduce((s, x) => s + x, 0) / n;
  const median = n % 2 === 0
    ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2
    : sorted[Math.floor(n / 2)];
  const variance = sorted.reduce((s, x) => s + (x - mean) ** 2, 0) / n;
  const stdDev = Math.sqrt(variance);
  const min = sorted[0];
  const max = sorted[n - 1];
  return { mean, median, stdDev, min, max, n };
}

// ---------- Benchmark loop ----------
const env = getEnvInfo();
console.log("=".repeat(70));
console.log("Pavan Performance Benchmark — 20-Run Statistical Methodology");
console.log("=".repeat(70));
console.log("\nEnvironment:");
console.log(`  Node:          ${env.nodeVersion}`);
console.log(`  Platform:      ${env.platform}`);
console.log(`  Hostname:      ${env.hostname}`);
console.log(`  CPU:           ${env.cpu.model} (${env.cpu.cores} cores @ ${env.cpu.speedMHz} MHz)`);
console.log(`  RAM:           ${env.ram.totalGB} GB total, ${env.ram.freeGB} GB free`);
console.log(`  Filesystem:    ${env.filesystem}`);
console.log(`  Timestamp:     ${env.timestamp}`);
console.log(`  Runs per scenario: ${RUNS}`);
console.log(`  Note: "files" = in-memory generated strings (VirtualFile[]), NOT filesystem writes`);
console.log("");

const scenarios = [1, 2, 3, 4];
const results = {};

for (const scenarioIdx of scenarios) {
  console.log(`Scenario ${scenarioIdx}: running ${RUNS} iterations...`);
  const samples = [];

  for (let i = 0; i < RUNS; i++) {
    try {
      const res = await fetch(`${BASE}/api/debug/perf-profile?scenario=${scenarioIdx}`, {
        signal: AbortSignal.timeout(10000),
      });
      const data = await res.json();
      // The endpoint returns all 4; we take the one matching scenarioIdx
      const row = data.results?.find((r) => r.scenario?.startsWith(`${scenarioIdx}.`));
      if (row) {
        samples.push({
          durationMs: row.durationMs,
          fileCount: row.fileCount,
          totalBytes: row.totalBytes,
          heapDeltaMB: row.heapDeltaMB,
          filesPerSecond: row.filesPerSecond,
        });
      }
    } catch (e) {
      console.error(`  Run ${i + 1} failed: ${e.message}`);
    }
    if ((i + 1) % 5 === 0) console.log(`  ...${i + 1}/${RUNS} done`);
  }

  if (samples.length === 0) {
    console.log(`  No samples collected for scenario ${scenarioIdx}`);
    continue;
  }

  results[scenarioIdx] = {
    samples: samples.length,
    durationMs: stats(samples.map((s) => s.durationMs)),
    filesPerSecond: stats(samples.map((s) => s.filesPerSecond)),
    heapDeltaMB: stats(samples.map((s) => s.heapDeltaMB)),
    fileCount: samples[0]?.fileCount ?? 0, // deterministic
    totalBytes: samples[0]?.totalBytes ?? 0,
  };
}

// ---------- Report ----------
console.log("\n" + "=".repeat(70));
console.log("Results (statistical summary over " + RUNS + " runs)");
console.log("=".repeat(70));
console.log("");
console.log("Note: 'files' = in-memory generated string artifacts (VirtualFile[]).");
console.log("      These are template-generated strings, NOT filesystem writes.");
console.log("      The metric measures generation throughput, not disk I/O.");
console.log("");

const scenarioNames = {
  1: "Single-target web (small)",
  2: "Single-target web (CRM)",
  3: "3-target CRM",
  4: "Stress (enterprise CRM, 3 targets)",
};

const header = [
  "Scenario".padEnd(40),
  "files".padStart(5),
  "dur_ms (mean±std)".padStart(18),
  "median".padStart(8),
  "min".padStart(6),
  "max".padStart(6),
  "files/s (mean)".padStart(15),
  "heapΔMB".padStart(8),
].join(" ");
console.log(header);
console.log("-".repeat(110));

for (const idx of scenarios) {
  const r = results[idx];
  if (!r) continue;
  const name = scenarioNames[idx] || `Scenario ${idx}`;
  const d = r.durationMs;
  const f = r.filesPerSecond;
  const h = r.heapDeltaMB;
  const durStr = `${d.mean.toFixed(1)}±${d.stdDev.toFixed(1)}`;
  const row = [
    name.padEnd(40),
    String(r.fileCount).padStart(5),
    durStr.padStart(18),
    d.median.toFixed(1).padStart(8),
    d.min.toFixed(1).padStart(6),
    d.max.toFixed(1).padStart(6),
    f.mean.toFixed(0).padStart(15),
    h.mean.toFixed(2).padStart(8),
  ].join(" ");
  console.log(row);
}

console.log("");
console.log("=".repeat(70));
console.log("Methodology Notes:");
console.log("-".repeat(70));
console.log(`  • ${RUNS} iterations per scenario, sequential (no warmup discarded)`);
console.log("  • Each iteration calls /api/debug/perf-profile which invokes");
console.log("    generateForTarget() server-side (in-memory, no disk I/O)");
console.log("  • 'files' = VirtualFile[] entries (path + content strings)");
console.log("  • heapDeltaMB = process.memoryUsage().heapUsed delta (after - before)");
console.log("  • durationMs = wall-clock time of generator calls only");
console.log("  • Network round-trip excluded (measured server-side)");
console.log("");

// Save raw data
const report = { environment: env, runs: RUNS, results, generatedAt: new Date().toISOString() };
fs.writeFileSync("/home/z/my-project/benchmark-results.json", JSON.stringify(report, null, 2));
console.log("Raw data saved to: benchmark-results.json");
