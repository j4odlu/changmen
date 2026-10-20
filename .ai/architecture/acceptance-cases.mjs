// Acceptance + Truth Reliability cases for the Context Resolver (Phase 2 §13 + Phase 4 §12).
// Run: node .ai/architecture/acceptance-cases.mjs  (or npm run check:index-acceptance)
// Exits 0 only if all cases pass. No network, no LLM — pure assertions on resolver/index output.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveContext } from "./resolve-context.mjs";
import { computeEvidenceStatus, hashContent, applyFreshness } from "./build-index.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const index = JSON.parse(fs.readFileSync(path.join(ROOT, ".ai", "architecture", "index.json"), "utf8"));

let failures = 0;
function check(caseName, cond, msg) {
  if (cond) {
    console.log(`  PASS  ${caseName}: ${msg}`);
  } else {
    failures++;
    console.log(`  FAIL  ${caseName}: ${msg}`);
  }
}

// ---------------------------------------------------------------- CASE 1
{
  const q = "modify pm-sports match writing";
  const out = resolveContext(q, index);
  console.log(`\nCASE 1  query="${q}"  status=${out.status}`);
  check("case1", out.status === "ok", "status ok");
  check("case1", !!out.results.runtimes["changmen-pm-sports"], "hits runtime changmen-pm-sports");
  check("case1", !!out.results.resources.client_matches, "hits resource client_matches");
  const cm = out.results.resources.client_matches;
  const pmOp = cm && (cm.operations || []).find((o) => o.operation === "update-pm_sport-field");
  check("case1", !!pmOp, "client_matches exposes pm_sport field-level operation");
  check("case1", pmOp && pmOp.ownershipScope === "field", "pm_sport operation marked ownershipScope=field");
  check("case1", !!pmOp && pmOp.writers.some((w) => w.runtime === "changmen-pm-sports"), "pm_sport writer = changmen-pm-sports");
  check("case1", out.relations.some((r) => r.from === "runtime:changmen-pm-sports" && r.type === "hosts"), "relation runtime:changmen-pm-sports hosts a capability");
  check("case1", out.humanDecisionsRequired.includes("F-02"), "propagates conflict F-02 (client_matches writers overclaim)");
  check("case1", !!out.results.conflicts["F-02"], "conflict F-02 object included");
}

// ---------------------------------------------------------------- CASE 2
{
  const q = "modify realtime hub";
  const out = resolveContext(q, index);
  console.log(`\nCASE 2  query="${q}"  status=${out.status}`);
  check("case2", out.status === "ok", "status ok");
  check("case2", !!out.results.modules["@changmen/realtime-hub"], "hits module @changmen/realtime-hub");
  check("case2", !!out.results.runtimes["changmen-esport"], "hits runtime changmen-esport");
  const es = out.results.runtimes["changmen-esport"];
  check("case2", es && Array.isArray(es.hosts) && es.hosts.length > 1, `runtime≠capability: changmen-esport hosts=${JSON.stringify(es && es.hosts)}`);
  check("case2", (es.hosts || []).includes("distribution"), "distribution capability hosted by changmen-esport");
  check("case2", !!out.results.rules.team_boundaries, "boundary rule (team_boundaries) attached");
}

// ---------------------------------------------------------------- CASE 3
{
  const q = "modify platform registry";
  const out = resolveContext(q, index);
  console.log(`\nCASE 3  query="${q}"  status=${out.status}`);
  check("case3", out.status === "ok", "status ok");
  check("case3", !!out.results.sources.platformManifest, "hits canonical platform registry source");
  check("case3", !!out.results.drift && !!out.results.drift.canonical, "drift info attached");
  const derivedCount = out.results.drift ? (out.results.drift.derived || []).length : 0;
  check("case3", derivedCount >= 5, `drift lists derived copies (${derivedCount})`);
  const statuses = new Set((out.results.drift?.derived || []).map((d) => d.status));
  check("case3", statuses.has("PASS") || statuses.has("DRIFT"), "drift report contains current derived-copy statuses");
}

