import {withAdapterHistoryReader,readAdapterHistory} from "./browser-entry-history.mjs";
// [changmen 扩展] 实际源码的完整比较与负向验证，不重录任何快照。
import {historicalWorkspaceFs as fs} from './workspace-layout-history.mjs';
import { describe, expect, it } from "vitest";
import { gitSource, moduleTokens, verifyProtectedSource } from "./fok-exact-boundaries.mjs";
import { restoreGtcSnapshotMetadata, restorePmManualSellSplit } from "./pm-manual-sell-split-boundary.mjs";

const file = "client/web/src/stores/account/pmManualSell.ts";
const read = withAdapterHistoryReader(path => readAdapterHistory(path, "utf8"));
describe("private GTC persistence preserves all ordinary FOK work", () => {
  it("restores the complete committed mixed module and both original FOK baselines", () => {
    expect(restorePmManualSellSplit(file, read(file))).toBe(gitSource("3465fe5d", file));
    for (const base of ["219535c8", "75b1efac66625e5f2bc9884a965b244bfaf337ed"])
      expect(verifyProtectedSource(file, read(file), gitSource(base, file), read).exactBoundaryVerified).toBe(true);
  });
  it.each([
    ["wide dispatch", "if (buyRow.PmGtcExecutionId)", "if (buyRow.PmGtcExecutionId || true)"],
    ["wrong arguments", "persistGtcFilledSell(account, buyRow, ordersToSave)", "persistGtcFilledSell(account, buyRow, [])"],
    ["ordinary save", "await saveOrders(account, ordersToSave)", "await saveOrders(account, [])"],
    ["ordinary optimistic protection", "applyManualSellOrdersLocally(buyRow, ordersToSave)", "applyManualSellOrdersLocally(buyRow, [])"],
    ["GTC retry payload", "await saveGtcOrders(account, ordersToSave.map", "await saveGtcOrders(account, [].map"],
    ["extra helper export", "async function persistGtcFilledSell(", "export async function persistGtcFilledSell("],
    ["extra original export", "async function persistFilledSell(", "export async function persistFilledSell("],
  ])("rejects altered %s", (_, before, after) => {
    const source = read(file); expect(source).toContain(before);
    expect(() => restorePmManualSellSplit(file, source.replace(before, after))).toThrow();
  });
  it("rejects extra work elsewhere instead of hiding the whole private module", () => {
    expect(() => restorePmManualSellSplit(file, `${read(file)}\nvoid unexpectedTradingAction();`)).toThrow("complete committed manual sell module");
  });
});
describe("gTC snapshot metadata does not change financial fields or trust client snapshots", () => {
  const path = "server/backend/core/orderModes/orderMetadata.js";
  it("adds only the snapshot key to the two protected preservation lists", () => {
    expect(moduleTokens(restoreGtcSnapshotMetadata(read(path)))).toEqual(moduleTokens(gitSource("4dd2c5e967fbd2101e3c848f2d48c221ec7c4e72", path)));
  });
  it("unregistered permission work remains visible after restoration", () => {
    expect(moduleTokens(restoreGtcSnapshotMetadata(`${read(path)}\nvoid unexpectedTradingAction();`)))
      .not
      .toEqual(moduleTokens(gitSource("4dd2c5e967fbd2101e3c848f2d48c221ec7c4e72", path)));
  });
});
