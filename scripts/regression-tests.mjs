#!/usr/bin/env node
// Pavan Regression Tests
// ---------------------------------------------------------------------------
// Automated integration tests for the 5 behavioral validations described in
// worklog.md (Tasks A–E). Hits the live dev server on http://localhost:3000
// and asserts each validation endpoint behaves as expected.
//
// Pure Node ESM — no external dependencies, no test runner required.
//
// Usage:
//   node scripts/regression-tests.mjs
//
// Exit codes:
//   0 = all 5 tests passed
//   1 = at least one test failed (or the dev server is unreachable)
// ---------------------------------------------------------------------------

const BASE = process.env.PAVAN_BASE_URL ?? "http://localhost:3000";

// ---------------------------------------------------------------------------
// Tiny test harness
// ---------------------------------------------------------------------------
const results = []; // {name, pass, details, response}

function record(name, pass, details, response) {
  results.push({ name, pass, details, response });
  const mark = pass ? "✓" : "✗";
  const status = pass ? "PASS" : "FAIL";
  console.log(`${mark} ${name} — ${status}`);
  if (!pass) {
    for (const d of details) console.log(`    ${d}`);
    console.log(`    Response: ${JSON.stringify(response).slice(0, 800)}`);
  }
}

/** Fetch helper that returns {ok, status, json}. */
async function fetchJson(path, opts = {}) {
  const res = await fetch(BASE + path, opts);
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* non-JSON body — leave json null */
  }
  return { ok: res.ok, status: res.status, json };
}

// ---------------------------------------------------------------------------
// Pre-flight: is the dev server up?
// ---------------------------------------------------------------------------
async function ensureServerUp() {
  try {
    const res = await fetch(BASE, { method: "GET" });
    return res.ok || res.status === 200 || res.status === 404; // 404 is fine — root may not exist
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Test 1: Build trace structure
// ---------------------------------------------------------------------------
async function test1_buildTrace() {
  const name = "Test 1: Build trace structure";
  const { ok, status, json } = await fetchJson("/api/build/trace");
  const details = [];

  if (!ok) {
    details.push(`HTTP ${status} — endpoint unreachable`);
    record(name, false, details, json);
    return;
  }
  if (!Array.isArray(json?.trace)) {
    details.push(`Missing or non-array 'trace' field (got ${typeof json?.trace})`);
    record(name, false, details, json);
    return;
  }
  if (typeof json?.count !== "number") {
    details.push(`Missing or non-number 'count' (got ${typeof json?.count})`);
    record(name, false, details, json);
    return;
  }
  if (typeof json?.batches !== "number") {
    details.push(`Missing or non-number 'batches' (got ${typeof json?.batches})`);
    record(name, false, details, json);
    return;
  }
  if (typeof json?.maxParallel !== "number") {
    details.push(`Missing or non-number 'maxParallel' (got ${typeof json?.maxParallel})`);
    record(name, false, details, json);
    return;
  }
  if (json.count !== json.trace.length) {
    details.push(`count (${json.count}) !== trace.length (${json.trace.length})`);
    record(name, false, details, json);
    return;
  }
  // Empty trace is valid structure (no build needs to have run).
  record(name, true, [`count=${json.count} batches=${json.batches} maxParallel=${json.maxParallel}`], json);
}

// ---------------------------------------------------------------------------
// Test 2: Agent trace structure
// ---------------------------------------------------------------------------
async function test2_agentTrace() {
  const name = "Test 2: Agent trace structure";
  const { ok, status, json } = await fetchJson("/api/agents/trace");
  const details = [];

  if (!ok) {
    details.push(`HTTP ${status} — endpoint unreachable`);
    record(name, false, details, json);
    return;
  }
  const s = json?.summary;
  if (!s || typeof s !== "object") {
    details.push(`Missing 'summary' object (got ${typeof json?.summary})`);
    record(name, false, details, json);
    return;
  }
  for (const key of ["totalAgents", "activeAgents", "completedAgents", "totalTasks"]) {
    if (typeof s[key] !== "number") {
      details.push(`summary.${key} is not a number (got ${typeof s[key]} = ${JSON.stringify(s[key])})`);
    }
  }
  if (!Array.isArray(json?.activations)) {
    details.push(`'activations' is not an array (got ${typeof json?.activations})`);
  }
  if (details.length > 0) {
    record(name, false, details, json);
    return;
  }
  record(name, true, [`summary=${JSON.stringify(s)} activations.length=${json.activations.length}`], json);
}

// ---------------------------------------------------------------------------
// Test 3: Decision impact (SKILL.md flip)
// ---------------------------------------------------------------------------
async function test3_decisionImpact() {
  const name = "Test 3: Decision impact (SKILL.md flip)";
  const url =
    "/api/debug/decision-impact?prompt=native+cross-platform+windows+desktop+app&platform=windows&flipDemo=true";
  const { ok, status, json } = await fetchJson(url);
  const details = [];

  if (!ok) {
    details.push(`HTTP ${status} — endpoint unreachable`);
    record(name, false, details, json);
    return;
  }
  if (json?.flipped !== true) {
    details.push(`Expected flipped === true, got ${JSON.stringify(json?.flipped)}`);
  }
  const topWithout = json?.topWithoutSkills;
  const topWith = json?.topWithSkills;
  if (!topWithout || !topWith) {
    details.push(`Missing topWithoutSkills or topWithSkills`);
  } else {
    if (topWithout.choose === topWith.choose) {
      details.push(`Expected winner to flip, but both chose '${topWith.choose}'`);
    }
    // The +1.5 boost applies to the ENDORSED policy — which becomes the
    // WITH-skills winner. Its baseline score lives in withoutSkills[] (same
    // policyId). We assert: topWith.score === baselineOf(topWith.policyId) + 1.5.
    const baseline = (json.withoutSkills ?? []).find((p) => p.policyId === topWith.policyId);
    if (!baseline) {
      details.push(`Could not find baseline entry for endorsed policy '${topWith.policyId}' in withoutSkills[]`);
    } else {
      const expected = Math.round((baseline.score + 1.5) * 100) / 100;
      if (Math.abs(topWith.score - expected) > 0.001) {
        details.push(
          `Expected topWithSkills.score (${topWith.score}) === baseline (${baseline.score}) + 1.5 = ${expected}`
        );
      }
    }
  }
  if (details.length > 0) {
    record(name, false, details, json);
    return;
  }
  record(
    name,
    true,
    [
      `without: ${topWithout.choose} (${topWithout.score}) → with: ${topWith.choose} (${topWith.score}) [boost +1.5]`,
    ],
    json
  );
}

// ---------------------------------------------------------------------------
// Test 4: Memory impact (SQLite vs PostgreSQL)
// ---------------------------------------------------------------------------
async function test4_memoryImpact() {
  const name = "Test 4: Memory impact (SQLite vs PostgreSQL)";
  const { ok, status, json } = await fetchJson("/api/debug/memory-impact", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt: "CRM app", database: "postgresql" }),
  });
  const details = [];

  if (!ok) {
    details.push(`HTTP ${status} — endpoint unreachable`);
    record(name, false, details, json);
    return;
  }
  const diff = json?.diff;
  if (!diff || typeof diff !== "object") {
    details.push(`Missing 'diff' object`);
    record(name, false, details, json);
    return;
  }
  const pp = diff.prismaProvider?.postgresql;
  const ps = diff.prismaProvider?.sqlite;
  if (pp !== 'provider = "postgresql"') {
    details.push(`diff.prismaProvider.postgresql expected 'provider = "postgresql"', got ${JSON.stringify(pp)}`);
  }
  if (ps !== 'provider = "sqlite"') {
    details.push(`diff.prismaProvider.sqlite expected 'provider = "sqlite"', got ${JSON.stringify(ps)}`);
  }
  const ep = diff.efCoreOnConfiguring?.postgresql;
  const es = diff.efCoreOnConfiguring?.sqlite;
  if (typeof ep !== "string" || typeof es !== "string") {
    details.push(`efCoreOnConfiguring entries must be strings (got ${typeof ep}, ${typeof es})`);
  } else if (ep === es) {
    details.push(`efCoreOnConfiguring.postgresql must differ from sqlite (both are '${ep}')`);
  }
  if (details.length > 0) {
    record(name, false, details, json);
    return;
  }
  record(
    name,
    true,
    [
      `prisma: pg='${pp}' sqlite='${ps}'`,
      `efCore: pg='${ep}' sqlite='${es}'`,
    ],
    { diff }
  );
}