// ---------------------------------------------------------------- CASE 4
{
  const q = "change client_matches ownership";
  const out = resolveContext(q, index);
  console.log(`\nCASE 4  query="${q}"  status=${out.status}`);
  check("case4", !!out.results.resources.client_matches, "hits resource client_matches");
  check("case4", out.results.resources.client_matches.status === "conflicted", "client_matches status = conflicted");
  check("case4", out.humanDecisionsRequired.includes("F-02"), "HUMAN DECISION REQUIRED surfaced (F-02)");
  const ops = (out.results.resources.client_matches.operations || []);
  const writerCount = ops.reduce((n, o) => n + (o.writers || []).length, 0);
  check("case4", ops.length >= 5 && writerCount >= 8, `operation-level writers preserved (${ops.length} ops, ${writerCount} writers)`);
  const scopes = new Set(ops.map((o) => o.ownershipScope));
  check("case4", scopes.has("field") && (scopes.has("operation") || scopes.has("unknown")), `ownership scopes include field+operation/unknown: ${[...scopes].join(",")}`);
  const json = JSON.stringify(out).toLowerCase();
  check("case4", !json.includes("sole writer") && !json.includes("single writer of client_matches"),
    'output never claims a sole/single writer for client_matches');
  check("case4", !!out.results.conflicts["F-02"] && out.results.conflicts["F-02"].humanDecisionRequired === true,
    "F-02 conflict object present with humanDecisionRequired=true");
}

// ---------------------------------------------------------------- CASE 5
{
  const q = "some completely unknown capability zzzqqq";
  const out = resolveContext(q, index);
  console.log(`\nCASE 5  query="${q}"  status=${out.status}`);
  check("case5", out.status === "unknown", "status unknown (no guessing)");
  const bucketCounts = Object.entries(out.results)
    .filter(([k]) => !["conflicts", "drift", "superseded"].includes(k))
    .map(([, b]) => Object.keys(b).length)
    .reduce((a, b) => a + b, 0);
  check("case5", bucketCounts === 0, "zero fabricated results");
  check("case5", Array.isArray(out.notFound) && out.notFound.length > 0, `notFound tokens reported: [${out.notFound.join(", ")}]`);
}

// ================= Phase 4 Truth Reliability tests (§12) =================

// Test A — stale fact: freshness is computed from content-hash snapshots
{
  console.log(`\nTEST A  evidence freshness (snapshot vs tampered vs none)`);
  const file = "rds/rds/client_matches_store.js";
  const good = hashContent(fs.readFileSync(path.join(ROOT, file), "utf8"));
  const entryFiles = [`${file}:280`]; // line-suffixed evidence pointer form
  const cur = computeEvidenceStatus(entryFiles, { hashes: { [file]: good } });
  check("testA", cur.evidenceStatus === "current", `matching snapshot → current (${cur.evidenceStatus})`);
  const tampered = computeEvidenceStatus(entryFiles, { hashes: { [file]: "0".repeat(40) } });
  check("testA", tampered.evidenceStatus === "reaudit-required" && (tampered.mismatchedEvidence || []).length === 1,
    "tampered snapshot → reaudit-required with mismatchedEvidence listed");
  const none = computeEvidenceStatus(entryFiles, { hashes: {} });
  check("testA", none.evidenceStatus === "unverified", "no snapshot coverage → unverified (UNKNOWN > pretending verified)");
  // full downgrade chain: verified entry + changed evidence → status becomes stale, priorStatus preserved
  const fakeEntry = {
    status: "verified", derivation: "audit-code-review-2026-09-19",
    operations: [{ writers: [{ evidence: [`${file}:74`] }] }],
  };
  const downgraded = applyFreshness(fakeEntry, { hashes: { [file]: "0".repeat(40) } });
  check("testA", downgraded.status === "stale" && downgraded.priorStatus === "verified" && downgraded.evidenceStatus === "reaudit-required",
    "verified + mismatched evidence → status stale (priorStatus=verified preserved)");
  const intact = applyFreshness(fakeEntry, { hashes: { [file]: good } });
  check("testA", intact.status === "verified" && intact.evidenceStatus === "current", "matching evidence keeps status verified");
}

