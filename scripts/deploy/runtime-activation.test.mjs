import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const bash = process.platform === "win32" ? "C:/msys64/usr/bin/bash.exe" : "bash";
const shellPath = p => process.platform === "win32" ? p.replaceAll("\\", "/").replace(/^([A-Za-z]):/, (_, d) => `/${d.toLowerCase()}`) : p;
const script = fileURLToPath(new URL("../../deploy/scripts/deploy-server-remote.sh", import.meta.url));
function fixture(run) {
  const parent = path.resolve(os.tmpdir()), root = fs.mkdtempSync(path.join(parent, "changmen-runtime-recovery-"));
  try {
    for (const dir of ["bin", "previous/server/backend", "previous/client/web", "previous/deploy"])
      fs.mkdirSync(path.join(root, dir), { recursive: true });
    fs.writeFileSync(path.join(root, "previous/package.json"), "{}");
    fs.writeFileSync(path.join(root, "previous/deploy/ecosystem.config.cjs"), "module.exports={apps:[]};");
    fs.writeFileSync(path.join(root, "pm2.log"), "");
    // Real activation script, no checker in the previous release, no real processes/network.
    for (const name of ["node", "npm"])
      fs.writeFileSync(path.join(root, "bin", name), "#!/usr/bin/env bash\necho 'unexpected database/build command' >&2\nexit 77\n", { mode: 0o755 });
    fs.writeFileSync(path.join(root, "bin/pm2"), '#!/usr/bin/env bash\nprintf "%s\\n" "$*" >> "$RECOVERY_PM2_LOG"\nif [[ "$1" == describe ]]; then exit 1; fi\n', { mode: 0o755 });
    const invoke = extra => spawnSync(bash, ["-c", 'export PATH="$RECOVERY_BIN:/usr/bin:/bin:$PATH"; exec bash "$RECOVERY_SCRIPT"'], {
      encoding: "utf8", windowsHide: true, timeout: 15000,
      env: { ...process.env, DEPLOY_REPO: shellPath(path.join(root, "previous")), DEPLOY_RELEASE_MODE: "1",
        DEPLOY_FULL: "0", DEPLOY_CHANGED_PATHS_FILE: "",
        DEPLOY_SKIP_GIT_PULL: "1", DEPLOY_SKIP_APP_BUILD: "1", DEPLOY_SKIP_POSTCHECK: "1", DEPLOY_PLAN_ONLY: "0",
        RECOVERY_BIN: shellPath(path.join(root, "bin")), RECOVERY_SCRIPT: shellPath(script),
        RECOVERY_PM2_LOG: shellPath(path.join(root, "pm2.log")), ...extra },
    });
    run({ root, invoke, log: () => fs.readFileSync(path.join(root, "pm2.log"), "utf8") });
  } finally {
    assert.equal(path.dirname(path.resolve(root)), parent);
    assert(path.basename(root).startsWith("changmen-runtime-recovery-"));
    fs.rmSync(root, { recursive: true, force: true });
  }
}
test("candidate activation restores a previous release with no new checker or migration tools", () => fixture(({ root, invoke, log }) => {
  assert(!fs.existsSync(path.join(root, "previous/server/backend/scripts/check-rds-schema.mjs")));
  const result = invoke({});
  assert.equal(result.status, 0, result.stderr + result.stdout);
  const starts = log().split("\n").filter(line => line.startsWith("start "));
  assert.equal(starts.length, 8);
  assert(starts.every(line => line.includes("previous/deploy/ecosystem.config.cjs")));
  assert.equal(starts.filter(line => line.includes("--only changmen-esport ")).length, 1);
}));
test("maintenance-only legacy entry performs no process or build operations", () => fixture(({ root, invoke, log }) => {
  const manifest = path.join(root, "changes.txt");
  fs.writeFileSync(manifest, "server/backend/db/migrations/044_auth_browser_sessions.sql\n");
  const result = invoke({ DEPLOY_RELEASE_MODE: "0", DEPLOY_CHANGED_PATHS_FILE: shellPath(manifest) });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.equal(log(), "");
}));

test("managed activation invokes no database or build tools even with full flag", () => fixture(({ invoke, log }) => {
  const result = invoke({ DEPLOY_FULL: "1" });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.equal(log().split("\n").filter(line => line.startsWith("start ")).length, 8);
}));
