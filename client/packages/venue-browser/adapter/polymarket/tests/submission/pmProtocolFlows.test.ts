import { beforeEach, expect, test, vi } from "vitest";
import { BetOption } from "@changmen/client-core/models/betOption";
import type { PlatformAccount } from "@changmen/client-core/models/platformAccount";
import { polymarketProvider } from "@changmen/venue-browser/polymarket/fok/bet";
import { checkGtcBuy, prepareManualGtcBuy } from "@changmen/venue-browser/polymarket/gtc/preparation";
import { sellPolymarketBuyPosition } from "@changmen/venue-browser/polymarket/submission/pmManualSell";
import { setPmFokPreflightMode } from "@changmen/venue-browser/polymarket/submission/preflight/pmFokPreflightMode";
import { setPmOrderSubmitMode } from "@changmen/venue-browser/polymarket/pmOrderSubmitMode";
import { preparePolymarketAccountRuntimes, clearPolymarketOrderClientCache } from "@changmen/venue-browser/polymarket/submission/client/pmOrderClientCache";
import { clearPmGammaCacheForTests } from "@changmen/venue-browser/polymarket/markets/pmSportGamma";
import { clearPmSubmitJournalForTests } from "@changmen/venue-browser/polymarket/submission/recovery/pmSubmitJournal";
import { clearPmTickStateForTests } from "@changmen/venue-browser/polymarket/pmTickState";
import { resetPmFokDepthBufferPrefsForTests } from "@changmen/venue-browser/polymarket/pmFokDepthBufferMode";
import samples from "../fixtures/protocolMarkets.json";

const io = vi.hoisted(() => ({ book: vi.fn(), get: vi.fn(), submit: vi.fn() }));
vi.mock("@changmen/venue-browser/polymarket/orders/pmClientApi", () => ({ pmGetBook: io.book, pmSubmitOrder: io.submit,
  pmPrepareSubmit: async () => undefined, pmSubmitClockReady: () => true, pmGetTrades: async () => [] }));
vi.mock("@changmen/venue-browser/polymarket/transport/transport", () => ({ polymarketPluginGet: io.get, polymarketL2Get: io.get }));
vi.mock("@changmen/venue-browser/polymarket/realtime/userWs", async importOriginal => ({
  ...await importOriginal<typeof import("@changmen/venue-browser/polymarket/realtime/userWs")>(), warmPolymarketUserWs: () => undefined,
}));

const account = { accountId: 47, provider: "Polymarket", gateway: "https://clob.polymarket.com", token: JSON.stringify({
  privateKey: `0x${"0".repeat(63)}1`, walletAddress: "0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf",
  funder: "0x0000000000000000000000000000000000000002", signatureType: 3, apiKey: "offline", secret: "dGVzdA==", passphrase: "offline",
}) } as PlatformAccount;
const acceptedId = `0x${"3".repeat(64)}`;
beforeEach(async () => {
  localStorage.clear(); clearPmGammaCacheForTests(); clearPmSubmitJournalForTests(); clearPolymarketOrderClientCache(); clearPmTickStateForTests(); resetPmFokDepthBufferPrefsForTests();
  vi.clearAllMocks(); io.book.mockReset(); io.get.mockReset(); io.submit.mockReset();
  await preparePolymarketAccountRuntimes([account]);
});

function useSample(sample: typeof samples[number], controlledDepth = true) {
  // Identity/status are real captures. Liquidity and clock are controlled execution scenarios, not live fills.
  const book = { ...sample.book, timestamp: String(Date.now()), ...(controlledDepth ? {
    asks: [{ price: "0.5", size: "1000" }], bids: [{ price: "0.5", size: "1000" }],
  } : {}) };
  io.book.mockResolvedValue(book);
  io.get.mockImplementation(async (raw: string) => {
    const url = new URL(raw);
    if (url.pathname === "/balance-allowance/update") return {};
    if (url.pathname === "/balance-allowance") return { balance: "10000000", allowances: {
      "0xe111180000d2663c0091e4f400237545b87b996b": "1", "0xe2222d279d744050d28e00520010520000310f59": "1", "0xe3333700ca9d93003f00f0f71f8515005f6c00aa": "1",
    } };
    if (url.pathname.endsWith(`/markets/${sample.gamma.conditionId}`)) return sample.clob;
    if (url.hostname === "gamma-api.polymarket.com") return [sample.gamma];
    throw new Error(`unexpected public request ${url.pathname}`);
  });
  const option = new BetOption("Polymarket", "protocol-contract", sample.gamma.conditionId, sample.book.asset_id, 28, "Yes", 2);
  option.betMoney = 10;
  return option;
}

