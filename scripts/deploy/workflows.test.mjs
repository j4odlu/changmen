import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import YAML from "yaml";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { validationCommands } from "../verification/verify-change.mjs";
const read = p => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const workflow = name => YAML.parse(read(`.github/workflows/${name}.yml`));
const release = workflow("release");

test("one push entry covers every path and validates before either component", () => {
  assert.deepEqual(release.on.push.branches, ["master"]);
  assert.equal(release.on.push.paths, undefined, "Unknown dependencies must reach classification");
  assert.equal(release.concurrency["cancel-in-progress"], false);
  assert.equal(release.concurrency.queue, "max");
  assert.ok(release.jobs.validate.steps.some(s => s.run === "node scripts/deploy/read-deployed-versions.mjs"));
  assert.deepEqual(release.jobs.backend.needs, "validate");
  assert.deepEqual(release.jobs.frontend.needs, ["validate", "backend"]);
  const condition = release.jobs.frontend.if;
  for (const part of ["needs.validate.result == 'success'", "needs.backend.result == 'success'", "needs.backend.result == 'skipped'", "!cancelled()"])
    assert.ok(condition.includes(part), part);
});
test("shared acceptance is run once, and artifacts are sealed only after success", () => {
  const steps = release.jobs.validate.steps;
  const checks = steps.findIndex(s => s.run?.startsWith("npm run check:change "));
  const seal = steps.findIndex(s => s.run === "node scripts/deploy/release-evidence.mjs seal");
  const upload = steps.findIndex(s => s.uses?.startsWith("actions/upload-artifact@") && s.with.name === "verified-release");
  assert.ok(checks >= 0 && checks < seal && seal < upload);
  assert.equal(steps[seal].if, undefined);
  assert.equal(steps[seal]["continue-on-error"], undefined);
  assert.equal(steps[upload].with["if-no-files-found"], "error");
  assert.ok(!JSON.stringify(steps[checks]).includes("secrets."));
  assert.equal(steps.filter(s => s.run?.includes("check:change --")).length, 1);
  assert.equal(steps.find(s => s.uses?.startsWith("actions/checkout@")).with["fetch-depth"], 0);
  assert.deepEqual(release.on.workflow_dispatch.inputs.component.options, ["full", "backend", "frontend"]);
});
test("component transports consume the same checked artifact and never rebuild", () => {
  for (const scope of ["frontend", "backend"]) {
    const component = workflow(`deploy-${scope}`);
    assert.equal(component.on.push, undefined);
    assert.ok(Object.hasOwn(component.on, "workflow_call"));
    const steps = component.jobs.deploy.steps;
    assert.equal(steps.find(s => s.uses?.startsWith("actions/checkout@")).with.ref, "${{ github.sha }}");
    assert.equal(steps.find(s => s.uses?.startsWith("actions/download-artifact@")).with.name, "verified-release");
    assert.ok(!steps.some(s => /npm (?:ci|run)|app:build/.test(s.run ?? "")));
    assert.ok(steps.some(s => s.run === `bash scripts/deploy/publish.sh ${scope}`));
    assert.equal(component.concurrency["cancel-in-progress"], false);
  }
  assert.notEqual(workflow("deploy-frontend").concurrency.group, workflow("deploy-backend").concurrency.group);
});
test("local entry points share acceptance and seal before transport; transport rejects stale proof before SSH", () => {
  for (const scope of ["frontend", "backend"]) {
    const entry = read(`sh/deploy-${scope}.sh`);
    assert.ok(entry.indexOf(`npm run check:change -- --publish=${scope}`) < entry.indexOf("release-evidence.mjs seal"));
    assert.ok(entry.indexOf("release-evidence.mjs seal") < entry.indexOf("publish.sh"));
  }
  const publish = read("scripts/deploy/publish.sh");
  assert.ok(publish.indexOf("release-evidence.mjs verify") < publish.indexOf("ssh-keyscan"));
  assert.ok(publish.includes('sequence="${GITHUB_RUN_ID:-0}"'));
  assert.ok(!publish.includes("tar -C client/web/dist"));
});
test("backend check still covers every server workspace and its dependencies", () => {
  const command = validationCommands({}, "npm-cli.js", "backend-first").backend.command;
  assert.deepEqual(command.slice(2), ["run", "test:backend", "--", "--force"]);
  const root = JSON.parse(read("package.json"));
  const filter = root.scripts["test:backend"].match(/--filter=(\S+)/)[1];
  const graph = JSON.parse(execFileSync(process.execPath, [
    fileURLToPath(new URL("../../node_modules/turbo/bin/turbo", import.meta.url)),
    "run", "test", `--filter=${filter}`, "--dry=json",
  ], { cwd: fileURLToPath(new URL("../../", import.meta.url)), encoding: "utf8" }));
  assert.ok(!graph.tasks.some(t => t.taskId === "@changmen/web#test"));
  for (const workspace of root.workspaces.filter(p => p.startsWith("server/"))) {
    const paths = workspace.endsWith("/*") ? readdirSync(new URL(`../../${workspace.slice(0, -1)}`, import.meta.url), { withFileTypes: true })
      .filter(entry => entry.isDirectory()).map(entry => workspace.replace("*", entry.name)) : [workspace];
    for (const p of paths) {
      const pkg = JSON.parse(read(`${p}/package.json`));
      if (pkg.scripts?.test) assert.ok(graph.tasks.some(t => t.taskId === `${pkg.name}#test`), pkg.name);
    }
  }
  assert.equal(graph.tasks.filter(t => t.taskId === "@changmen/match-identity#test").length, 1);
});
