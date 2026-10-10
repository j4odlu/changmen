import type { GtcExecution } from "@changmen/shared/pm_gtc";
import type { VenueOrder } from "@changmen/venue-adapter/contract";
import type { OrderRow } from "@/types/order";
import { resolvePmRemainingShares } from "@changmen/venue-adapter/polymarket";
import { beforeEach, describe, expect, it } from "vitest";
import { isDualPredictionArbGroup } from "@/extensions/arbBet/arbEarlyLockSell";
import { groupOrdersByEffectiveLink } from "@/shared/orderLink";
import { applyGtcLocalSell, gtcOrderProjection, partitionGtcOrderRows, projectGtcOrderRows, rememberGtcOrderIdentity, resetGtcOrderProjection, tagKnownGtcVenueOrders } from "./executionProjection";

const row = (patch: Partial<OrderRow> = {}): OrderRow => ({ OrderID: "fok", PlayerID: 1, Type: "Polymarket", Link: 1791558222471, PmSide: "buy", PmTokenId: "token", PmShares: 10, PmStakeUsdc: 5, Status: "None", ...patch });
const execution = (): GtcExecution => ({ id: "gtc", owner: "owner", orderId: "gtc-pm", plan: { playerId: 1, orderHash: "hash", otherPlayerId: 2, otherProvider: "RAY" }, other: { orderId: "gtc-ray" } } as GtcExecution);
beforeEach(resetGtcOrderProjection);
describe("gTC source isolation before original FOK grouping", () => {
  it("preserves the FOK array and every object without GTC", () => {
    const rows = [row(), row({ OrderID: "other", Type: "RAY" })];
    expect(partitionGtcOrderRows(rows).fok).toBe(rows);
    expect(projectGtcOrderRows(rows, "owner", "2026-10-09")).toBe(rows);
  });
  it("same Link never classifies an unrelated FOK as GTC", () => {
    const fok = row(); const gtc = row({ OrderID: "gtc-pm", PmGtcExecutionId: "gtc" });
    const split = partitionGtcOrderRows([gtc, fok]);
    expect(split.fok).toEqual([fok]); expect(split.fok[0]).toBe(fok);
    expect(split.gtc).toEqual([gtc]); expect(fok.PmGtcExecutionId).toBeUndefined();
  });
  it("a mixed Link keeps its original FOK dual-prediction eligibility", () => {
    const fok = [row(), row({ OrderID: "pf", PlayerID: 2, Type: "PredictFun", PfSide: "buy", PfHoldShares: 10, PfMarketId: "market", PfTokenId: "token" })];
    const before = groupOrdersByEffectiveLink(fok);
    expect(isDualPredictionArbGroup(fok)).toBe(true);
    const split = partitionGtcOrderRows([...fok, row({ OrderID: "gtc", PmGtcExecutionId: "g" })]);
    expect(groupOrdersByEffectiveLink(split.fok)).toEqual(before);
    expect(isDualPredictionArbGroup(split.fok)).toBe(isDualPredictionArbGroup(fok));
  });
  it("gTC alone supplies no orders to either old automatic selling scanner", () => {
    expect(partitionGtcOrderRows([row({ PmGtcExecutionId: "g" })]).fok).toEqual([]);
  });
  it("uses account/provider/id and follows children even if they precede their parent", () => {
    const buy = row({ OrderID: "BUY", PmGtcExecutionId: "g" });
    const sell = row({ OrderID: "sell", PmSide: "sell", PmBuyOrderId: "buy" });
    const otherAccount = row({ OrderID: "buy", PlayerID: 99 });
    const otherProvider = row({ OrderID: "buy", Type: "RAY" });
    const split = partitionGtcOrderRows([sell, otherAccount, buy, otherProvider]);
    expect(split.gtc.map(r => r.OrderID)).toEqual(["sell", "BUY"]);
    expect(split.fok).toEqual([otherAccount, otherProvider]);
    expect(sell.PmGtcExecutionId).toBeUndefined();
  });
  it("restores exact original PM and other-leg identities independently of current mode", () => {
    rememberGtcOrderIdentity(execution());
    const split = partitionGtcOrderRows([row({ OrderID: "GTC-PM" }), row({ OrderID: "gtc-ray", PlayerID: 2, Type: "RAY" }), row()]);
    expect(split.gtc).toHaveLength(2); expect(split.fok).toEqual([row()]);
  });
  it("does not use another owner's registry in an embedded workspace", () => {
    rememberGtcOrderIdentity(execution());
    const rows = [row({ OrderID: "gtc-pm" })];
    expect(projectGtcOrderRows(rows, "another-owner", "2026-10-09")).toBe(rows);
  });
  it("source annotation does not change FOK HTTP inputs or mutate venue objects", () => {
    rememberGtcOrderIdentity(execution());
    const fok = [{ orderId: "fok", provider: "Polymarket" }] as VenueOrder[];
    expect(tagKnownGtcVenueOrders(1, fok)).toBe(fok);
    const own = { orderId: "gtc-pm", provider: "Polymarket" } as VenueOrder;
    expect(tagKnownGtcVenueOrders(1, [own])[0]).toMatchObject({ pmGtcExecutionId: "gtc" });
    expect(own).not.toHaveProperty("pmGtcExecutionId");
    expect(tagKnownGtcVenueOrders(99, [own])[0]).toBe(own);
  });
  it("failed GTC manual-sell persistence updates only the independent projection", () => {
    const buy = row({ PmGtcExecutionId: "g" });
    projectGtcOrderRows([buy], "owner", "2026-10-09");
    expect(applyGtcLocalSell(buy, [{ ...buy, PmShares: 0 }])).toBe(true);
    expect(gtcOrderProjection.rows[0]?.PmShares).toBe(0);
    expect(applyGtcLocalSell(row(), [row()])).toBe(false);
  });
  it("reset removes rows and identities across logout/user switches", () => {
    rememberGtcOrderIdentity(execution()); projectGtcOrderRows([row({ PmGtcExecutionId: "g" })], "owner", "2026-10-09");
    resetGtcOrderProjection();
    expect(gtcOrderProjection.rows).toEqual([]);
    expect(partitionGtcOrderRows([row({ OrderID: "gtc-pm" })]).gtc).toEqual([]);
  });
  it("adapts GTC net shares once for the unchanged gross-minus-sales PM helpers", () => {
    const raw = row({ PmGtcExecutionId: "g", PmGtcBuyShares: 10, PmShares: 6, PmAttributedSellShares: 4 });
    const view = partitionGtcOrderRows([raw]).gtc[0]!;
    expect(resolvePmRemainingShares(view)).toBe(6);
    expect(raw.PmShares).toBe(6); expect(view.PmShares).toBe(10);
    const later = partitionGtcOrderRows([{ ...raw, PmGtcBuyShares: 14, PmShares: 10 }]).gtc[0]!;
    expect(resolvePmRemainingShares(later)).toBe(10);
    expect(partitionGtcOrderRows([view]).gtc[0]).toBe(view);
  });
});