const flows = samples.flatMap(sample => (["local", "vps"] as const).flatMap(route => (["legacy", "optimized", "gtc", "sell"] as const).map(flow => ({ sample, route, flow }))));
test.each(flows)("$sample.version $route $flow keeps the selected asset through real signing and ACK parsing", async ({ sample, route, flow }) => {
  setPmOrderSubmitMode(route);
  const option = useSample(sample);
  io.submit.mockResolvedValue({ success: true, orderID: acceptedId, status: flow === "gtc" ? "live" : "matched",
    makingAmount: flow === "sell" ? "10000000" : "10000000", takingAmount: flow === "sell" ? "5000000" : "20000000" });
  if (flow === "gtc") {
    await checkGtcBuy(account, option);
    expect(option.checkError).toBeUndefined();
    const prepared = await prepareManualGtcBuy(account, option);
    expect(prepared.protocol).toBe(sample.version === "v2" ? 3 : 2);
    expect(await prepared.submit()).toMatchObject({ success: true, status: "live" });
  } else if (flow === "sell") {
    const result = await sellPolymarketBuyPosition({ account, buyRow: {
      provider: "Polymarket", orderId: "held-buy", odds: 2, createAt: 1, betMoney: 5, reward: 0, money: 0, status: "none", game: "", match: "", bet: "", item: "",
      pmTokenId: option.itemId, pmConditionId: option.betId, pmShares: 10, pmStakeUsdc: 5, pmSide: "buy", pmSellState: "open",
    } });
    expect(result).toMatchObject({ ok: true, sharesSold: 10, proceedsUsdc: 5 });
    const call = io.get.mock.calls.find(([url]) => String(url).includes("/balance-allowance/update"));
    expect(new URL(String(call?.[0])).searchParams.get("asset_type")).toBe(sample.version === "v2" ? "CONDITIONAL-V2" : "CONDITIONAL");
  } else {
    setPmFokPreflightMode(flow);
    await polymarketProvider.checkBet!(account, option);
    expect(option.checkError).toBeUndefined();
    expect((await polymarketProvider.betting!(account, option)).success).toBe(true);
  }
  expect(io.submit).toHaveBeenCalledOnce();
  expect(io.book).toHaveBeenCalledOnce();
  expect(io.submit.mock.calls[0]![1].order).toMatchObject({ tokenId: option.itemId, signatureType: 3,
    maker: "0x0000000000000000000000000000000000000002", signer: "0x0000000000000000000000000000000000000002", side: flow === "sell" ? "SELL" : "BUY",
    makerAmount: "10000000", takerAmount: flow === "sell" ? "5000000" : "20000000" });
  if (flow === "optimized")
    expect(io.get.mock.calls.some(([url]) => String(url).includes("gamma-api.polymarket.com"))).toBe(false);
});

test.each(["legacy", "optimized"] as const)("actual empty V2 snapshot blocks %s FOK without a POST", async flow => {
  setPmFokPreflightMode(flow);
  const option = useSample(samples[1]!, false);
  await polymarketProvider.checkBet!(account, option);
  expect(option.checkError).toBeTruthy();
  expect((await polymarketProvider.betting!(account, option)).success).toBe(false);
  expect(io.submit).not.toHaveBeenCalled();
});

test.each(["legacy", "optimized", "gtc"] as const)("wrong-condition book blocks %s before signing/submission", async flow => {
  const option = useSample(samples[1]!);
  io.book.mockResolvedValue({ ...samples[1]!.book, market: "wrong-condition", asks: [{ price: "0.5", size: "1000" }] });
  if (flow === "gtc") await checkGtcBuy(account, option);
  else { setPmFokPreflightMode(flow); await polymarketProvider.checkBet!(account, option); }
  expect(option.checkError).toContain("订单簿结构");
  expect(io.submit).not.toHaveBeenCalled();
});

test.each(["legacy", "gtc"] as const)("%s rejects book/market protocol disagreement even when the asset IDs match", async flow => {
  const option = useSample(samples[1]!);
  // Dropping the V2 book marker would otherwise silently select CTF signing domain 2.
  io.book.mockResolvedValue({ ...samples[1]!.book, version: undefined, timestamp: String(Date.now()), asks: [{ price: "0.5", size: "1000" }] });
  if (flow === "gtc") await checkGtcBuy(account, option);
  else { setPmFokPreflightMode(flow); await polymarketProvider.checkBet!(account, option); }
  expect(option.checkError).toContain("交易资产或版本不一致");
  expect(io.submit).not.toHaveBeenCalled();
});
