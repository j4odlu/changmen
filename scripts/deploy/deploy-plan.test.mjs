import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

const script = fileURLToPath(new URL("../../deploy/scripts/deploy-server-remote.sh", import.meta.url));
const bash = process.platform === "win32" ? "C:/msys64/usr/bin/bash.exe" : "bash";
const shellPath = value => process.platform === "win32" ? value.replaceAll("\\", "/").replace(/^([A-Za-z]):/, (_, drive) => "/" + drive.toLowerCase()) : value;
function plan(paths, overrides = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "changmen-deploy-plan-"));
  try {
    mkdirSync(path.join(dir, "server/backend"), { recursive: true });
    mkdirSync(path.join(dir, "client/web"), { recursive: true });
    writeFileSync(path.join(dir, "package.json"), "{}");
    const marker = path.join(dir, "client/web/.deploy-needs-dist-upload");
    writeFileSync(marker, "preserve-me");
    const manifest = path.join(dir, "changes.txt");
    writeFileSync(manifest, paths.join("\n") + "\n");
    const result = spawnSync(bash, [shellPath(script)], { encoding: "utf8", env: {
      ...process.env, DEPLOY_REPO: shellPath(dir), DEPLOY_SKIP_GIT_PULL: "1", DEPLOY_CHANGED_PATHS_FILE: shellPath(manifest),
      DEPLOY_PLAN_ONLY: "1", DEPLOY_SKIP_APP_BUILD: "1", DEPLOY_FULL: "0", ...overrides,
    } });
    assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.equal(readFileSync(marker, "utf8"), "preserve-me", "plan must not mutate deployment files");
    return result.stdout;
  }
  finally { rmSync(dir, { recursive: true, force: true }); }
}
test("auth-only archive release compiles and restarts without rerunning schema/backfills", () => {
  const result = plan(["server/backend/core/auth/login_service.js", "server/db/rds/auth_store.js", "server/realtime-hub/hub.js"]);
  assert.match(result, /install=1 compile=1 web=1 schema=0 players=0 owner=0/);
});
test("an actual migration still requests schema application", () => {
  assert.match(plan(["server/backend/db/migrations/044_auth_browser_sessions.sql"]), /schema=1/);
});
test("frontend-only changes do not restart the backend or migrate", () => {
  assert.match(plan(["client/web/src/api/auth.ts"]), /compile=0 web=0 schema=0/);
});
test("explicit full release retains full-deploy behavior", () => {
  assert.match(plan(["server/backend/core/auth/identity.js"], { DEPLOY_FULL: "1" }), /full=1 install=1 compile=1 web=1/);
});
