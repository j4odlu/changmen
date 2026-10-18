import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { checkDatabaseCompatibility } from "./check-database-compatibility.mjs";
import { DATABASE_PHASES } from "./acceptance-contract.mjs";
function fixture(run) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "changmen-database-control-"));
  const git = (...args) => execFileSync("git", args, { cwd, stdio: "pipe" });
  try {
    git("init", "-q"); fs.writeFileSync(path.join(cwd, "input.js"), "original"); git("add", ".");
    git("-c", "user.name=Database Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "fixture");
    run(cwd);
  } finally { assert.equal(path.dirname(cwd), path.resolve(os.tmpdir())); fs.rmSync(cwd, { recursive: true, force: true }); }
}
test("every database phase has a durable log and source-bound result, without exposing child output", () => fixture(cwd => {
  const calls = [];
  const report = checkDatabaseCompatibility({ cwd, env: {}, run: (node, args, opts) => {
    calls.push(args[0]); fs.writeSync(opts.stdio[1], "synthetic database test output"); return { status: 0 };
  } });
  assert.equal(report.passed, true); assert.equal(report.sourceStable, true);
  assert.deepEqual(calls, DATABASE_PHASES.map(phase => `scripts/testing/${phase}-postgres.mjs`));
  for (const phase of DATABASE_PHASES)
    assert.match(fs.readFileSync(path.join(cwd, `output/database-compatibility/${phase}.log`), "utf8"), /synthetic/);
}));
test("failure, timeout and thrown spawn errors stop subsequent phases and replace an earlier success", () => fixture(cwd => {
  checkDatabaseCompatibility({ cwd, env: {}, run: () => ({ status: 0 }) });
  for (const failed of [{ status: 23 }, { status: null, error: { code: "ETIMEDOUT" } }, "throw"]) {
    let calls = 0;
    const report = checkDatabaseCompatibility({ cwd, env: {}, run: () => {
      calls++; if (failed === "throw") throw Object.assign(Error("synthetic"), { code: "ESPAWN" }); return failed;
    } });
    assert.equal(calls, 1); assert.equal(report.passed, false); assert.equal(report.results.length, 1);
    assert.equal(JSON.parse(fs.readFileSync(path.join(cwd, "output/database-compatibility/verdict.json"))).passed, false);
  }
}));
test("source edits and wrong CI checkouts cannot produce successful database acceptance", () => fixture(cwd => {
  let calls = 0;
  assert.throws(() => checkDatabaseCompatibility({ cwd, env: { GITHUB_SHA: "f".repeat(40) }, run: () => { calls++; return { status: 0 }; } }), /differs/);
  assert.equal(calls, 0);
  const report = checkDatabaseCompatibility({ cwd, env: {}, run: () => { fs.writeFileSync(path.join(cwd, "input.js"), "edited"); return { status: 0 }; } });
  assert.equal(report.sourceStable, false); assert.equal(report.passed, false);
}));
