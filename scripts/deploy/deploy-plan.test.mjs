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
  const result = plan(["server/backend/core/auth/login_service.js", "server/db/rds/auth_store.js", "server/db/impl_rds.js", "server/realtime-hub/hub.js"]);
  assert.match(result, /install=1 compile=1 web=1/);
});
test("database migrations do not deploy applications", () => {
  assert.match(plan(["server/backend/db/migrations/044_auth_browser_sessions.sql"]), /install=0 compile=0 web=0/);
});
test("frontend-only changes do not restart the backend or migrate", () => {
  assert.match(plan(["client/web/src/api/auth.ts"]), /compile=0 web=0/);
});
test("explicit full release retains full-deploy behavior", () => {
  assert.match(plan(["server/backend/core/auth/identity.js"], { DEPLOY_FULL: "1" }), /full=1 install=1 compile=1 web=1/);
});
test('certificate schema does not deploy applications', () => {
  assert.match(plan(['server/db/schema/client_certificates.sql']), /install=0 compile=0 web=0/);
});

test('isolated release identifies certificate changes and skips install/compile', () => {
  assert.match(plan(['server/db/schema/client_certificates.sql'], { DEPLOY_RELEASE_MODE: '1' }),
    /install=0 compile=0 web=1/);
});

test('isolated release still identifies actual account schema changes', () => {
  assert.match(plan(['server/backend/db/migrations/044_auth_browser_sessions.sql'], { DEPLOY_RELEASE_MODE: '1' }), /install=0 compile=0 web=1/);
});

for (const file of [
  "server/backend/core/db/store.js", "server/backend/core/account/account_store.js",
  "server/db/rds/player_store.js", "server/db/player_account_record.js",
]) {
  test(`ordinary account code change never requests legacy data backfill: ${file}`, () => {
    assert.match(plan([file]), new RegExp(`install=1 compile=${file.startsWith("server/backend/") ? 1 : 0} web=1`));
    assert.match(plan([file], { DEPLOY_RELEASE_MODE: "1" }), /install=0 compile=0 web=1/);
  });
}
test("schema helpers and legacy SQL do not request application deployment", () => {
  for (const file of ["server/backend/scripts/apply-rds-schema.mjs", "server/backend/db/migrations/028_players_account_data.sql",
    "server/backend/scripts/apply-order-observation-schema.mjs", "server/backend/scripts/ops/migrations/backfill.mjs", "server/backend/scripts/ops/diagnostics/check-rds-schema.mjs"]) {
    assert.match(plan([file]), /install=0 compile=0 web=0/);
    assert.match(plan([file, "server/backend/core/auth/login_service.js"]), /install=1 compile=1 web=1/);
  }
});
