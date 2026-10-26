import { expect, it } from "vitest";
import { toClientOrder } from "./dto.js";

const row = () => ({ provider: "Polymarket", order_id: "original", player_id: 1, user_id: "owner", link: 123,
  create_at: 1000, bet_money: 100, odds: 2, money: 0, status: "None",
  raw: { pmSide: "buy", pmShares: 10, pmFillPrice: 0.5, pmStakeUsdc: 5, pmFeeUsdc: 0 } });
it("does not add a type or GTC identity to existing FOK rows or change their financial fields", () => {
  const fok = toClientOrder(row());
  expect(fok).not.toHaveProperty("PmOrderType"); expect(fok).not.toHaveProperty("PmGtcExecutionId");
  expect(fok).toMatchObject({ OrderID: "original", PlayerID: 1, Type: "Polymarket", Link: 123, BetMoney: 100, Odds: 2, PmShares: 10, PmFillPrice: 0.5, PmStakeUsdc: 5 });
});
it("exposes explicit GTC type as order metadata, without changing account or original-order identity", () => {
  const incoming = row(); incoming.raw.pmOrderType = "GTC";
  const gtc = toClientOrder(incoming);
  expect(gtc).toEqual({ ...toClientOrder(row()), PmOrderType: "GTC" });
});
