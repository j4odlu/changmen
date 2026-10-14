import type { BetOption } from "@changmen/client-core/models/betOption";
import type { PlatformAccount } from "@changmen/client-core/models/platformAccount";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { checkGtcBuy, checkManualGtcBuy, prepareManualGtcBuy } from "./preparation";

const mocks = vi.hoisted(() => ({ book: vi.fn(), guard: vi.fn(), prepareClock: vi.fn(), clock: true, tick: undefined as string | undefined, generation: 1, build: vi.fn(), runtime: {} }));
vi.mock("./index", () => ({ buildPreparedGtcBuy: mocks.build }));
vi.mock("../builder", () => ({ resolvePolymarketBuilderCode: () => "builder" }));
vi.mock("../pmClientApi", () => ({ pmGetBook: mocks.book, pmPrepareSubmit: mocks.prepareClock, pmSubmitClockReady: () => mocks.clock }));
vi.mock("../pmBetGuard", () => ({ resolvePolymarketBetBlockReason: mocks.guard }));
vi.mock("../pmSportGuard", () => ({ getPolymarketPmSportBlockReasonFromOption: () => null }));
vi.mock("../pmTickState", () => ({ currentPmTick: () => mocks.tick }));
vi.mock("../pmOrderClientCache", () => ({ getPolymarketOrderClientRuntime: async () => ({ runtime: mocks.runtime }), polymarketSigningGeneration: () => mocks.generation }));
vi.mock("../pmOrderSubmitMode", () => ({ resolvePmOrderSubmitHttpMode: () => "direct" }));
vi.mock("../l2Auth", () => ({ parseTokenConfig: () => ({}), resolvePrivateKey: () => "key", resolveApiCreds: () => ({ address: "address", apiKey: "key", secret: "secret", passphrase: "passphrase" }) }));
const account = { accountId: 1, provider: "Polymarket", token: "vault", currency: "USDT" } as PlatformAccount;
const option = () => ({ type: "Polymarket", itemId: "token", betId: "condition", matchId: "match", target: "Home", betMoney: 5, odds: 2, data: null } as BetOption);
beforeEach(() => {
  vi.clearAllMocks(); mocks.clock = true; mocks.tick = undefined; mocks.generation = 1;
  mocks.prepareClock.mockImplementation(async () => { mocks.clock = true; });
  mocks.book.mockResolvedValue({ asset_id: "token", min_order_size: "5", tick_size: "0.01", neg_risk: false, asks: [], timestamp: "100" });
  mocks.guard.mockResolvedValue(null); mocks.build.mockImplementation(async (_account, _option, prepared) => prepared);
});
describe("manual GTC independent precheck", () => {
  it("automatic pairs retain a depth check without using the FOK cache", async () => {
    const input = option(); await checkGtcBuy(account, input, Promise.resolve(true), true);
    expect(input.data).toBeNull(); expect(input.checkError).toContain("自动套利限价内深度不足");
    expect(mocks.build).not.toHaveBeenCalled();
  });
  it("automatic pairs with sufficient depth prepare through their own cache", async () => {
    mocks.book.mockResolvedValue({ asset_id: "token", min_order_size: "5", tick_size: "0.01", neg_risk: false, asks: [{ price: "0.5", size: "20" }] });
    const input = option(); await checkGtcBuy(account, input, Promise.resolve(true), true);
    expect(input.checkError).toBeUndefined(); await prepareManualGtcBuy(account, input);
    expect(mocks.build).toHaveBeenCalledOnce();
  });
  it("allows zero ask depth to rest at the frozen limit", async () => {
    const input = option(); await checkManualGtcBuy(account, input, Promise.resolve(true));
    expect(input.checkError).toBeUndefined(); expect(input.data).toMatchObject({ limitPrice: 0.5, apiBetMoney: 5 });
    expect(input.data?.orderOptions).toMatchObject({ asks: [] });
    await prepareManualGtcBuy(account, input); expect(mocks.build).toHaveBeenCalledOnce();
  });
  it("allows asks above the limit without silently raising that limit", async () => {
    mocks.book.mockResolvedValue({ asset_id: "token", min_order_size: "5", tick_size: "0.01", neg_risk: false, asks: [{ price: "0.6", size: "1" }] });
    const input = option(); await checkManualGtcBuy(account, input); expect(input.data).toMatchObject({ limitPrice: 0.5, bookPrice: 0.6 });
  });
  it("consumes once and cannot reuse the prepared manual order", async () => {
    const input = option(); await checkManualGtcBuy(account, input);
    const prepared = await prepareManualGtcBuy(account, input); prepared.consume();
    await expect(prepareManualGtcBuy(account, input)).rejects.toThrow("禁止重发");
  });
  it("blocks wallet-session changes before signing", async () => {
    const input = option(); await checkManualGtcBuy(account, input); mocks.generation++;
    await expect(prepareManualGtcBuy(account, input)).rejects.toThrow("已失效"); expect(mocks.build).not.toHaveBeenCalled();
  });
  it("renews an expired submit clock after the other leg without replacing the signed preparation", async () => {
    const input = option(); await checkManualGtcBuy(account, input);
    const prepared = await prepareManualGtcBuy(account, input);
    const frozenData = input.data;
    mocks.prepareClock.mockClear(); mocks.clock = false;
    expect(() => prepared.validate()).not.toThrow();
    await prepared.prepareSubmit(); prepared.consume();
    expect(mocks.prepareClock).toHaveBeenCalledExactlyOnceWith(account);
    expect(input.data).toBe(frozenData);
    expect(mocks.book).toHaveBeenCalledOnce(); expect(mocks.build).toHaveBeenCalledOnce();
    await expect(prepared.prepareSubmit()).rejects.toThrow("本轮签单已消费");
    expect(mocks.prepareClock).toHaveBeenCalledOnce();
  });
  it("does not refresh a valid submit clock", async () => {
    const input = option(); await checkManualGtcBuy(account, input);
    const prepared = await prepareManualGtcBuy(account, input); mocks.prepareClock.mockClear();
    await prepared.prepareSubmit(); expect(mocks.prepareClock).not.toHaveBeenCalled();
  });
  it("retains the unconsumed order when clock renewal fails", async () => {
    const input = option(); await checkManualGtcBuy(account, input);
    const prepared = await prepareManualGtcBuy(account, input); mocks.clock = false;
    mocks.prepareClock.mockRejectedValueOnce(new Error("clock unavailable"));
    await expect(prepared.prepareSubmit()).rejects.toThrow("clock unavailable");
    expect(() => prepared.validate()).not.toThrow();
    await prepared.prepareSubmit(); expect(() => prepared.consume()).not.toThrow();
  });
  it.each(["wallet", "amount", "tick"])("rechecks %s changes during clock renewal before allowing a submit", async (change) => {
    const input = option(); await checkManualGtcBuy(account, input);
    const prepared = await prepareManualGtcBuy(account, input); mocks.clock = false;
    mocks.prepareClock.mockImplementationOnce(async () => {
      mocks.clock = true;
      if (change === "wallet") mocks.generation++;
      if (change === "amount") input.betMoney++;
      if (change === "tick") mocks.tick = "0.1";
    });
    await expect(prepared.prepareSubmit()).rejects.toThrow(change === "tick" ? "tick" : "已失效");
    expect(() => prepared.consume()).toThrow();
  });
  it("blocks modified amount or tick before signing", async () => {
    const input = option(); await checkManualGtcBuy(account, input); input.betMoney = 6;
    await expect(prepareManualGtcBuy(account, input)).rejects.toThrow("已失效");
    const next = option(); await checkManualGtcBuy(account, next); mocks.tick = "0.1";
    await expect(prepareManualGtcBuy(account, next)).rejects.toThrow("tick");
  });
  it("closed market remains blocked even with a valid book", async () => {
    mocks.guard.mockResolvedValue("market closed"); const input = option(); await checkManualGtcBuy(account, input);
    expect(input.data).toBeNull(); expect(input.checkError).toBe("market closed"); expect(mocks.build).not.toHaveBeenCalled();
  });
  it("failed signing preparation never makes a ready option", async () => {
    const input = option(); await checkManualGtcBuy(account, input, Promise.resolve(false));
    expect(input.data).toBeNull(); expect(input.checkError).toContain("解锁");
  });
  it("repeated precheck invalidates the prior prepared attempt", async () => {
    const input = option(); await checkManualGtcBuy(account, input); await checkManualGtcBuy(account, input);
    expect(input.data).toBeNull(); await expect(prepareManualGtcBuy(account, input)).rejects.toThrow();
  });
});
