import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { readDevWebPort, resolveDevWebPort } from "./dev_web_config.js";

test("frontend and backend resolve the same configured development port", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "changmen-dev-port-"));
  try {
    fs.writeFileSync(path.join(root, ".env"), "VITE_DEV_PORT=5274\n");
    fs.writeFileSync(path.join(root, ".env.local"), "VITE_DEV_PORT=5576\n");
    assert.equal(readDevWebPort(root, {}, "win32"), resolveDevWebPort({ VITE_DEV_PORT: "5576" }, "win32"));
    fs.writeFileSync(path.join(root, ".env.development.local"), "VITE_DEV_PORT=6100\n");
    assert.equal(readDevWebPort(root, {}, "win32"), 6100);
    assert.equal(readDevWebPort(root, { VITE_DEV_PORT: "6200" }, "win32"), 6200);
    assert.equal(resolveDevWebPort({}, "win32"), 5274);
    assert.equal(resolveDevWebPort({}, "linux"), 5174);
    for (const value of ["NaN", "0", "-1", "65536", "5274.5"])
      assert.throws(() => resolveDevWebPort({ VITE_DEV_PORT: value }), /VITE_DEV_PORT/);
  }
  finally { fs.rmSync(root, { recursive: true, force: true }); }
});
