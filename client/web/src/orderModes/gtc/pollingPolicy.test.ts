import { describe, expect, it } from "vitest";
import type { GtcExecution } from "@changmen/shared/pm_gtc";
import type { OrderRow } from "@/types/order";
import { createGtcExecution } from "@changmen/shared/pm_gtc";
import { gtcExecutionDormant, gtcPmReconciled, gtcNeedsOtherPolling } from "./pollingPolicy";
import { gtcOrderCardView } from "./orderCardView";
import { gtcSyncIssue, gtcSyncNotice } from "./syncStatus";

function done(): GtcExecution {
  const row = createGtcExecution("own", "owner", "wallet", "maker", { playerId: 1, otherPlayerId: 2,
    otherProvider: "RAY", shares: "10", orderHash: "buy", source: "manual" } as GtcExecution["plan"], 1);
  return { ...row, decision: "closed", submit: "accepted", pmAuthorized: true, orderId: "buy", terminal: true, complete: true, open: "0", matched: "10",
    order: { id: "buy", original: "10", matched: "10", status: "MATCHED", tradeIds: ["t"] },
    fills: { t: { key: "t", tradeId: "t", bucket: "maker", role: "MAKER", status: "CONFIRMED", shares: "10", price: "0.5", fee: "0", updatedAt: 1 } } };
}
const settled = (): OrderRow[] => [{ Type: "Polymarket", PlayerID: 1, OrderID: "buy", PmGtcExecutionId: "own", Status: "Win" }];
describe("GTC synchronization status and stopping policy", () => {
  it("login/query errors are labeled as sync issues while actual fill conflicts remain order evidence errors", () => {
    const row = done(); row.error = "登录服务暂时不可用，请稍后重试";
    expect(gtcOrderCardView(row)).toMatchObject({ state: "全部成交", detailError: "", queryErrorKind: "auth" });
    expect(gtcSyncNotice(gtcSyncIssue(new Error(row.error)))).toContain("同步提示：登录服务");
    row.error = "GTC 本次原单查询未返回记录";
    expect(gtcOrderCardView(row)).toMatchObject({ detailError: "", queryErrorKind: "query" });
    row.error = "同一成交明细数量或价格冲突";
    expect(gtcOrderCardView(row).detailError).toBe(row.error);
  });
  it("stops old reconciled terminal fills, and becomes dormant only after financial settlement", () => {
    expect(gtcPmReconciled(done())).toBe(true);
    expect(gtcExecutionDormant(done(), [])).toBe(false);
    expect(gtcExecutionDormant(done(), settled())).toBe(true);
  });
  it.each(["win", "lose", "return"])("does not infer another original's %s result from the match, link or another account", status => {
    const row = done(); row.other = { ...row.other, state: "filled", orderId: "ray" };
    const other = { Type: "RAY", PlayerID: 2, OrderID: "ray", PmGtcExecutionId: "own", Status: status };
    expect(gtcNeedsOtherPolling(row, settled())).toBe(true);
    expect(gtcNeedsOtherPolling(row, [...settled(), { ...other, PlayerID: 99 }])).toBe(true);
    expect(gtcExecutionDormant(row, [...settled(), other])).toBe(true);
  });
  it.each(["MATCHED", "MINED", "RETRYING"])("keeps querying provisional fills: %s", status => {
    const row = done(); row.fills.t!.status = status as never;
    expect(gtcPmReconciled(row)).toBe(false);
  });
  it("does not stop just because a match is over, or because fees/remaining shares are unknown", () => {
    for (const patch of [{ terminal: false }, { open: "2" }, { open: null }, { complete: false }, { error: "成交费用待核实" }])
      expect(gtcExecutionDormant({ ...done(), ...patch }, settled())).toBe(false);
    const row = done(); row.fills.t!.role = "TAKER"; row.fills.t!.fee = null;
    expect(gtcPmReconciled(row)).toBe(false);
  });
  it("a canceled partial fill and zero-fill cancellation can stop after full fact confirmation", () => {
    const row = done(); row.matched = "4"; row.order!.matched = "4"; row.fills.t!.shares = "4";
    expect(gtcExecutionDormant(row, settled())).toBe(true);
    row.matched = "0"; row.order!.matched = "0"; row.order!.tradeIds = []; row.fills = {};
    expect(gtcExecutionDormant(row, [])).toBe(true);
  });
});
