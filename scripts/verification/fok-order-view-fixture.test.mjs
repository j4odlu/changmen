import {withAdapterHistoryReader,readAdapterHistory} from "./browser-entry-history.mjs";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {historicalWorkspaceFs as fs} from './workspace-layout-history.mjs';
import { it } from "vitest";
import { checkOrdinaryOrderView } from "./fok-order-view-fixture.mjs";

const file = "client/web/src/components/order/OrderView.vue";
const original = execFileSync("git", ["show", `219535c8:${file}`], { encoding: "utf8" });
it("exact optional OrderView projection preserves the complete ordinary module", () => {
  assert(checkOrdinaryOrderView(readAdapterHistory(file, "utf8"), original).completeOrdinaryModuleEqual);
});
it("review rejects ordinary order behavior changed alongside the optional projection", () => {
  assert.throws(() => checkOrdinaryOrderView(readAdapterHistory(file, "utf8").replace("filterAccountId.value !== 0", "filterAccountId.value !== 1"), original), /complete ordinary OrderView module/);
});
it("review rejects a changed projection fallback", () => {
  assert.throws(() => checkOrdinaryOrderView(readAdapterHistory(file, "utf8").replace("?? previewOrderEntries.value", "?? []"), original), /exact RAY read-only preview extension/);
});
