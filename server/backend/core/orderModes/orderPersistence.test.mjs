import { beforeEach, describe, expect, it, vi } from "vitest";
import { saveOrder } from "../account/order_store.js";
import { rowToOrder } from "../account/order/dto.js";
import { verifyOrderExecution } from "./orderMetadata.js";

const mocks = vi.hoisted(() => ({ previous: vi.fn(), ordinary: vi.fn(), gtc: vi.fn(), identities: vi.fn() }));
vi.mock("@changmen/db", async (importOriginal) => ({
  ...await importOriginal(),
  fetchOrdersByPlayerOrderIdsStrict: mocks.previous, upsertOrders: mocks.ordinary, upsertPmGtcOrders: mocks.gtc,
  fetchOrderExecutionIdentities: mocks.identities, placeholderLinkFromCreateAt: value => value,
}));
beforeEach(() => {
  vi.resetAllMocks(); mocks.previous.mockResolvedValue([]); mocks.ordinary.mockResolvedValue(true); mocks.gtc.mockResolvedValue(true);
});
const buy = (id = "fok") => ({ provider: "Polymarket", orderId: id, createAt: 1000, link: 123, betMoney: 67, pmShares: 20, pmFillPrice: 0.5, pmStakeUsdc: 10, pmSide: "buy", pmOrigin: "changmen" });
const canonical = () => ({ order_id: "GTC", provider: "Polymarket", create_at: 1000, link: 123, bet_money: 49.08353, money: 0, raw: {
  ...buy("GTC"), pmGtcExecutionId: "execution", pmGtcRevision: 4, pmGtcBuyShares: 9.29, pmGtcBuyCost: 7.3259,
  pmShares: 6, pmAttributedSellShares: 3.29, pmFillPrice: 0.78, pmStakeUsdc: 4.731, pmFeeUsdc: 0.07971,
} });
describe("order mode metadata reuses the ordinary strict read", () => {
  it("FOK uses one native strict read and its original writer, even if GTC is unavailable", async () => {
    mocks.identities.mockRejectedValue(new Error("unavailable")); mocks.gtc.mockRejectedValue(new Error("unavailable"));
    expect(await saveOrder(1, [buy()], "owner")).toBe(true);
    expect(mocks.previous).toHaveBeenCalledExactlyOnceWith(1, "owner", ["fok"]);
    expect(mocks.ordinary).toHaveBeenCalledOnce(); expect(mocks.gtc).not.toHaveBeenCalled(); expect(mocks.identities).not.toHaveBeenCalled();
    expect(mocks.ordinary.mock.calls[0][0][0].raw).not.toHaveProperty("pmGtcExecutionId");
  });
  it("an unmarked historical GTC snapshot retains its persisted identity and canonical cost", async () => {
    mocks.previous.mockResolvedValue([canonical()]);
    expect(await saveOrder(1, [{ ...buy("gtc"), betMoney: 999, pmGtcBuyCost: 999 }], "owner")).toBe(true);
    expect(mocks.previous).toHaveBeenCalledOnce(); expect(mocks.identities).not.toHaveBeenCalled(); expect(mocks.ordinary).not.toHaveBeenCalled();
    expect(mocks.gtc.mock.calls[0][0][0]).toMatchObject({ order_id: "GTC", raw: { pmGtcExecutionId: "execution", pmGtcRevision: 4, pmGtcBuyCost: 7.3259, pmGtcBuyShares: 9.29 } });
  });
  it("a new sell inherits its original mode from the already prefetched parent", async () => {
    mocks.previous.mockResolvedValue([canonical()]);
    await saveOrder(1, [{ ...buy("sell"), pmSide: "sell", pmBuyOrderId: "gtc", pmShares: 1 }], "owner");
    expect(mocks.previous).toHaveBeenCalledExactlyOnceWith(1, "owner", ["sell", "gtc"]);
    expect(mocks.ordinary.mock.calls[0][0][0].raw.pmGtcExecutionId).toBe("execution");
    expect(mocks.gtc).not.toHaveBeenCalled(); expect(mocks.identities).not.toHaveBeenCalled();
  });
  it("a parent ID from a different provider cannot relabel a FOK sell", async () => {
    mocks.previous.mockResolvedValue([{ ...canonical(), provider: "PredictFun" }]);
    await saveOrder(1, [{ ...buy("sell"), pmSide: "sell", pmBuyOrderId: "gtc" }], "owner");
    expect(mocks.ordinary.mock.calls[0][0][0].raw).not.toHaveProperty("pmGtcExecutionId");
    expect(mocks.gtc).not.toHaveBeenCalled();
  });
  it("a GTC identity without canonical fill cost uses the ordinary cost writer", async () => {
    const row = canonical(); delete row.raw.pmGtcBuyCost;
    mocks.previous.mockResolvedValue([row]);
    await saveOrder(1, [buy("gtc")], "owner");
    expect(mocks.ordinary.mock.calls[0][0][0].raw.pmGtcExecutionId).toBe("execution");
    expect(mocks.gtc).not.toHaveBeenCalled();
  });
  it("same Link cannot relabel an unrelated FOK order and a locked GTC refresh cannot block it", async () => {
    mocks.previous.mockResolvedValue([canonical()]); mocks.gtc.mockReturnValue(new Promise(() => {}));
    expect(await saveOrder(1, [buy(), buy("gtc")], "owner")).toBe(true);
    expect(mocks.ordinary.mock.calls[0][0]).toHaveLength(1);
    expect(mocks.ordinary.mock.calls[0][0][0].order_id).toBe("fok");
    expect(mocks.ordinary.mock.calls[0][0][0].raw).not.toHaveProperty("pmGtcExecutionId");
    expect(mocks.previous).toHaveBeenCalledOnce();
  });
  it("the native strict read still fails closed without adding a fallback read", async () => {
    mocks.previous.mockRejectedValue(new Error("ordinary DB unavailable"));
    expect(await saveOrder(1, [buy()], "owner")).toBe(false);
    expect(mocks.previous).toHaveBeenCalledOnce(); expect(mocks.ordinary).not.toHaveBeenCalled(); expect(mocks.gtc).not.toHaveBeenCalled();
  });
  it("JSON metadata cannot invent a GTC identity or canonical financial facts", async () => {
    await saveOrder(1, [{ ...buy(), pmGtcExecutionId: "fake", pmGtcBuyShares: 999, pmGtcBuyCost: 999 }], "owner");
    const raw = mocks.ordinary.mock.calls[0][0][0].raw;
    expect(raw).not.toHaveProperty("pmGtcExecutionId"); expect(raw).not.toHaveProperty("pmGtcBuyCost");
  });
  it("the validated GTC endpoint can establish metadata while using the ordinary cost calculation", async () => {
    const order = { ...buy(), provider: undefined }; verifyOrderExecution(order, "execution");
    await saveOrder(1, [order], "owner", "Polymarket");
    expect(mocks.ordinary.mock.calls[0][0][0]).toMatchObject({ bet_money: 67, raw: { pmGtcExecutionId: "execution", pmStakeUsdc: 10 } });
  });
  it("ordinary DTO contains mode, gross shares and fill-price odds without a coordinator lookup", () => {
    const row = rowToOrder(canonical());
    expect(row).toMatchObject({ PmGtcExecutionId: "execution", PmShares: 9.29, PmGtcBuyShares: 9.29, BetMoney: 49.08353 });
    expect(row.Odds).toBeUndefined(); expect(mocks.identities).not.toHaveBeenCalled();
  });
});
