import { expect, it, vi } from "vitest";
import { Currency, getExchange } from "@changmen/shared/currency";
import type { OrderRow } from "@/types/order";
import { predictionDisplay } from "./orderListPredictionPresentation";

function quotes() {
  return {
    pmShowLivePrice: vi.fn(() => true), pmShowLiveOdds: vi.fn(() => true), pmLivePriceText: vi.fn(() => "0.6"),
    pmLastLineOddsText: vi.fn(() => "1.666"), pmLiveUnrealizedPnlText: vi.fn(() => "浮盈：+14"), pmLiveUnrealizedPnlCny: vi.fn(() => 14),
    pfShowLivePrice: vi.fn(() => false), pfShowLiveOdds: vi.fn(() => false), pfLivePriceText: vi.fn(() => "—"),
    pfLastLineOddsText: vi.fn(() => "2.000"), pfLiveUnrealizedPnlText: vi.fn((): string | null => null), pfLiveUnrealizedPnlCny: vi.fn((): number | null => null),
  };
}
const buy: OrderRow = { Type: "Polymarket", PmSide: "buy", OrderID: "pm", Status: "None", BetMoney: 72,
  PmFillPrice: 0.5, PmSubmittedPrice: 0.51, PmShares: 20, PmStakeUsdc: 10 };

it("preserves Pending confirmation and submitted quotes without displaying raw profit", () => {
  const row = Object.freeze({ ...buy, Status: "Pending", Money: 999 });
  const model = predictionDisplay(row, [row], quotes());
  expect(model?.side).toBe("buy");
  if (model?.side !== "buy") throw Error("Expected buy presentation");
  expect(model.profit).toMatchObject({ amountLabel: "申请金额", amountText: "72", profitText: "待确认" });
  expect(model.quote).toMatchObject({ priceLabel: "提交限价", priceText: "0.51", oddsText: "1.960", showOdds: true });
  expect(row.Money).toBe(999);
});
it.each([["Win", 53], ["Lose", -72], ["Return", 0]] as const)("keeps 50/50 with stored %s financial profit", (Status, Money) => {
  const row = Object.freeze({ ...buy, Status, Money, PmMatchResult: "EqualSplit" as const, PmSellState: "settled" as const });
  const model = predictionDisplay(row, [row], quotes());
  if (model?.side !== "buy") throw Error("Expected buy presentation");
  expect(model.profit.profitText).toBe(String(Money));
  expect(row.Status).toBe(Status); expect(row.Money).toBe(Money);
});
it("keeps GTC missing-fill odds hidden and filled odds separate from signed limits", () => {
  const live = quotes();
  const missing = predictionDisplay({ ...buy, PmGtcExecutionId: "gtc", PmFillPrice: undefined, PmShares: undefined, PmStakeUsdc: undefined }, [], live);
  expect(missing?.quote).toMatchObject({ priceText: null, showOdds: false, oddsTitle: undefined });
  const filled = predictionDisplay({ ...buy, PmGtcExecutionId: "gtc" }, [], live);
  expect(filled?.quote).toMatchObject({ priceText: "0.5", showOdds: true, oddsTitle: undefined });
});
it("keeps sells as proceeds/quote records and does not query live-price readers", () => {
  const live = quotes();
  const sell = predictionDisplay({ ...buy, PmSide: "sell", PmStakeUsdc: undefined }, [], live);
  expect(sell).toMatchObject({ side: "sell", venue: "pm", amount: { amountLabel: "回款", amountText: "72", sharesText: "20" } });
  expect(sell).not.toHaveProperty("profit"); expect(sell).not.toHaveProperty("live");
  for (const reader of Object.values(live)) expect(reader).not.toHaveBeenCalled();
});
it("keeps PF currency conversion and reads only PF live values", () => {
  const live = quotes();
  const row = Object.freeze({ Type: "PredictFun", PfSide: "buy" as const, Status: "Win", Money: 10, BetMoney: 20 });
  const model = predictionDisplay(row, [row], live);
  if (model?.side !== "buy") throw Error("Expected buy presentation");
  expect(model.venue).toBe("pf");
  expect(model.profit.amountText).toBe(String(Math.round(20 * getExchange(Currency.USDT))));
  expect(model.profit.profitText).toBe(String(Math.round(10 * getExchange(Currency.USDT))));
  expect(model.profit.livePnlTone).toBe("neutral");
  expect(model.live).toEqual({ showPrice: false, showOdds: false, priceText: "—", oddsText: "2.000" });
  expect(live.pmLivePriceText).not.toHaveBeenCalled(); expect(live.pmLiveUnrealizedPnlCny).not.toHaveBeenCalled();
});
it.each([[14, "positive"], [-8, "negative"], [0, "neutral"], [null, "neutral"]] as const)("uses live P&L %s only for its display tone", (value, tone) => {
  const live = quotes(); live.pfLiveUnrealizedPnlCny.mockReturnValue(value);
  const row: OrderRow = { Type: "PredictFun", Status: "None", Money: 123 };
  const model = predictionDisplay(row, [], live);
  if (model?.side !== "buy") throw Error("Expected buy presentation");
  expect(model.profit.livePnlTone).toBe(tone); expect(model.profit.profitText).toBe("待结算"); expect(row.Money).toBe(123);
});
it("leaves other venues to the unchanged ordinary-order presentation", () => {
  const live = quotes();
  expect(predictionDisplay({ Type: "OB", Status: "Win", Money: 100 }, [], live)).toBeNull();
  for (const reader of Object.values(live)) expect(reader).not.toHaveBeenCalled();
});
