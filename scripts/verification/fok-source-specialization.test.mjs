import {withAdapterHistoryReader,readAdapterHistory} from "./browser-entry-history.mjs";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {historicalWorkspaceFs as fs} from './workspace-layout-history.mjs';
import { test } from "node:test";
import { specializeFokSource } from "./fok-source-specialization.mjs";
import { moduleTokens } from "./fok-exact-boundaries.mjs";

const paths = ["client/web/src/shared/orderLink.ts", "client/web/src/stores/account/pmManualSell.ts"];
for (const file of paths) {
  const source = readAdapterHistory(file, "utf8");
  for (const base of ["219535c8", "75b1efac66625e5f2bc9884a965b244bfaf337ed"]) {
    test(`${file}: entire FOK source matches fixed ${base} after only the explicit boundary`, () => {
      const original = execFileSync("git", ["show", `${base}:${file}`], { encoding: "utf8" }).replace(/\r\n/g, "\n");
      assert.deepEqual(moduleTokens(specializeFokSource(file, source)), moduleTokens(original));
    });
  }
}
test("a guard with a wider condition is rejected rather than stripped", () => {
  const file = paths[0]; const source = readAdapterHistory(file, "utf8");
  assert.throws(() => specializeFokSource(file, source.replace("if (row.DisplayOnly)", "if (row.DisplayOnly || row.Type === 'RAY')")));
});
test("changing the ordinary rebind rule is rejected by the complete display-source check", () => {
  const file = paths[0]; const source = readAdapterHistory(file, "utf8");
  assert.ok(source.includes("link !== 0"));
  assert.throws(() => specializeFokSource(file, source.replace("link !== 0", "link !== 10")), /complete source outside makeup odds display change/);
});
test("changing the FOK retry payload remains visible to comparison", () => {
  const file = paths[1]; const source = readAdapterHistory(file, "utf8");
  assert.throws(() => specializeFokSource(file, source.replace("await saveOrders(account, ordersToSave)", "await saveOrders(account, [])")), /complete ordinary FOK persistence body/);
});
test("an additional call to the private GTC helper is rejected", () => {
  const file = paths[1]; const source = readAdapterHistory(file, "utf8");
  assert.throws(() => specializeFokSource(file, `${source}\npersistGtcFilledSell(account, row, orders);\n`));
});
test("unrelated files cannot receive a source exemption", () => {
  const source = "if (row.DisplayOnly) return false;\n";
  assert.equal(specializeFokSource("client/web/src/stores/account/betGateway.ts", source), source);
});
