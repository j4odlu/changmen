import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { changedDeployedFiles } from "./compare-deployed-files.mjs";

test("unchanged migrations are excluded even when release history is stale", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "changmen-source-compare-"));
  try {
    for (const root of ["source", "live"]) {
      mkdirSync(path.join(dir, root, "server/backend/db/migrations"), { recursive: true });
      writeFileSync(path.join(dir, root, "server/backend/db/migrations/044.sql"), "same SQL");
      writeFileSync(path.join(dir, root, "package.json"), "{}");
    }
    writeFileSync(path.join(dir, "source/server/backend/auth.js"), "new auth");
    assert.deepEqual(changedDeployedFiles(path.join(dir, "source"), path.join(dir, "live")), ["server/backend/auth.js"]);
    writeFileSync(path.join(dir, "source/server/backend/db/migrations/044.sql"), "changed SQL");
    assert.deepEqual(changedDeployedFiles(path.join(dir, "source"), path.join(dir, "live")), ["server/backend/auth.js", "server/backend/db/migrations/044.sql"]);
  }
  finally { rmSync(dir, { recursive: true, force: true }); }
});