// Test B — superseded audit: M-11 must never be served as current truth
{
  console.log(`\nTEST B  superseded fact quarantine (TE-1 / M-11)`);
  check("testB", index.superseded && index.superseded["M-11"] && index.superseded["M-11"].status === "superseded",
    'index.superseded["M-11"].status === "superseded"');
  const out = resolveContext("platform registry drift check", index);
  check("testB", !!out.results.superseded["M-11"], "M-11 matched only into results.superseded");
  check("testB", !!out.results.drift && !!out.results.drift.canonical, "current truth (drift check exists) IS attached via drift block");
  check("testB", out.safety.warnings.some((w) => w.includes("SUPERSEDED") && w.includes("M-11")),
    "safety warning marks M-11 as historical");
  check("testB", out.truthSummary.verified === undefined || out.truthSummary.superseded >= 1,
    "superseded counted separately, never as verified");
}

// Test C — client_matches writers completeness (TE-2)
{
  console.log(`\nTEST C  client_matches writer completeness (TE-2)`);
  const ops = (index.resources.client_matches.operations || []);
  const allTargets = ops.flatMap((o) => (o.writers || []).map((w) => w.target)).join("\n");
  check("testC", allTargets.includes("markClientMatchesEndedByStartBefore"), "writer markClientMatchesEndedByStartBefore present");
  check("testC", allTargets.includes("insertClientMatchStub"), "writer insertClientMatchStub present");
  check("testC", ops.every((o) => o.ownershipScope && o.writerCardinality), "every operation declares ownershipScope + writerCardinality");
  const pmOp = ops.find((o) => o.operation === "update-pm_sport-field");
  check("testC", pmOp && pmOp.ownershipScope === "field" && pmOp.writerCardinality === "single", "field-level ownership preserved for pm_sport");
}

// Test D — token normalization (G-1)
{
  console.log(`\nTEST D  token normalization: matchMerge / match-merge / match_merge`);
  for (const q of ["matchMerge", "match-merge", "match_merge"]) {
    const out = resolveContext(`modify ${q} scheduling`, index);
    check("testD", !!out.results.capabilities["match-merge"], `"${q}" resolves to capability match-merge`);
  }
}

// Test E — capability expansion (G-2)
{
  console.log(`\nTEST E  capability → operations → resource → runtime expansion`);
  const out = resolveContext("match merge scheduling", index);
  check("testE", !!out.results.capabilities["match-merge"], "capability matched directly");
  check("testE", !!out.results.resources.client_matches, "ownsOperations expanded to resource client_matches");
  check("testE", !!out.results.runtimes["changmen-esport"], "hostedBy/writer-runtime expansion reaches changmen-esport");
  check("testE", !!out.results.modules["@changmen/matcher"], "implementedBy expansion reaches @changmen/matcher");
  check("testE", out.relations.some((r) => r.type === "owns-operation" && r.to.includes("client_matches")),
    "owns-operation relation recorded");
}

// Test F — conflict safety: uncertainty must survive resolution
{
  console.log(`\nTEST F  conflict safety (no false certainty)`);
  const out = resolveContext("consolidate client_matches writers to matcher only", index);
  check("testF", (out.safety.negativeAssertions || []).some((a) => a.includes("Do NOT assume a single/table-level writer")),
    "negative assertion: do NOT assume single writer");
  check("testF", (out.safety.warnings || []).some((w) => w.includes("CONFLICTED") && w.includes("Human decision required")),
    "warning: CONFLICTED + human decision required");
  check("testF", out.safety.uncertainty === "present", "safety.uncertainty === present");
  const json = JSON.stringify(out).toLowerCase();
  check("testF", !json.includes("sole writer") && !json.includes('"writer": "matcher"'),
    "output contains no packaged certainty about a sole writer");
}

// Test G — unknown safety (unchanged behavior)
{
  console.log(`\nTEST G  unknown query stays UNKNOWN`);
  const out = resolveContext("someRandomNonExistingCapability zzzqqq", index);
  check("testG", out.status === "unknown", "status unknown (no guessing)");
  check("testG", out.safety.uncertainty === "none" || Array.isArray(out.safety.warnings), "safety block present");
}

console.log(failures === 0 ? "\nALL ACCEPTANCE + RELIABILITY CASES PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
