import type { BetOption } from "@changmen/client-core/models/betOption";
import { describe, expect, it } from "vitest";
import { resolveMakeUpSuccessReference } from "@/stores/betting/makeUpReference";

function leg(betMoney: number, odds: number, newOdds?: number): BetOption {
  return {
    betMoney,
    odds,
    newOdds,
  } as BetOption;
}

describe("resolveMakeUpSuccessReference", () => {
  it("uses the successful option instead of a different venue fill (A8)", () => {
    const ref = resolveMakeUpSuccessReference(
      leg(30, 1.35),
      [{ betMoney: 70, odds: 4.095, status: "none" } as never],
      false,
    );
    expect(ref).toEqual({ betMoney: 30, betOdds: 1.35 });
  });

  it("does not replace option values with a venue row selected by orderId (A8)", () => {
    const ref = resolveMakeUpSuccessReference(
      leg(30, 1.35),
      [
        { orderId: "0xold", betMoney: 10, odds: 2.6, status: "reject" } as never,
        { orderId: "0xnew", betMoney: 70, odds: 4.095, status: "none" } as never,
      ],
      false,
      undefined,
      "0xnew",
    );
    expect(ref).toEqual({ betMoney: 30, betOdds: 1.35 });
  });

  it("falls back to leg when successOrderId is absent from venue list", () => {
    const ref = resolveMakeUpSuccessReference(
      leg(70, 4, 4.095),
      [{ orderId: "0xold", betMoney: 10, odds: 2.6, status: "reject" } as never],
      false,
      undefined,
      "0xnew",
    );
    expect(ref).toEqual({ betMoney: 70, betOdds: 4 });
  });

  it("keeps option odds instead of newOdds when venue sync is empty (A8)", () => {
    const ref = resolveMakeUpSuccessReference(
      leg(70, 4, 4.095),
      [],
      false,
    );
    expect(ref).toEqual({ betMoney: 70, betOdds: 4 });
  });

  it("falls back to leg when success leg was rejected", () => {
    const ref = resolveMakeUpSuccessReference(
      leg(70, 4.095),
      [{ betMoney: 70, odds: 4.095, status: "reject" } as never],
      true,
    );
    expect(ref).toEqual({ betMoney: 70, betOdds: 4.095 });
  });

  it("converts PM leg betMoney from USDT to CNY on fallback", () => {
    const pmAccount = {
      provider: "Polymarket",
      currency: "USDT",
    } as never;
    const ref = resolveMakeUpSuccessReference(
      { betMoney: 14, odds: 1.695, type: "Polymarket" } as BetOption,
      [],
      false,
      pmAccount,
    );
    expect(ref).toEqual({ betMoney: 93.8, betOdds: 1.695 });
  });

  it("PM price improvement does not change the A8 option anchor after currency conversion", () => {
    const ref = resolveMakeUpSuccessReference(
      { betMoney: 14, odds: 2, newOdds: 2.2, type: "Polymarket" } as BetOption,
      [{ orderId: "filled", betMoney: 100, odds: 2.5, status: "none" } as never],
      false,
      { provider: "Polymarket", currency: "USDT" } as never,
      "filled",
    );
    expect(ref).toEqual({ betMoney: 93.8, betOdds: 2 });
  });

  it("converts PF leg betMoney from USDT to CNY on fallback (same as PM)", () => {
    const pfAccount = {
      provider: "PredictFun",
      currency: "USDT",
    } as never;
    const ref = resolveMakeUpSuccessReference(
      { betMoney: 1.49, odds: 1.6, type: "PredictFun" } as BetOption,
      [],
      false,
      pfAccount,
    );
    expect(ref).toEqual({ betMoney: 9.98, betOdds: 1.6 });
  });

  it("converts unscaled PM venue order USDC to CNY", () => {
    const pmAccount = {
      provider: "Polymarket",
      currency: "USDT",
    } as never;
    const ref = resolveMakeUpSuccessReference(
      { betMoney: 14, odds: 1.695, type: "Polymarket" } as BetOption,
      [{ betMoney: 14, odds: 1.695, status: "none", pmStakeUsdc: 14 } as never],
      false,
      pmAccount,
    );
    expect(ref).toEqual({ betMoney: 93.8, betOdds: 1.695 });
  });

  it("converts the PM option once without adopting scaled venue amounts (A8)", () => {
    const pmAccount = {
      provider: "Polymarket",
      currency: "USDT",
    } as never;
    const ref = resolveMakeUpSuccessReference(
      { betMoney: 14, odds: 1.695, type: "Polymarket" } as BetOption,
      [{ betMoney: 98, odds: 1.695, status: "none", pmStakeUsdc: 14 } as never],
      false,
      pmAccount,
    );
    expect(ref).toEqual({ betMoney: 93.8, betOdds: 1.695 });
  });
});

