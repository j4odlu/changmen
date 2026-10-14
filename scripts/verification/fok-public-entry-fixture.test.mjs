import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { it } from "vitest";
import { gitSource, moduleTokens } from "./fok-exact-boundaries.mjs";
import { publicFiles, verifyActualPublicModule } from "./public-release-boundaries.mjs";

const baseline = "75b1efac66625e5f2bc9884a965b244bfaf337ed";
const frontend = "e901bb596952256284cd8a9eb8b73b572c963915";
const backend = "832f3f76c30d6ad741ce850a68cd6ba1da7d06f9";
const snapshot = { captureId: "offline-fixture", frontendVersion: frontend, backendVersion: backend, immutableBaseline: baseline,
  sources: Object.fromEntries(publicFiles.map(file => [file, gitSource(file.startsWith("server/") ? backend : frontend, file)])) };

function check(change = source => source, baselineRead = gitSource) {
  const checker = fs.readFileSync("scripts/verification/verify-fok-public-entries.mjs", "utf8").replace(/^import .*;\r?\n/gm, "");
  vm.runInNewContext(checker, { assert, ts, gitSource: baselineRead, moduleTokens, verifyActualPublicModule, fs: { ...fs, readFileSync(file, options) {
    if (file === "output/vps-fok-baseline.json") return JSON.stringify(snapshot);
    const source = fs.readFileSync(file, options);
    return file === "server/backend/core/esport-api/pm_pf_routes.ts" ? change(source) : source;
  }, writeFileSync() {} }, process: { stdout: { write() {} } } }, { timeout: 30000 });
}
it("current GTC monitor action fixture preserves all five ordinary public modules", () => check());
it("monitor action fixture cannot hide an altered ordinary PM response", () => {
  assert.throws(() => check(source => source.replace("return snapshot.ok ? ok(snapshot.info) : fail(snapshot.msg);", "return fail(\"changed\");")), /complete actual public module/);
});
it("monitor action fixture rejects an additional unregistered action", () => {
  assert.throws(() => check(source => source.replace("\"Pm_GtcMonitorOrders\",", "\"Pm_GtcUnexpected\", \"Pm_GtcMonitorOrders\",")), /exact boundary occurrence/);
});
it("independent release provenance cannot replace the original FOK source check", () => {
  assert.throws(() => check(undefined, (base, file) => gitSource(base, file) + "\nvoid unexpectedOriginalTrade();"), /complete existing executable module/);
});
