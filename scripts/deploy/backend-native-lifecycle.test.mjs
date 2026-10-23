import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { verifyInstalledEsbuild } from "../testing/backend-native-lifecycle.mjs";

function fixture(t, implementation) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "changmen-native-lifecycle-"));
  t.after(() => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert(path.basename(root).startsWith("changmen-native-lifecycle-"));
    fs.rmSync(root, { recursive: true, force: true });
  });
  fs.mkdirSync(path.join(root, "server/backend"), { recursive: true });
  if (implementation !== undefined) {
    const dir = path.join(root, "node_modules/esbuild"); fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "package.json"), '{"name":"esbuild","main":"index.cjs"}');
    fs.writeFileSync(path.join(dir, "index.cjs"), implementation);
  }
  return root;
}
const working = 'exports.transformSync=(source,options)=>{if(source!=="const value: number = 42"||options.loader!=="ts")throw Error("wrong probe");return {code:"const value = 42;"};};';

test("production may omit the compiler after SDK retirement; the full build may not", t => {
  const root = fixture(t);
  assert.deepEqual(verifyInstalledEsbuild(root, "", { optional: true }), { installed: false, nativeExecuted: false });
  assert.throws(() => verifyInstalledEsbuild(root, ""), { code: "MODULE_NOT_FOUND" });
});
test("both installations verify a present compiler and require actual lifecycle evidence", t => {
  const root = fixture(t, working);
  for (const optional of [false, true]) {
    assert.deepEqual(verifyInstalledEsbuild(root, "> esbuild@0.25.12 postinstall\n> node install.js", { optional }), { installed: true, nativeExecuted: true });
    assert.throws(() => verifyInstalledEsbuild(root, "added 1 package", { optional }), /lifecycle must execute/);
  }
});
test("a broken native binary is never treated as an optional missing compiler", t => {
  const root = fixture(t, 'exports.transformSync=()=>{const error=Error("missing native binary");error.code="MODULE_NOT_FOUND";throw error;};');
  assert.throws(() => verifyInstalledEsbuild(root, "esbuild@0.25.12 postinstall", { optional: true }), /missing native binary/);
});
test("a present compiler that fails to transform TypeScript cannot pass", t => {
  const root = fixture(t, 'exports.transformSync=()=>({code:"const value: number = 42"});');
  assert.throws(() => verifyInstalledEsbuild(root, "esbuild@0.25.12 postinstall", { optional: true }));
});
test("a present package with a missing entry is not accepted as an absent dependency", t => {
  const root = fixture(t, working);
  fs.unlinkSync(path.join(root, "node_modules/esbuild/index.cjs"));
  assert.throws(() => verifyInstalledEsbuild(root, "", { optional: true }), { code: "MODULE_NOT_FOUND" });
});
