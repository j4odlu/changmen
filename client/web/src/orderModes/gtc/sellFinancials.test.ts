import type { VenueOrder } from "@changmen/venue-adapter/contract";
import type { PlatformAccount } from "@/models/platformAccount";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { reconcileGtcSellFinancials } from "./sellFinancials";
const mocks = vi.hoisted(() => ({ cash: vi.fn() }));
vi.mock("@changmen/venue-adapter/polymarket/gtc", () => ({ readGtcSellCash: mocks.cash }));
const account = { provider: "Polymarket", accountId: 292 } as PlatformAccount;
const rows = () => [{ orderId: "buy", provider: "Polymarket", pmSide: "buy", pmSellProceeds: 2.4, pmRealizedPnlUsdc: 0.36, money: 2,
  positionEvents: { sells: [{ id: "sell", at: 1, shares: 4, proceeds: 2.4 }] } },
{ orderId: "sell", provider: "Polymarket", pmSide: "sell", pmBuyOrderId: "buy", pmGtcExecutionId: "own", betMoney: 16.08 }] as unknown as VenueOrder[];
beforeEach(() => { vi.clearAllMocks(); mocks.cash.mockResolvedValue(2.352); });
describe("GTC manual sale money normalization", () => {
  it("uses net proceeds and USDC realised amount instead of rounded prior CNY", async () => {
    const original = rows(); const result = await reconcileGtcSellFinancials(account, original);
    expect(result[0]).toMatchObject({ pmSellProceeds: 2.352, pmRealizedPnlUsdc: 0.312, money: 2.0904 });
    expect(result[0]?.positionEvents?.sells?.[0]?.proceeds).toBe(2.352);
    expect(result[1]?.betMoney).toBeCloseTo(15.7584);
    expect(original[0]?.money).toBe(2);
  });
  it("does not query fees or activity for unsold GTC, FOK or unrelated rows", async () => {
    await reconcileGtcSellFinancials(account, [rows()[0]!, { ...rows()[1]!, pmGtcExecutionId: undefined } as VenueOrder]);
    expect(mocks.cash).not.toHaveBeenCalled();
  });
  it("cash corrections do not use a prior sell CNY mirror rounded to two decimals", async () => {
    const original = rows();
    original[0]!.pmSellProceeds = 2.4078; original[0]!.pmRealizedPnlUsdc = 0.3678;
    original[0]!.positionEvents!.sells![0]!.proceeds = 2.4078;
    original[1]!.betMoney = 16.15;
    const result = await reconcileGtcSellFinancials(account, original);
    expect(result[0]).toMatchObject({ pmSellProceeds: 2.352, pmRealizedPnlUsdc: 0.312, money: 2.0904 });
  });
  it("retains a failed cash proof for the existing sale retry rather than inventing proceeds", async () => {
    mocks.cash.mockRejectedValue(new Error("原卖单净回款待核实"));
    await expect(reconcileGtcSellFinancials(account, rows())).rejects.toThrow("净回款待核实");
  });
});
