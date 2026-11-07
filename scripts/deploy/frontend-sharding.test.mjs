import assert from "node:assert/strict";
import { test } from "node:test";
import { frontendTestRuns, runFrontendTests } from "../../client/web/vite/runFrontendTests.mjs";

test("daily frontend invocation runs web and both listener suites without sharding", () => {
  const runs = frontendTestRuns(["--maxWorkers=2"]);
  assert.deepEqual(runs.map(run => run.suite), ["web", "listener-live", "listener-compat"]);
  assert(runs.every(run => run.args.includes("--maxWorkers=2")));
});
test("three shards cover web and run each listener suite exactly once without filtering it", () => {
  const shards = [1, 2, 3].map(index => frontendTestRuns([`--shard=${index}/3`, "--maxWorkers=2"]));
  for (const [index, runs] of shards.entries()) {
    assert.equal(runs[0].suite, "web");
    assert(runs[0].args.includes(`--shard=${index + 1}/3`));
  }
  const listeners = shards.flat().filter(run => run.suite !== "web");
  assert.deepEqual(listeners.map(run => run.suite), ["listener-live", "listener-compat"]);
  assert(listeners.every(run => !run.args.some(arg => arg.startsWith("--shard"))));
  assert.deepEqual(frontendTestRuns(["--shard", "1/3"]), frontendTestRuns(["--shard=1/3"]).map((run, index) =>
    index ? run : { ...run, args: ["run", "--shard", "1/3"] }));
});
test("invalid, duplicate and incomplete shards fail before starting tests", () => {
  for (const args of [["--shard"], ["--shard="], ["--shard=0/3"], ["--shard=4/3"], ["--shard=1/0"],
    ["--shard=1/3", "--shard=2/3"], ["--shard=1/3", "--shard"], ["--shard=01/3"], ["--shard=1/9007199254740992"]]) {
    let started = false;
    assert.throws(() => runFrontendTests(args, { run: () => { started = true; return { status: 0 }; } }), /shard/);
    assert.equal(started, false);
  }
});
test("web/listener failure, signal and launch error cannot produce a successful shard", () => {
  for (const failingSuite of [0, 1, 2]) {
    let calls = 0;
    assert.equal(runFrontendTests(["--shard=1/3"], { run: () => ({ status: calls++ === failingSuite ? 1 : 0 }) }), 1);
    assert.equal(calls, failingSuite + 1);
  }
  assert.equal(runFrontendTests(["--shard=2/3"], { run: () => ({ status: null, signal: "SIGTERM" }) }), 1);
  assert.throws(() => runFrontendTests([], { run: () => ({ error: new Error("spawn failed") }) }), /spawn failed/);
});
