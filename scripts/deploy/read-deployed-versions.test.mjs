import assert from "node:assert/strict";
import { test } from "node:test";
import { assertPublishedVersions, publishedVersionsProgram } from "./read-deployed-versions.mjs";

const frontend = "a".repeat(40), backend = "b".repeat(40);
const snapshot = () => ({
  frontend: `/root/changmen/.releases/frontend/frontend-${frontend}-123-1`,
  backend: `/root/changmen/.releases/backend/backend-${backend}-120-2`,
  markers: { frontend: `123 ${frontend}`, backend: `120 ${backend}` },
  frontendRuntime: { frontend: { commit: frontend } },
});
test("published component versions require only filesystem records", () => {
  assert.deepEqual(assertPublishedVersions(snapshot()), { frontend, backend });
  assert.doesNotMatch(publishedVersionsProgram, /fetch\(|http:|https:|pm2|SELECT|pg\.Client/);
});
test("mismatched or missing publication records fail closed", () => {
  for (const mutate of [
    s => { s.markers.backend = `120 ${frontend}`; },
    s => { s.frontendRuntime.frontend.commit = backend; },
    s => { delete s.markers.frontend; },
    s => { s.backend = "/root/changmen"; },
  ]) {
    const value = snapshot(); mutate(value);
    assert.throws(() => assertPublishedVersions(value));
  }
});