// ---------------------------------------------------------------------------
// Test 5: Skills endpoint
// ---------------------------------------------------------------------------
async function test5_skills() {
  const name = "Test 5: Skills endpoint";
  const { ok, status, json } = await fetchJson("/api/skills");
  const details = [];

  if (!ok) {
    details.push(`HTTP ${status} — endpoint unreachable`);
    record(name, false, details, json);
    return;
  }
  // The live API returns { count, skills: [...] }. Accept either an array
  // response (legacy) or the object shape — both forms are validated.
  const skills = Array.isArray(json) ? json : Array.isArray(json?.skills) ? json.skills : null;
  if (!skills) {
    details.push(`Response is neither an array nor {skills:[]} — got ${typeof json}`);
    record(name, false, details, json);
    return;
  }
  if (skills.length <= 20) {
    details.push(`Expected skills.length > 20, got ${skills.length}`);
    record(name, false, details, json);
    return;
  }
  for (let i = 0; i < skills.length; i++) {
    const s = skills[i];
    const id = s?.id ?? s?.name; // spec allows either 'id' or 'name'
    const title = s?.title ?? s?.name;
    if (!id) {
      details.push(`skill[${i}] missing id/name`);
      break;
    }
    if (!title) {
      details.push(`skill[${i}] missing title/name`);
      break;
    }
    if (!s?.category) {
      details.push(`skill[${i}] ('${id}') missing category`);
      break;
    }
  }
  if (details.length > 0) {
    record(name, false, details, json);
    return;
  }
  record(name, true, [`loaded ${skills.length} skills`], { count: skills.length });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log("🧪 Pavan Regression Tests");
  console.log("=========================");

  if (!(await ensureServerUp())) {
    console.error(`\n✗ Dev server is NOT running on ${BASE}`);
    console.error(`  Start it with:  cd /home/z/my-project && bun run dev`);
    console.error(`  (or:            nohup node node_modules/.bin/next dev -p 3000 > dev.log 2>&1 &)`);
    process.exit(1);
  }

  await test1_buildTrace();
  await test2_agentTrace();
  await test3_decisionImpact();
  await test4_memoryImpact();
  await test5_skills();

  const passed = results.filter((r) => r.pass).length;
  const total = results.length;
  console.log("");
  console.log("=========================");
  console.log(`PASSED: ${passed}/${total}`);
  if (passed === total) {
    console.log("All regression tests passed.");
    process.exit(0);
  } else {
    const failed = results.filter((r) => !r.pass);
    console.log(`${failed.length} test(s) failed:`);
    for (const r of failed) {
      console.log(`  - ${r.name}`);
      for (const d of r.details) console.log(`      ${d}`);
    }
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("\n✗ Regression test runner crashed:");
  console.error(err);
  process.exit(1);
});
