import { restoreVenueBrowserExecution } from "./venue-browser-execution.mjs";
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { PM_ORDER_LABEL_HELPER, restorePmOrderBetLabelSource } from "./pm-order-bet-label-boundary.mjs";
const readBeforeExecution = file => fs.readFileSync(file, "utf8");
const read = file => restoreVenueBrowserExecution(file, readBeforeExecution(file));
const orders = "packages/venue-adapter/polymarket/orders/history/orders.ts";
describe("PM order label scoped correction", () => {
  it("restores only the registered labels and lookup inputs", () => {
    const source = restorePmOrderBetLabelSource(orders, read(orders), read);
    expect(source).not.toContain("lookupPolymarketOrderBetLabel");
    expect(source).toContain("bet: base.bet || clob.bet");
  });
  it("rejects replacing the official label with the saved composer label", () => {
    expect(() => restorePmOrderBetLabelSource(orders, read(orders).replace("|| clob.bet || base.bet", "|| base.bet || clob.bet"), read)).toThrow();
  });
  it("rejects changing the new label helper while reconstructing an old protected module", () => {
    expect(() => restorePmOrderBetLabelSource(orders, read(orders), file => read(file) + (file === PM_ORDER_LABEL_HELPER ? "\nvoid 0;" : ""))).toThrow("exact PM order label helper");
  });
  it("restores GTC's label alone while keeping its trigger row and PM token binding protected", () => {
    const file = "client/web/src/orderModes/gtc/arbLeg.ts";
    const source = restorePmOrderBetLabelSource(file, read(file), read);
    expect(source).toContain("bet: params.bet.getBetName(), item: pm.target");
    expect(() => restorePmOrderBetLabelSource(file, read(file).replace("lookupPolymarketOrderBetLabel(pm.betId, pm.itemId)", "lookupPolymarketOrderBetLabel(other.betId, pm.itemId)"), read)).toThrow();
  });
});
