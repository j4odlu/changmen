import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readPmWalletDevOrigins } from "./scripts/pm-wallet-build-config.mjs";

test("PM build follows web env precedence and rejects invalid ports", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "changmen-pm-build-"));
  try {
    fs.writeFileSync(path.join(root, ".env"), "VITE_DEV_PORT=6107\n");
    fs.writeFileSync(path.join(root, ".env.development.local"), "VITE_DEV_PORT=6208\n");
    assert.deepEqual(readPmWalletDevOrigins(root, {}, "win32"), ["http://localhost:6208", "http://127.0.0.1:6208"]);
    assert.deepEqual(readPmWalletDevOrigins(root, { VITE_DEV_PORT: "6309" }, "win32"), ["http://localhost:6309", "http://127.0.0.1:6309"]);
    assert.throws(() => readPmWalletDevOrigins(root, { VITE_DEV_PORT: "70000" }), /VITE_DEV_PORT/);
  } finally {
    for (const name of [".env", ".env.development.local"]) fs.unlinkSync(path.join(root, name));
    fs.rmdirSync(root);
  }
});
