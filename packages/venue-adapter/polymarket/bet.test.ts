import { notePmTickFrame, clearPmTickStateForTests } from "./pmTickState";
import { createPmTickBufferQuote, clearPmTickBufferMetadata, notePmTickBufferBook } from "./pmTickBuffer";
import { transformPmPrice } from "./priceQuote";
import { pmBuyOrderShares } from "./pmBuyOrderShares";
import type { PlatformAccount } from "@changmen/client-core/models/platformAccount";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { isPolymarketFokBuyFilled, isPolymarketOrderAccepted, polymarketProvider } from "./bet";
import {
  resetPmFokDepthBufferPrefsForTests,
  setPmFokDepthBufferPrefs,
} from "./pmFokDepthBufferMode";
import { POLYMARKET_BUILDER_CODE_DEFAULT } from "./builder";
import { setPmOrderSubmitMode, PM_ORDER_SUBMIT_MODE_KEY } from "./pmOrderSubmitMode";
import { POLYMARKET_CLOB_API } from "./api";
import { resetPolymarketOrderSyncForTest } from "./pmOrderSync";
import { clearPmExecutionMetrics, getPmExecutionMetrics } from "./pmExecutionMetrics";
import { clearPolymarketOrderClientCacheForTests } from "./pmOrderClientCache";
import { clearPmSubmitJournalForTests, guardedPmSubmit, pmAccountSubmitAttempts } from "./pmSubmitJournal";
import * as pmOrigin from "./pmOrigin";

const polymarketPluginGet = vi.hoisted(() => vi.fn());
const polymarketPluginPost = vi.hoisted(() => vi.fn());
const pmGetBook = vi.hoisted(() => vi.fn());
const pmGetTrades = vi.hoisted(() => vi.fn());
const pmSubmitOrder = vi.hoisted(() => vi.fn());
const saveVenueOdds = vi.hoisted(() => vi.fn());
const getVenueOddsEntry = vi.hoisted(() => vi.fn());

vi.mock("./transport", () => ({
  polymarketPluginGet,
  polymarketPluginPost,
  polymarketL2Get: (account: PlatformAccount, url: string, l2Path: string) =>
    polymarketPluginGet(url, { account, l2Path }),
}));

vi.mock("./pmClientApi", () => ({
  pmGetBook,
  pmPrepareSubmit: vi.fn().mockResolvedValue(undefined),
  pmSubmitClockReady: () => true,
  pmSubmitOrder,
  pmGetTrades,
}));

vi.mock("@changmen/client-core/bridge/oddsAccess", () => ({
  saveVenueOdds,
  getVenueOddsEntry,
  readVenueOdds: () => 0,
  writeVenueOdds: () => {},
  cleanVenueOdds: () => {},
  isVenueOdds: () => false,
  updateVenueOddsLock: () => {},
  updateVenueBetLock: () => {},
  updateVenueOddsMessage: () => {},
  getVenueOddsLimit: () => undefined,
  setVenueOddsLimit: () => {},
  registerOddsAccess: () => {},
  clearOddsAccess: () => {},
}));

beforeEach(() => {
  clearPmSubmitJournalForTests();
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const key = localStorage.key(i);
    if (key?.startsWith("changmen:pm:submission:v1:")) localStorage.removeItem(key);
  }
  globalThis.localStorage.removeItem(PM_ORDER_SUBMIT_MODE_KEY);
  resetPmFokDepthBufferPrefsForTests();
  clearPmExecutionMetrics();
  clearPolymarketOrderClientCacheForTests();
  clearPmTickStateForTests();
  clearPmTickBufferMetadata();
});

function accountWithToken(token: string, extra: Partial<PlatformAccount> = {}): PlatformAccount {
  return {
    provider: "Polymarket",
    gateway: POLYMARKET_CLOB_API,
    token,
    ...extra,
  } as unknown as PlatformAccount;
}

function base64Utf8(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function mockPluginGetWithBook(
  book: Record<string, unknown>,
  tokenId = "123456789",
) {
  vi.mocked(pmGetBook).mockResolvedValue({
      asset_id: tokenId, ...book });
  vi.mocked(polymarketPluginGet).mockImplementation(async (url: string) => {
    if (url.includes("gamma-api.polymarket.com/markets")) {
      return [{
        clob_token_ids: JSON.stringify([tokenId]),
        outcomePrices: JSON.stringify(["0.5", "0.5"]),
      }];
    }
    throw new Error(`unexpected url ${url}`);
  });
}

describe("polymarketProvider.getBalance", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(polymarketPluginGet).mockReset();
    vi.mocked(pmSubmitOrder).mockReset();
  });

  test("走 relay 服务端 L2 签名（account + l2Path）", async () => {
    vi.mocked(polymarketPluginGet).mockResolvedValue({ balance: "54877978" });
    const account = accountWithToken(JSON.stringify({
      walletAddress: "0xabc",
      apiCreds: { apiKey: "key-1", secret: "c2VjcmV0", passphrase: "pass-1" },
    }), { accountId: 47 as unknown as PlatformAccount["accountId"] });

    await expect(polymarketProvider.getBalance!(account)).resolves.toEqual({
      balance: 54.877978,
      currency: "USDT",
    });

    expect(polymarketPluginGet).toHaveBeenCalledWith(
      expect.stringContaining("/balance-allowance?asset_type=COLLATERAL"),
      { account, l2Path: "/balance-allowance" },
    );
  });

  test("uses relay L2 path to fetch collateral balance", async () => {
    vi.mocked(polymarketPluginGet).mockResolvedValue({ balance: "123450000", allowance: "999999999" });
    const account = accountWithToken(JSON.stringify({
      walletAddress: "0xabc",
      signatureType: 3,
      apiCreds: {
        apiKey: "key-1",
        secret: "c2VjcmV0",
        passphrase: "pass-1",
      },
    }));

    await expect(polymarketProvider.getBalance!(account)).resolves.toEqual({
      balance: 123.45,
      currency: "USDT",
    });

    expect(polymarketPluginGet).toHaveBeenCalledOnce();
    const [url, options] = vi.mocked(polymarketPluginGet).mock.calls[0]!;
    expect(url).toBe(`${POLYMARKET_CLOB_API}/balance-allowance?asset_type=COLLATERAL&signature_type=3`);
    expect(options).toEqual(expect.objectContaining({
      headers: expect.objectContaining({
        POLY_API_KEY: "key-1",
      }),
    }));
  });

  test("returns raw USDC balance (CNY via getExchange on account)", async () => {
    vi.mocked(polymarketPluginGet).mockResolvedValue({ balance: "123450000" });
    const account = accountWithToken(JSON.stringify({
      walletAddress: "0xabc",
      signatureType: 3,
      apiCreds: {
        apiKey: "key-1",
        secret: "c2VjcmV0",
        passphrase: "pass-1",
      },
    }), { multiply: 10 });

    await expect(polymarketProvider.getBalance!(account)).resolves.toEqual({
      balance: 123.45,
      currency: "USDT",
    });
  });

  test("accepts full base64 data copied from plugin", async () => {
    vi.mocked(polymarketPluginGet).mockResolvedValue({ balance: "1000000" });
    const payload = {
      walletAddress: "0xdef",
      apiCreds: {
        key: "key-2",
        secret: "c2VjcmV0",
        passphrase: "pass-2",
      },
    };
    const account = accountWithToken(base64Utf8(JSON.stringify(payload)));

    await expect(polymarketProvider.getBalance!(account)).resolves.toEqual({
      balance: 1,
      currency: "USDT",
    });
  });

  test("accepts outer plugin payload with nested token json", async () => {
    vi.mocked(polymarketPluginGet).mockResolvedValue({ balance: "4868613" });
    const nested = {
      walletAddress: "0xCa4c007bdc8087F13141046Dc38F2f79F87cf43e",
      funder: "0x8ed24e533d24c2f381983eda8f97c2358f8d65e5",
      signatureType: "1",
      apiCreds: {
        apiKey: "key-nested",
        secret: "c2VjcmV0",
        passphrase: "pass-nested",
      },
    };
    const account = accountWithToken(base64Utf8(JSON.stringify({
      provider: "Polymarket",
      gateway: POLYMARKET_CLOB_API,
      referer: "https://polymarket.com/zh",
      token: JSON.stringify(nested),
    })));

    await expect(polymarketProvider.getBalance!(account)).resolves.toEqual({
      balance: 4.868613,
      currency: "USDT",
    });

    const [url, options] = vi.mocked(polymarketPluginGet).mock.calls[0]!;
    expect(url).toBe(`${POLYMARKET_CLOB_API}/balance-allowance?asset_type=COLLATERAL&signature_type=3`);
    expect(options).toEqual(expect.objectContaining({
      headers: expect.objectContaining({ POLY_API_KEY: "key-nested" }),
    }));
  });

  test("accepts flat official api credential json", async () => {
    vi.mocked(polymarketPluginGet).mockResolvedValue({ balance: "2500000" });
    const account = accountWithToken(JSON.stringify({
      address: "0x123",
      key: "key-flat",
      secret: "c2VjcmV0",
      passphrase: "pass-flat",
    }));

    await expect(polymarketProvider.getBalance!(account)).resolves.toEqual({
      balance: 2.5,
      currency: "USDT",
    });
    const [, options] = vi.mocked(polymarketPluginGet).mock.calls[0]!;
    expect(options).toEqual(expect.objectContaining({
      headers: expect.objectContaining({ POLY_API_KEY: "key-flat" }),
    }));
  });

  test("accepts apiSecret naming from captured storage", async () => {
    vi.mocked(polymarketPluginGet).mockResolvedValue({ balance: "3000000" });
    const account = accountWithToken(JSON.stringify({
      walletAddress: "0x456",
      apiCreds: {
        apiKey: "key-camel",
        apiSecret: "c2VjcmV0",
        passphrase: "pass-camel",
      },
    }));

    await expect(polymarketProvider.getBalance!(account)).resolves.toEqual({
      balance: 3,
      currency: "USDT",
    });
    const [, options] = vi.mocked(polymarketPluginGet).mock.calls[0]!;
    expect(options).toEqual(expect.objectContaining({
      headers: expect.objectContaining({ POLY_API_KEY: "key-camel" }),
    }));
  });

  test("uses balance path without query in relay l2Path", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    vi.mocked(polymarketPluginGet).mockResolvedValue({ balance: "1000000" });
    const account = accountWithToken(JSON.stringify({
      walletAddress: "0xabc",
      signatureType: 3,
      apiCreds: {
        apiKey: "key-1",
        secret: "c2VjcmV0",
        passphrase: "pass-1",
      },
    }));

    await polymarketProvider.getBalance!(account);

    const [url, options] = vi.mocked(polymarketPluginGet).mock.calls[0]!;
    expect(url).toBe(`${POLYMARKET_CLOB_API}/balance-allowance?asset_type=COLLATERAL&signature_type=3`);
    expect(options).toEqual(expect.objectContaining({
      headers: expect.objectContaining({ POLY_API_KEY: "key-1" }),
    }));
  });

  test("uses POLY_1271 directly when wallet and funder differ without explicit signature type", async () => {
    vi.mocked(polymarketPluginGet)
      .mockResolvedValueOnce({ balance: "4868613" })
      .mockResolvedValueOnce({ name: "pm-user", users: [{ id: "99" }], proxyWallet: "0x8ed24e533d24c2f381983eda8f97c2358f8d65e5" });
    const account = accountWithToken(JSON.stringify({
      walletAddress: "0xCa4c007bdc8087F13141046Dc38F2f79F87cf43e",
      funder: "0x8ed24e533d24c2f381983eda8f97c2358f8d65e5",
      apiCreds: {
        apiKey: "key-1",
        secret: "c2VjcmV0",
        passphrase: "pass-1",
      },
    }));

    await expect(polymarketProvider.getBalance!(account)).resolves.toEqual({
      balance: 4.868613,
      currency: "USDT",
      venueMemberId: "99",
      venueAccountName: "pm-user",
    });

    expect(vi.mocked(polymarketPluginGet).mock.calls.map(([url]) => url)).toEqual([
      `${POLYMARKET_CLOB_API}/balance-allowance?asset_type=COLLATERAL&signature_type=3`,
      "https://gamma-api.polymarket.com/public-profile?address=0x8ed24e533d24c2f381983eda8f97c2358f8d65e5",
    ]);
  });

  test("overrides captured proxy signature type when funder differs from wallet", async () => {
    vi.mocked(polymarketPluginGet)
      .mockResolvedValueOnce({ balance: "4868613" })
      .mockResolvedValueOnce({ name: "pm-user", users: [{ id: "99" }] });
    const account = accountWithToken(JSON.stringify({
      walletAddress: "0xCa4c007bdc8087F13141046Dc38F2f79F87cf43e",
      funder: "0x8ed24e533d24c2f381983eda8f97c2358f8d65e5",
      signatureType: "1",
      apiCreds: {
        apiKey: "key-1",
        secret: "c2VjcmV0",
        passphrase: "pass-1",
      },
    }));

    await expect(polymarketProvider.getBalance!(account)).resolves.toEqual({
      balance: 4.868613,
      currency: "USDT",
      venueMemberId: "99",
      venueAccountName: "pm-user",
    });

    expect(vi.mocked(polymarketPluginGet).mock.calls[0]![0]).toBe(
      `${POLYMARKET_CLOB_API}/balance-allowance?asset_type=COLLATERAL&signature_type=3`,
    );
  });

  test("infers POLY_1271 signature type when funder differs from wallet", async () => {
    vi.mocked(polymarketPluginGet).mockResolvedValue({ balance: "1000000" });
    const account = accountWithToken(JSON.stringify({
      walletAddress: "0xabc",
      funder: "0xproxy",
      apiCreds: {
        apiKey: "key-1",
        secret: "c2VjcmV0",
        passphrase: "pass-1",
      },
    }));

    await polymarketProvider.getBalance!(account);

    const [url] = vi.mocked(polymarketPluginGet).mock.calls[0]!;
    expect(url).toBe(`${POLYMARKET_CLOB_API}/balance-allowance?asset_type=COLLATERAL&signature_type=3`);
  });

  test("accountId=0 保存前探测走客户端 L2 头，不经 relay 查 RDS", async () => {
    vi.mocked(polymarketPluginGet).mockResolvedValue({ balance: "1000000" });
    const account = accountWithToken(JSON.stringify({
      walletAddress: "0xabc",
      apiCreds: {
        apiKey: "key-1",
        secret: "c2VjcmV0",
        passphrase: "pass-1",
      },
    }), { accountId: 0 as unknown as PlatformAccount["accountId"] });

    await polymarketProvider.getBalance!(account);

    expect(polymarketPluginGet).toHaveBeenCalledWith(
      expect.stringContaining("/balance-allowance"),
      expect.objectContaining({
        headers: expect.objectContaining({
          POLY_API_KEY: "key-1",
          POLY_PASSPHRASE: "pass-1",
        }),
      }),
    );
    const opts = vi.mocked(polymarketPluginGet).mock.calls[0]?.[1];
    expect(opts).not.toHaveProperty("l2Path");
  });

  test("returns undefined when balance relay fails", async () => {
    vi.mocked(polymarketPluginGet).mockRejectedValue(new Error("missing api secret"));
    const account = accountWithToken(JSON.stringify({
      walletAddress: "0xabc",
      apiCreds: { apiKey: "key-1", secret: "c2VjcmV0", passphrase: "pass-1" },
    }), { accountId: 47 as unknown as PlatformAccount["accountId"] });

    await expect(polymarketProvider.getBalance!(account)).resolves.toBeUndefined();
    expect(polymarketPluginGet).toHaveBeenCalled();
  });
});

async function checkedBetting(account: PlatformAccount, option: any) {
  const checked = await polymarketProvider.checkBet(account, option);
  if (!checked.data) return { success: false, message: checked.checkError } as any;
  return polymarketProvider.betting(account, checked);
}

describe("polymarketProvider.betting", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(polymarketPluginGet).mockReset();
    vi.mocked(pmSubmitOrder).mockReset();
    vi.mocked(pmGetBook).mockReset();
    vi.mocked(pmSubmitOrder).mockReset();
    saveVenueOdds.mockReset();
    getVenueOddsEntry.mockReset();
  });

  test("下单走 Pm_SubmitOrder", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    mockPluginGetWithBook({
      tick_size: "0.01",
      min_order_size: "1",
      neg_risk: false,
      asks: [{ price: "0.5", size: "100" }],
    });
    vi.mocked(pmSubmitOrder).mockResolvedValueOnce({
      success: true,
      orderID: "order-hk-1",
      status: "matched",
      takingAmount: "2000000",
      makingAmount: "1000000",
    });

    const account = accountWithToken(JSON.stringify({
      walletAddress: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
      privateKey: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
      apiCreds: {
        apiKey: "key-1",
        secret: "c2VjcmV0",
        passphrase: "pass-1",
      },
    }), { accountId: 47 as unknown as PlatformAccount["accountId"] });

    const result = await checkedBetting(account, {
      itemId: "123456789",
      odds: 2,
      betMoney: 10,
    } as any);

    expect(result.success).toBe(true);
    expect(pmSubmitOrder).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: 47 }),
      expect.objectContaining({ orderType: "FOK" }),
    );
  }, 20_000);

  test("uses official CLOB v2 order shape and posts through pmClientApi", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    mockPluginGetWithBook({
      tick_size: "0.01",
      min_order_size: "1",
      neg_risk: false,
      asks: [{ price: "0.5", size: "100" }],
    });
    vi.mocked(pmSubmitOrder).mockResolvedValueOnce({
      success: true,
      orderID: "order-1",
      status: "matched",
      takingAmount: "2000000",
      makingAmount: "1000000",
    });

    const account = accountWithToken(JSON.stringify({
      walletAddress: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
      funder: "0x8ed24e533d24c2f381983eda8f97c2358f8d65e5",
      signatureType: "3",
      privateKey: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
      apiCreds: {
        apiKey: "key-1",
        secret: "c2VjcmV0",
        passphrase: "pass-1",
      },
    }));
    const option = {
      itemId: "123456789",
      odds: 2,
      betMoney: 10,
    };

    const result = await checkedBetting(account, option as any);

    expect(result.success).toBe(true);
    expect(pmGetBook).toHaveBeenCalledWith("123456789", POLYMARKET_CLOB_API);
    expect(pmSubmitOrder).toHaveBeenCalledOnce();

    const [, body] = vi.mocked(pmSubmitOrder).mock.calls[0]!;
    expect(body).toMatchObject({
      owner: "key-1",
      orderType: "FOK",
      deferExec: false,
      postOnly: false,
      order: {
        maker: "0x8ed24e533d24c2f381983eda8f97c2358f8d65e5",
        signer: "0x8ed24e533d24c2f381983eda8f97c2358f8d65e5",
        tokenId: "123456789",
        makerAmount: "10000000",
        takerAmount: "20000000",
        side: "BUY",
        signatureType: 3,
        timestamp: "1700000000000",
        expiration: "0",
        metadata: "0x0000000000000000000000000000000000000000000000000000000000000000",
        builder: POLYMARKET_BUILDER_CODE_DEFAULT,
      },
    });
    expect((body as any).order.signature).toEqual(expect.stringMatching(/^0x[0-9a-f]+$/));
  });

  test("FOK buy posts at detection cap when best ask is cheaper", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    mockPluginGetWithBook({
      tick_size: "0.01",
      min_order_size: "1",
      neg_risk: false,
      asks: [{ price: "0.36", size: "5000" }],
    });
    vi.mocked(pmSubmitOrder).mockResolvedValueOnce({
      success: true,
      orderID: "order-cap",
      status: "matched",
      takingAmount: "26315789",
      makingAmount: "10000000",
    });

    const result = await checkedBetting(pmBettingAccount(), {
      itemId: "123456789",
      odds: 2.631,
      betMoney: 10,
      data: {
        detectionOdds: 2.631,
        detectionMaxPrice: 0.38,
        detectionClobPrice: 0.38,
      },
    } as any);

    expect(result.success).toBe(true);
    const [, body] = vi.mocked(pmSubmitOrder).mock.calls[0]!;
    const maker = Number((body as { order: { makerAmount: string; takerAmount: string } }).order.makerAmount);
    const taker = Number((body as { order: { makerAmount: string; takerAmount: string } }).order.takerAmount);
    expect(maker / taker).toBeCloseTo(0.38, 4);
  });

  test("uses market order price from book depth for FOK buy amount", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    mockPluginGetWithBook({
      tick_size: "0.01",
      min_order_size: "5",
      neg_risk: false,
      asks: [
        { price: "0.5", size: "50" },
      ],
    });
    vi.mocked(pmSubmitOrder).mockResolvedValueOnce({
      success: true,
      orderID: "order-depth",
      status: "matched",
      takingAmount: "18181900",
      makingAmount: "10000000",
    });

    const account = accountWithToken(JSON.stringify({
      walletAddress: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
      funder: "0x8ed24e533d24c2f381983eda8f97c2358f8d65e5",
      signatureType: "3",
      privateKey: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
      apiCreds: {
        apiKey: "key-1",
        secret: "c2VjcmV0",
        passphrase: "pass-1",
      },
    }));
    const option = {
      itemId: "123456789",
      odds: 2,
      betMoney: 10,
    };

    const result = await checkedBetting(account, option as any);

    expect(result.success).toBe(true);
    expect((option as any).newOdds).toBeCloseTo(2, 4);

    const [, body] = vi.mocked(pmSubmitOrder).mock.calls[0]!;
    expect(body).toMatchObject({
      orderType: "FOK",
      order: {
        makerAmount: "10000000",
        takerAmount: "20000000",
        side: "BUY",
      },
    });
  });

  test("rejects FOK when book price exceeds detection odds cap", async () => {
    mockPluginGetWithBook({
      tick_size: "0.01",
      min_order_size: "5",
      neg_risk: false,
      asks: [{ price: "0.32", size: "100" }],
    });
    getVenueOddsEntry.mockReturnValue({
      id: "123456789",
      odds: 5,
      clobPrice: 0.2,
      isLock: false,
      betId: "cond-1",
      side: "home",
      time: 1,
    });

    const account = accountWithToken(JSON.stringify({
      walletAddress: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
      funder: "0x8ed24e533d24c2f381983eda8f97c2358f8d65e5",
      signatureType: "3",
      privateKey: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
      apiCreds: {
        apiKey: "key-1",
        secret: "c2VjcmV0",
        passphrase: "pass-1",
      },
    }));

    const result = await checkedBetting(account, {
      itemId: "123456789",
      betId: "cond-1",
      odds: 3.125,
      betMoney: 35,
      data: { detectionOdds: 5, apiBetMoney: 5 },
    } as any);

    expect(result.success).toBe(false);
    expect(result.message).toContain("盘口价高于检测价");
    expect(pmSubmitOrder).not.toHaveBeenCalled();
    expect(saveVenueOdds).toHaveBeenCalledWith(
      "Polymarket",
      expect.objectContaining({
        id: "123456789",
        clobPrice: 0.32,
      }),
      "http",
    );
  });

  test("accepts FOK when fo clobPrice matches detection odds (trunc3)", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    mockPluginGetWithBook({
      tick_size: "0.01",
      min_order_size: "5",
      neg_risk: false,
      asks: [{ price: "0.68", size: "5000" }],
    });
    vi.mocked(pmSubmitOrder).mockResolvedValueOnce({
      success: true,
      orderID: "order-rounding",
      status: "matched",
      takingAmount: "7350000",
      makingAmount: "5000000",
    });

    const account = accountWithToken(JSON.stringify({
      walletAddress: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
      funder: "0x8ed24e533d24c2f381983eda8f97c2358f8d65e5",
      signatureType: "3",
      privateKey: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
      apiCreds: {
        apiKey: "key-1",
        secret: "c2VjcmV0",
        passphrase: "pass-1",
      },
    }));

    // 0.68 → trunc3 展示赔率 1.47（与 fo / 建腿同源）
    const result = await checkedBetting(account, {
      itemId: "123456789",
      odds: 1.47,
      betMoney: 35,
      data: {
        detectionOdds: 1.47,
        detectionClobPrice: 0.68,
        apiBetMoney: 5,
      },
    } as any);

    expect(result.success).toBe(true);
    expect(pmSubmitOrder).toHaveBeenCalledOnce();
  });

  test("uses current betMoney instead of stale apiBetMoney after reconcile", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    mockPluginGetWithBook({
      tick_size: "0.01",
      min_order_size: "1",
      neg_risk: false,
      asks: [{ price: "0.38", size: "5000" }],
    });
    vi.mocked(pmSubmitOrder).mockResolvedValueOnce({
      success: true,
      orderID: "order-reconcile-stake",
      status: "matched",
      takingAmount: "2630000",
      makingAmount: "1000000",
    });

    const account = accountWithToken(JSON.stringify({
      walletAddress: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
      funder: "0x8ed24e533d24c2f381983eda8f97c2358f8d65e5",
      signatureType: "3",
      privateKey: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
      apiCreds: {
        apiKey: "key-1",
        secret: "c2VjcmV0",
        passphrase: "pass-1",
      },
    }));

    const result = await checkedBetting(account, {
      itemId: "123456789",
      odds: 2.632,
      betMoney: 3,
      data: {
        detectionOdds: 2.631,
        detectionClobPrice: 0.38,
        apiBetMoney: 14,
      },
    } as any);

    expect(result.success).toBe(true);
    const [, body] = vi.mocked(pmSubmitOrder).mock.calls[0]!;
    expect(Number((body as { order: { makerAmount: string } }).order.makerAmount) / 1_000_000)
      .toBeCloseTo(3, 2);
  });

  test("accepts decimal USDC stake from reconcile", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    mockPluginGetWithBook({
      tick_size: "0.01",
      min_order_size: "1",
      neg_risk: false,
      asks: [{ price: "0.38", size: "5000" }],
    });
    vi.mocked(pmSubmitOrder).mockResolvedValueOnce({
      success: true,
      orderID: "order-decimal-stake",
      status: "matched",
      takingAmount: "2630000",
      makingAmount: "1142860",
    });

    const account = accountWithToken(JSON.stringify({
      walletAddress: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
      funder: "0x8ed24e533d24c2f381983eda8f97c2358f8d65e5",
      signatureType: "3",
      privateKey: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
      apiCreds: {
        apiKey: "key-1",
        secret: "c2VjcmV0",
        passphrase: "pass-1",
      },
    }));

    const result = await checkedBetting(account, {
      itemId: "123456789",
      odds: 2.632,
      betMoney: 11.43,
      data: {
        detectionOdds: 2.631,
        detectionClobPrice: 0.38,
      },
    } as any);

    expect(result.success).toBe(true);
    const [, body] = vi.mocked(pmSubmitOrder).mock.calls[0]!;
    expect(Number((body as { order: { makerAmount: string } }).order.makerAmount) / 1_000_000)
      .toBe(11.43);
  });

  test("ignores stale apiBetMoney when betMoney is zero", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    mockPluginGetWithBook({
      tick_size: "0.01",
      min_order_size: "1",
      neg_risk: false,
      asks: [{ price: "0.38", size: "5000" }],
    });

    const account = accountWithToken(JSON.stringify({
      walletAddress: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
      funder: "0x8ed24e533d24c2f381983eda8f97c2358f8d65e5",
      signatureType: "3",
      privateKey: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
      apiCreds: {
        apiKey: "key-1",
        secret: "c2VjcmV0",
        passphrase: "pass-1",
      },
    }));

    const result = await checkedBetting(account, {
      itemId: "123456789",
      odds: 2.632,
      betMoney: 0,
      data: {
        detectionOdds: 2.631,
        detectionClobPrice: 0.38,
        apiBetMoney: 14,
      },
    } as any);

    expect(result.success).toBe(false);
    expect(pmSubmitOrder).not.toHaveBeenCalled();
  });

  test("reports minimum order size before posting too-small FOK buy", async () => {
    mockPluginGetWithBook({
      tick_size: "0.01",
      min_order_size: "12",
      neg_risk: false,
      asks: [{ price: "0.78", size: "100" }],
    });

    const account = accountWithToken(JSON.stringify({
      walletAddress: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
      funder: "0x8ed24e533d24c2f381983eda8f97c2358f8d65e5",
      signatureType: "3",
      privateKey: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
      apiCreds: {
        apiKey: "key-1",
        secret: "c2VjcmV0",
        passphrase: "pass-1",
      },
    }));

    const result = await checkedBetting(account, {
      itemId: "123456789",
      odds: 1.2821,
      betMoney: 3,
    } as any);

    expect(result.success).toBe(false);
    expect(result.message).toContain("Polymarket 下单金额低于最小份数");
    expect(result.message).toContain("【盘口】");
    expect(result.message).toContain("最小下单份数：12");
    expect(result.message).toContain("当前盘口至少约 9.36 USDC");
    expect(pmSubmitOrder).not.toHaveBeenCalled();
  });

  test("official success and ID with unmatched status remains accepted pending confirmation", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    mockPluginGetWithBook({
      tick_size: "0.01",
      min_order_size: "1",
      neg_risk: false,
      asks: [{ price: "0.5", size: "100" }],
    });
    vi.mocked(pmSubmitOrder).mockResolvedValueOnce({
      success: true,
      orderID: "order-unmatched",
      status: "unmatched",
      takingAmount: "",
    });

    const account = accountWithToken(JSON.stringify({
      walletAddress: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
      funder: "0x8ed24e533d24c2f381983eda8f97c2358f8d65e5",
      signatureType: "3",
      privateKey: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
      apiCreds: { apiKey: "key-1", secret: "c2VjcmV0", passphrase: "pass-1" },
    }));

    const result = await checkedBetting(account, {
      itemId: "123456789",
      odds: 2,
      betMoney: 10,
    } as any);

    expect(result.success).toBe(true);
    expect(result.pending).toBe(true);
    expect(result.message).toContain("unmatched");
    expect(result.orderId).toBe("order-unmatched");
    expect(result.tip).toBeNull();
    expect(result.beginTime).toBe(1_700_000_000_000);
  });

  test("trading is disabled is a closed-market reject, not a posted FOK", async () => {
    mockPluginGetWithBook({
      tick_size: "0.01",
      min_order_size: "1",
      neg_risk: false,
      asks: [{ price: "0.5", size: "100" }],
    });
    vi.mocked(pmSubmitOrder).mockResolvedValueOnce({
      error: "trading is disabled",
    });

    const account = accountWithToken(JSON.stringify({
      walletAddress: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
      funder: "0x8ed24e533d24c2f381983eda8f97c2358f8d65e5",
      signatureType: "3",
      privateKey: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
      apiCreds: { apiKey: "key-1", secret: "c2VjcmV0", passphrase: "pass-1" },
    }));

    const result = await checkedBetting(account, {
      itemId: "123456789",
      odds: 2,
      betMoney: 10,
    } as any);

    expect(result.success).toBe(false);
    expect(result.message).toContain("已停止交易");
    expect(result.tip).toBeNull();
    expect(result.orderId).toBeNull();
  });

  test("submit timeout is not marked pmPosted", async () => {
    mockPluginGetWithBook({
      tick_size: "0.01",
      min_order_size: "1",
      neg_risk: false,
      asks: [{ price: "0.5", size: "100" }],
    });
    vi.mocked(pmSubmitOrder).mockRejectedValueOnce(new Error("timeout of 15000ms exceeded"));

    const account = accountWithToken(JSON.stringify({
      walletAddress: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
      funder: "0x8ed24e533d24c2f381983eda8f97c2358f8d65e5",
      signatureType: "3",
      privateKey: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
      apiCreds: { apiKey: "key-1", secret: "c2VjcmV0", passphrase: "pass-1" },
    }));

    const result = await checkedBetting(account, {
      itemId: "123456789",
      odds: 2,
      betMoney: 10,
    } as any);

    expect(result.success).toBe(false);
    expect(result.message).toContain("未确认是否送达");
    expect(result.tip).toBeNull();
  });

  test("succeeds when API returns delayed with orderID (chain pending)", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    mockPluginGetWithBook({
      tick_size: "0.01",
      min_order_size: "1",
      neg_risk: false,
      asks: [{ price: "0.5", size: "100" }],
    });
    vi.mocked(pmSubmitOrder).mockResolvedValueOnce({
      success: true,
      orderID: "0xdelayed-order",
      status: "delayed",
      takingAmount: "",
    });

    const account = accountWithToken(JSON.stringify({
      walletAddress: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
      funder: "0x8ed24e533d24c2f381983eda8f97c2358f8d65e5",
      signatureType: "3",
      privateKey: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
      apiCreds: { apiKey: "key-1", secret: "c2VjcmV0", passphrase: "pass-1" },
    }));

    const result = await checkedBetting(account, {
      itemId: "123456789",
      odds: 2,
      betMoney: 10,
    } as any);

    expect(result.success).toBe(true);
    expect(result.pending).toBe(true);
    expect(result.orderId).toBe("0xdelayed-order");
    expect(result.message).toContain("待确认");
  });

  test("accepted matched response without fill amounts waits for confirmation", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    mockPluginGetWithBook({
      tick_size: "0.01",
      min_order_size: "1",
      neg_risk: false,
      asks: [{ price: "0.5", size: "100" }],
    });
    vi.mocked(pmSubmitOrder).mockResolvedValueOnce({
      success: true,
      orderID: "order-empty",
      status: "matched",
      takingAmount: "0",
    });

    const account = accountWithToken(JSON.stringify({
      walletAddress: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
      funder: "0x8ed24e533d24c2f381983eda8f97c2358f8d65e5",
      signatureType: "3",
      privateKey: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
      apiCreds: { apiKey: "key-1", secret: "c2VjcmV0", passphrase: "pass-1" },
    }));

    const result = await checkedBetting(account, {
      itemId: "123456789",
      odds: 2,
      betMoney: 10,
    } as any);

    expect(result.success).toBe(true);
    expect(result.pending).toBe(true);
  });
});

describe("isPolymarketFokBuyFilled", () => {
  test("requires success, matched status, and positive takingAmount", () => {
    expect(isPolymarketFokBuyFilled({
      success: true,
      status: "matched",
      takingAmount: "2000000",
    })).toBe(true);
    expect(isPolymarketFokBuyFilled({
      success: true,
      status: "MATCHED",
      takingAmount: "1.5",
    })).toBe(true);
    expect(isPolymarketFokBuyFilled({
      success: true,
      status: "delayed",
      takingAmount: "100",
    })).toBe(false);
    expect(isPolymarketFokBuyFilled({
      success: false,
      status: "matched",
      takingAmount: "100",
    })).toBe(false);
    expect(isPolymarketFokBuyFilled({
      success: true,
      status: "matched",
      takingAmount: "",
    })).toBe(false);
  });
});

describe("isPolymarketOrderAccepted", () => {
  test("accepts matched fills and delayed submissions with orderID", () => {
    expect(isPolymarketOrderAccepted({
      success: true,
      status: "matched",
      takingAmount: "1",
      orderID: "0x1",
    })).toBe(true);
    expect(isPolymarketOrderAccepted({
      success: true,
      status: "delayed",
      orderID: "0xdelayed",
    })).toBe(true);
    expect(isPolymarketOrderAccepted({
      success: true,
      status: "delayed",
      orderID: "",
    })).toBe(false);
    expect(isPolymarketOrderAccepted({
      success: true,
      status: "unmatched",
      orderID: "0x2",
    })).toBe(true);
  });
});

function precheckOnly(account: PlatformAccount, option: any) {
  return polymarketProvider.checkBet(account, option, { role: "precheckOnly" });
}

describe("polymarketProvider.checkBet", () => {
  beforeEach(() => {
    resetPmFokDepthBufferPrefsForTests();
    vi.mocked(polymarketPluginGet).mockReset();
    vi.mocked(pmGetBook).mockReset();
    saveVenueOdds.mockReset();
    getVenueOddsEntry.mockReset();
    vi.mocked(polymarketPluginGet).mockImplementation(async (url: string) => {
      if (url.includes("gamma-api.polymarket.com/markets")) {
        return [{
          clob_token_ids: JSON.stringify(["123456789"]),
          outcomePrices: JSON.stringify(["0.5", "0.5"]),
        }];
      }
      throw new Error(`unexpected url ${url}`);
    });
  });

  test("rejects checkBet when /book says trading is disabled", async () => {
    vi.mocked(polymarketPluginGet).mockImplementation(async (url: string) => {
      if (url.includes("gamma-api.polymarket.com/markets")) {
        return [{
          clob_token_ids: JSON.stringify(["123456789"]),
          outcomePrices: JSON.stringify(["0.5", "0.5"]),
        }];
      }
      throw new Error(`unexpected url ${url}`);
    });
    vi.mocked(pmGetBook).mockResolvedValue({
      asset_id: "123456789", error: "trading is disabled" });

    const out = await precheckOnly(
      accountWithToken("{}", { multiply: 7 }),
      { itemId: "123456789", odds: 5, betMoney: 5 } as any,
    );

    expect(out.data).toBeNull();
    expect(out.checkError).toContain("已停止交易");
  });

  test("loads order book and sets executable odds within detection cap", async () => {
    vi.mocked(polymarketPluginGet).mockImplementation(async (url: string) => {
      if (url.includes("gamma-api.polymarket.com/markets")) {
        return [{
          clob_token_ids: JSON.stringify(["123456789"]),
          outcomePrices: JSON.stringify(["0.5", "0.5"]),
        }];
      }
      throw new Error(`unexpected url ${url}`);
    });
    vi.mocked(pmGetBook).mockResolvedValue({
      asset_id: "123456789",
      tick_size: "0.01",
      min_order_size: "5",
      neg_risk: false,
      asks: [{ price: "0.18", size: "100" }],
    });

    const option = {
      itemId: "123456789",
      odds: 5,
      betMoney: 5,
    };

    const out = await precheckOnly(
      accountWithToken("{}", { multiply: 7 }),
      option as any,
    );

    expect(out.data).toMatchObject({
      tokenId: "123456789",
      detectionOdds: 5,
      detectionMaxPrice: 0.2,
      bookPrice: 0.18,
      side: "BUY",
      bookFetchedAt: expect.any(Number),
      orderOptions: {
        tickSize: "0.01",
        minOrderSize: 5,
        negRisk: false,
        asks: [{ price: 0.18, size: 100 }],
      },
    });
    expect(out.odds).toBe(5.555);
    expect(out.checkError).toBeUndefined();
  });

  test("fetches /book without waiting for Gamma", async () => {
    let releaseGamma!: (value: unknown) => void;
    const gammaGate = new Promise((resolve) => {
      releaseGamma = resolve;
    });
    vi.mocked(polymarketPluginGet).mockImplementation(async (url: string) => {
      if (url.includes("gamma-api.polymarket.com/markets")) {
        await gammaGate;
        return [{
          clob_token_ids: JSON.stringify(["123456789"]),
          outcomePrices: JSON.stringify(["0.5", "0.5"]),
        }];
      }
      throw new Error(`unexpected url ${url}`);
    });
    vi.mocked(pmGetBook).mockImplementation(async () => {
      releaseGamma(undefined);
      return {
        asset_id: "123456789",
        tick_size: "0.01",
        min_order_size: "5",
        neg_risk: false,
        asks: [{ price: "0.18", size: "100" }],
      };
    });

    const out = await precheckOnly(
      accountWithToken("{}", { multiply: 7 }),
      { itemId: "123456789", odds: 5, betMoney: 5 } as any,
    );

    expect(out.data).toBeTruthy();
    expect(pmGetBook).toHaveBeenCalled();
  });

  test("Gamma 拦盘时即使 /book 已回也不写 data", async () => {
    vi.mocked(polymarketPluginGet).mockImplementation(async (url: string) => {
      if (url.includes("gamma-api.polymarket.com/markets")) {
        return [{
          clob_token_ids: JSON.stringify(["123456789"]),
          outcomePrices: JSON.stringify(["0.5", "0.5"]),
          acceptingOrders: false,
        }];
      }
      throw new Error(`unexpected url ${url}`);
    });
    vi.mocked(pmGetBook).mockResolvedValue({
      asset_id: "123456789",
      tick_size: "0.01",
      min_order_size: "5",
      neg_risk: false,
      asks: [{ price: "0.18", size: "100" }],
    });

    const out = await precheckOnly(
      accountWithToken("{}", { multiply: 7 }),
      { itemId: "123456789", odds: 5, betMoney: 5 } as any,
    );

    expect(out.data).toBeNull();
    expect(out.checkError).toContain("已停止交易");
  });

  test("rejects when pm_sport shows series decided", async () => {
    const option = {
      itemId: "123456789",
      odds: 4.762,
      betMoney: 28,
      match: {
        pmSport: {
          mapScore: { home: 1, away: 2 },
          bo: 3,
          status: "running",
        },
      },
      bet: { round: 0 },
    };

    const out = await precheckOnly(
      accountWithToken("{}", { multiply: 7 }),
      option as any,
    );

    expect(out.data).toBeNull();
    expect(out.checkError).toContain("系列赛已决出");
    expect(polymarketPluginGet).not.toHaveBeenCalled();
    expect(pmGetBook).not.toHaveBeenCalled();
  });

  test("rejects when pm_sport shows match ended", async () => {
    const option = {
      itemId: "123456789",
      odds: 4.762,
      betMoney: 28,
      match: {
        pmSport: {
          ended: true,
          mapScore: { home: 1, away: 2 },
          bo: 3,
        },
      },
      bet: { round: 0 },
    };

    const out = await precheckOnly(
      accountWithToken(JSON.stringify({
        walletAddress: "0xabc",
        privateKey: "0x" + "11".repeat(32),
        apiCreds: { apiKey: "k", secret: "s", passphrase: "p" },
      })),
      option as any,
    );

    expect(out.data).toBeNull();
    expect(out.checkError).toContain("比赛已结束");
    expect(polymarketPluginGet).not.toHaveBeenCalled();
  });

  test("rejects when book price is worse than detection odds", async () => {
    vi.mocked(polymarketPluginGet).mockImplementation(async (url: string) => {
      if (url.includes("gamma-api.polymarket.com/markets")) {
        return [{
          clob_token_ids: JSON.stringify(["123456789"]),
          outcomePrices: JSON.stringify(["0.5", "0.5"]),
        }];
      }
      throw new Error(`unexpected url ${url}`);
    });
    vi.mocked(pmGetBook).mockResolvedValue({
      asset_id: "123456789",
      tick_size: "0.01",
      min_order_size: "5",
      neg_risk: false,
      asks: [{ price: "0.32", size: "100" }],
    });
    getVenueOddsEntry.mockReturnValue({
      id: "123456789",
      odds: 5,
      clobPrice: 0.2,
      isLock: false,
      betId: "cond-1",
      side: "home",
      time: 1,
    });
    saveVenueOdds.mockClear();

    const option = {
      itemId: "123456789",
      betId: "cond-1",
      target: "Home",
      odds: 5,
      betMoney: 5,
    };

    const out = await precheckOnly(
      accountWithToken("{}", { multiply: 7 }),
      option as any,
    );

    expect(out.data).toBeNull();
    expect(out.checkError).toContain("盘口价高于检测价");
    expect(saveVenueOdds).toHaveBeenCalledWith(
      "Polymarket",
      expect.objectContaining({
        id: "123456789",
        clobPrice: 0.32,
        betId: "cond-1",
        side: "home",
        isLock: false,
      }),
      "http",
    );
  });

  test("price-above fo sync unlocks and keeps betId from fo", async () => {
    vi.mocked(pmGetBook).mockResolvedValue({
      asset_id: "123456789",
      tick_size: "0.01",
      min_order_size: "5",
      neg_risk: false,
      asks: [{ price: "0.32", size: "100" }],
    });
    getVenueOddsEntry.mockReturnValue({
      id: "123456789",
      odds: 5,
      clobPrice: 0.2,
      isLock: true,
      betId: "fo-cond",
      side: "away",
      time: 1,
    });
    saveVenueOdds.mockClear();

    const out = await precheckOnly(
      accountWithToken("{}", { multiply: 7 }),
      { itemId: "123456789", betId: "", odds: 5, betMoney: 5 } as any,
    );

    expect(out.checkError).toContain("盘口价高于检测价");
    expect(saveVenueOdds).toHaveBeenCalledWith(
      "Polymarket",
      expect.objectContaining({
        id: "123456789",
        clobPrice: 0.32,
        betId: "fo-cond",
        side: "away",
        // 有效 ask 必须解锁，否则 getOdds 仍为 0
        isLock: false,
      }),
      "http",
    );
  });

  test("does not rewrite fo when book ask is not worse than current fo clob", async () => {
    vi.mocked(pmGetBook).mockResolvedValue({
      asset_id: "123456789",
      tick_size: "0.01",
      min_order_size: "5",
      neg_risk: false,
      asks: [{ price: "0.32", size: "100" }],
    });
    getVenueOddsEntry.mockReturnValue({
      id: "123456789",
      odds: 3,
      clobPrice: 0.4,
      isLock: false,
      betId: "cond-1",
      side: "home",
      time: 1,
    });
    saveVenueOdds.mockClear();

    const out = await precheckOnly(
      accountWithToken("{}", { multiply: 7 }),
      { itemId: "123456789", betId: "cond-1", odds: 5, betMoney: 5 } as any,
    );

    expect(out.checkError).toContain("盘口价高于检测价");
    expect(saveVenueOdds).not.toHaveBeenCalled();
  });

  test("does not rewrite fo on min-size precheck failure", async () => {
    vi.mocked(pmGetBook).mockResolvedValue({
      asset_id: "123456789",
      tick_size: "0.01",
      min_order_size: "50",
      neg_risk: false,
      asks: [{ price: "0.5", size: "100" }],
    });
    getVenueOddsEntry.mockReturnValue({
      id: "123456789",
      odds: 2,
      clobPrice: 0.5,
      isLock: false,
      betId: "cond-1",
      side: "home",
      time: 1,
    });
    saveVenueOdds.mockClear();

    const out = await precheckOnly(
      accountWithToken("{}", { multiply: 7 }),
      {
        itemId: "123456789",
        betId: "cond-1",
        odds: 2,
        betMoney: 5,
        data: { detectionClobPrice: 0.5, detectionOdds: 2 },
      } as any,
    );

    expect(out.checkError).toContain("低于最小份数");
    expect(saveVenueOdds).not.toHaveBeenCalled();
  });

  test("derives apiBetMoney from USDT betMoney after exchange", async () => {
    vi.mocked(polymarketPluginGet).mockImplementation(async (url: string) => {
      if (url.includes("gamma-api.polymarket.com/markets")) {
        return [{
          clob_token_ids: JSON.stringify(["123456789"]),
          outcomePrices: JSON.stringify(["0.5", "0.5"]),
        }];
      }
      throw new Error(`unexpected url ${url}`);
    });
    vi.mocked(pmGetBook).mockResolvedValue({
      asset_id: "123456789",
      tick_size: "0.01",
      min_order_size: "5",
      neg_risk: false,
      asks: [{ price: "0.5", size: "100" }],
    });

    const option = {
      itemId: "123456789",
      odds: 2,
      betMoney: 14,
    };

    const out = await precheckOnly(
      accountWithToken("{}", { multiply: 10 }),
      option as any,
    );

    expect(out.data).toMatchObject({
      betMoney: 14,
      apiBetMoney: 14,
      detectionOdds: 2,
    });
  });

  describe("pmFokDepthBuffer", () => {
    function capOption(betMoney: number, asks: Array<{ price: string; size: string }>) {
      vi.mocked(pmGetBook).mockResolvedValue({
      asset_id: "123456789",
        tick_size: "0.01",
        min_order_size: "1",
        neg_risk: false,
        asks,
      });
      return {
        itemId: "123456789",
        odds: 1.818,
        betMoney,
        data: {
          detectionOdds: 1.818,
          detectionMaxPrice: 0.55,
          detectionClobPrice: 0.55,
        },
      };
    }

    test("off: 1× at best ask still passes (unchanged)", async () => {
      const out = await precheckOnly(
        accountWithToken("{}", { multiply: 7 }),
        capOption(10, [{ price: "0.5", size: "20" }]) as any,
      );
      expect(out.checkError).toBeUndefined();
      expect(out.data).toMatchObject({ bookPrice: 0.5, depthMultiplier: 1 });
    });

    test("on 1.5: best ask 1× fails; worse level inside cap does not count", async () => {
      setPmFokDepthBufferPrefs({ enabled: true, multiplier: 1.5 });
      const out = await precheckOnly(
        accountWithToken("{}", { multiply: 7 }),
        capOption(10, [
          { price: "0.5", size: "20" },
          { price: "0.54", size: "100" },
        ]) as any,
      );
      expect(out.data).toBeNull();
      expect(out.checkError).toContain("盘口深度不足");
      expect(out.checkError).toContain("× 1.5");
      expect(out.checkError).toContain("及更优");
    });

    test("on 1.5: best ask 1.5× passes at best ask", async () => {
      setPmFokDepthBufferPrefs({ enabled: true, multiplier: 1.5 });
      const out = await precheckOnly(
        accountWithToken("{}", { multiply: 7 }),
        capOption(10, [{ price: "0.5", size: "30" }]) as any,
      );
      expect(out.checkError).toBeUndefined();
      expect(out.data).toMatchObject({ bookPrice: 0.5, depthMultiplier: 1.5 });
    });

    test("on 1.5: 1× walks to second level; P and better counts toward X", async () => {
      setPmFokDepthBufferPrefs({ enabled: true, multiplier: 1.5 });
      const out = await precheckOnly(
        accountWithToken("{}", { multiply: 7 }),
        capOption(10, [
          { price: "0.5", size: "10" },
          { price: "0.54", size: "20" },
        ]) as any,
      );
      expect(out.checkError).toBeUndefined();
      expect(out.data).toMatchObject({ bookPrice: 0.54, depthMultiplier: 1.5 });
    });
  });
});

describe("polymarketProvider.getOrders", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    resetPolymarketOrderSyncForTest();
    vi.mocked(polymarketPluginGet).mockReset();
    vi.mocked(pmGetTrades).mockReset();
  });

  test("fetches trades with L2 auth and maps to venue orders", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_700_100_000_000);
    vi.mocked(pmGetTrades).mockResolvedValue([{
      taker_order_id: "0xtrade-order",
      market: "0xcondition",
      side: "BUY",
      status: "TRADE_STATUS_CONFIRMED",
      size: "2000000",
      price: "0.5",
      match_time: "1700000000",
      outcome: "Team A",
    }]);
    vi.mocked(polymarketPluginGet).mockImplementation(async (url: string) => {
      if (url.includes("gamma-api.polymarket.com/markets")) {
        return [{
          condition_id: "0xcondition",
          question: "Counter-Strike: Team A vs Team B",
          sports_market_type: "child_moneyline",
          group_item_title: "Map 1 Winner",
          tags: [{ label: "cs2" }],
        }];
      }
      throw new Error(`unexpected url ${url}`);
    });

    const account = accountWithToken(JSON.stringify({
      walletAddress: "0xabc",
      apiCreds: {
        apiKey: "key-1",
        secret: "c2VjcmV0",
        passphrase: "pass-1",
      },
    }), { accountId: 47 as unknown as PlatformAccount["accountId"] });

    const orders = await polymarketProvider.getOrders!(account);
    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({
      provider: "Polymarket",
      orderId: "0xtrade-order",
      status: "none",
      betMoney: 6.7,
      odds: 2,
    });

    expect(pmGetTrades).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: 47 }),
      expect.any(Number),
      expect.any(Number),
    );
  });

  test("scales mapped order amounts to CNY display via USDT exchange", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_700_100_000_000);
    vi.mocked(pmGetTrades).mockResolvedValue([{
      taker_order_id: "0xtrade-order",
      market: "0xcondition",
      side: "BUY",
      status: "TRADE_STATUS_CONFIRMED",
      size: "2000000",
      price: "0.5",
      match_time: "1700000000",
      outcome: "Team A",
    }]);
    vi.mocked(polymarketPluginGet).mockImplementation(async (url: string) => {
      if (url.includes("gamma-api.polymarket.com/markets")) {
        return [{
          condition_id: "0xcondition",
          question: "Counter-Strike: Team A vs Team B",
          sports_market_type: "child_moneyline",
          group_item_title: "Map 1 Winner",
          tags: [{ label: "cs2" }],
        }];
      }
      throw new Error(`unexpected url ${url}`);
    });

    const orders = await polymarketProvider.getOrders!(accountWithToken(JSON.stringify({
      walletAddress: "0xabc",
      apiCreds: {
        apiKey: "key-1",
        secret: "c2VjcmV0",
        passphrase: "pass-1",
      },
    }), { accountId: 47 as unknown as PlatformAccount["accountId"], multiply: 10 }));

    expect(orders[0]?.betMoney).toBe(6.7);
    expect(orders[0]?.reward).toBe(13.4);
  });

  test("returns empty array when credentials are missing", async () => {
    vi.mocked(pmGetTrades).mockRejectedValue(new Error("missing credentials"));
    const orders = await polymarketProvider.getOrders!(accountWithToken("{}", { accountId: 47 as unknown as PlatformAccount["accountId"] }));
    expect(orders).toEqual([]);
    expect(pmGetTrades).toHaveBeenCalled();
  });
});

function pmBettingAccount() {
  return accountWithToken(JSON.stringify({
    walletAddress: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
    funder: "0x8ed24e533d24c2f381983eda8f97c2358f8d65e5",
    signatureType: "3",
    privateKey: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
    apiCreds: {
      apiKey: "key-1",
      secret: "c2VjcmV0",
      passphrase: "pass-1",
    },
  }));
}

function bookGetCalls() {
  return vi.mocked(pmGetBook).mock.calls;
}

describe("PM precheck /book reuse", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(polymarketPluginGet).mockReset();
    vi.mocked(pmSubmitOrder).mockReset();
  });

  test("betting reuses /book immediately after checkBet", async () => {
    const now = 1_700_000_000_000;
    vi.spyOn(Date, "now").mockReturnValue(now);
    mockPluginGetWithBook({
      tick_size: "0.01",
      min_order_size: "1",
      neg_risk: false,
      asks: [{ price: "0.5", size: "100" }],
    });
    vi.mocked(pmSubmitOrder).mockResolvedValue({
      success: true,
      orderID: "order-reuse",
      status: "matched",
      takingAmount: "2000000",
      makingAmount: "1000000",
    });

    const account = pmBettingAccount();
    const option = {
      itemId: "123456789",
      odds: 2,
      betMoney: 10,
    };

    const checked = await polymarketProvider.checkBet!(account, option as any);
    expect(checked.data).toBeTruthy();
    expect(bookGetCalls().length).toBeGreaterThan(0);

    vi.mocked(pmGetBook).mockClear();
    clearPmExecutionMetrics();
    const result = await polymarketProvider.betting!(account, checked as any);

    expect(result.success).toBe(true);
    expect(bookGetCalls().length).toBe(0);
    expect(getPmExecutionMetrics().find(row => row.kind === "sign")).toMatchObject({
      kind: "sign",
      bookReuse: true,
      bookAgeMs: 0,
      signWarm: true,
      orderClientCacheHit: false,
      success: true,
    });
  });

  test("betting refuses repeated consumption without signing again", async () => {
    const now = 1_700_000_000_000;
    vi.spyOn(Date, "now").mockReturnValue(now);
    mockPluginGetWithBook({
      tick_size: "0.01",
      min_order_size: "1",
      neg_risk: false,
      asks: [{ price: "0.5", size: "100" }],
    });
    vi.mocked(pmSubmitOrder).mockResolvedValue({
      success: true,
      orderID: "order-cache",
      status: "matched",
      takingAmount: "2000000",
      makingAmount: "1000000",
    });

    const account = pmBettingAccount();
    const option = {
      itemId: "123456789",
      odds: 2,
      betMoney: 10,
    };

    const checked = await polymarketProvider.checkBet!(account, option as any);
    expect(checked.data).toBeTruthy();
    await polymarketProvider.betting!(account, checked as any);

    clearPmExecutionMetrics();
    const result = await polymarketProvider.betting!(account, checked as any);
    expect(result.success).toBe(false);
    expect(pmSubmitOrder).toHaveBeenCalledOnce();
    expect(getPmExecutionMetrics().find(row => row.kind === "sign")).toBeUndefined();
  });

  test("betting keeps the same frozen check after 1500ms", async () => {
    let now = 1_700_000_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    mockPluginGetWithBook({
      tick_size: "0.01",
      min_order_size: "1",
      neg_risk: false,
      asks: [{ price: "0.5", size: "100" }],
    });
    vi.mocked(pmSubmitOrder).mockResolvedValue({
      success: true,
      orderID: "order-refetch",
      status: "matched",
      takingAmount: "2000000",
      makingAmount: "1000000",
    });

    const account = pmBettingAccount();
    const option = {
      itemId: "123456789",
      odds: 2,
      betMoney: 10,
    };

    const checked = await polymarketProvider.checkBet!(account, option as any);
    expect(checked.data).toBeTruthy();

    now += 1501;
    vi.mocked(pmGetBook).mockClear();
    clearPmExecutionMetrics();
    const result = await polymarketProvider.betting!(account, checked as any);

    expect(result.success).toBe(true);
    expect(bookGetCalls().length).toBe(0);
    expect(getPmExecutionMetrics().find(row => row.kind === "sign")).toMatchObject({
      kind: "sign",
      bookReuse: true,
      bookAgeMs: 1501,
      success: true,
    });
  });
});


describe("PM +1 tick frozen quote", () => {
  beforeEach(() => {
    pmGetBook.mockReset(); pmSubmitOrder.mockReset(); polymarketPluginGet.mockReset();
    mockPluginGetWithBook({ tick_size: "0.01", min_order_size: "5", neg_risk: false,
      asks: [{ price: "0.5", size: "1000" }] });
    pmSubmitOrder.mockResolvedValue({ success: true, status: "matched", orderID: "tick-one", takingAmount: "19.6078", makingAmount: "10" });
  });
  const raw = (amount = 10) => {
    const quote = createPmTickBufferQuote("123456789", 0.5, "0.01")!;
    return { itemId: quote.tokenId, odds: quote.displayOdds, betMoney: amount,
      data: { pmBufferMode: "tick", pmTickQuote: quote, detectionOdds: quote.displayOdds,
        detectionMaxPrice: quote.cap, detectionClobPrice: quote.cap } } as any;
  };
  test("real SDK FOK signs the buffered cap once and keeps detection odds", async () => {
    const account = pmBettingAccount();
    const checked = await polymarketProvider.checkBet(account, raw());
    expect(checked.checkError).toBeUndefined();
    expect(checked.odds).toBe(1.960);
    expect(checked.data).toMatchObject({ limitPrice: 0.51, bookPrice: 0.5, detectionMaxPrice: 0.51, pmBufferMode: "tick" });
    expect(Object.isFrozen(checked.data)).toBe(true);
    // Later asks do not reprice this attempt, and no new book is fetched while submitting.
    pmGetBook.mockClear();
    expect((await polymarketProvider.betting(account, checked)).success).toBe(true);
    const body = pmSubmitOrder.mock.calls[0]![1] as any;
    expect(body.orderType).toBe("FOK");
    expect(body.order).toMatchObject({ makerAmount: "10000000", takerAmount: "19607800", signature: expect.stringMatching(/^0x/) });
    expect(pmGetBook).not.toHaveBeenCalled();
    expect(pmSubmitOrder).toHaveBeenCalledOnce();
  });
  test.each([
    [0.976, "0.001", 0.977, 1.023],
    [0.98, "0.005", 0.985, 1.015],
    [0.49, "0.0025", 0.4925, 2.030],
    [0.9869, "0.0001", 0.987, 1.013],
  ] as const)("%s + %s never reverses truncated odds into the FOK price", async (ask, tick, cap, odds) => {
    mockPluginGetWithBook({ tick_size: tick, min_order_size: "5", neg_risk: false,
      asks: [{ price: String(ask), size: "100000" }] });
    const quote = createPmTickBufferQuote("123456789", ask, tick)!;
    const leg = { itemId: quote.tokenId, odds: quote.displayOdds, betMoney: 10,
      data: { pmBufferMode: "tick", pmTickQuote: quote, detectionOdds: quote.displayOdds,
        detectionMaxPrice: quote.cap, detectionClobPrice: quote.cap } } as any;
    const account = pmBettingAccount();
    const checked = await polymarketProvider.checkBet(account, leg);
    expect(checked.checkError).toBeUndefined();
    expect(checked.data).toMatchObject({ detectionMaxPrice: cap, limitPrice: cap, detectionOdds: odds });
    expect((await polymarketProvider.betting(account, checked)).success).toBe(true);
    expect(pmSubmitOrder).toHaveBeenCalledOnce();
  });
  test.each(["0.1", "0.01", "0.005", "0.0025", "0.001", "0.0001"] as const)(
    "all tradeable %s price levels retain exactly one tick through precheck",
    async tick => {
      const step = Math.round(Number(tick) * 10_000);
      const account = accountWithToken("{}");
      for (let units = step; units + step < 10_000; units += step) {
        const ask = units / 10_000;
        const quote = createPmTickBufferQuote("123456789", ask, tick);
        if (!quote) continue; // 超过价格边界或 UI 截断到 1 的报价不可交易。
        const expectedCap = (units + step) / 10_000;
        mockPluginGetWithBook({ tick_size: tick, min_order_size: "5", neg_risk: false,
          asks: [{ price: String(ask), size: "100000" }] });
        const leg = { itemId: quote.tokenId, odds: quote.displayOdds, betMoney: 10,
          data: { pmBufferMode: "tick", pmTickQuote: quote, detectionOdds: quote.displayOdds,
            detectionMaxPrice: quote.cap, detectionClobPrice: quote.cap } } as any;
        const checked = await polymarketProvider.checkBet(account, leg, { role: "precheckOnly" });
        expect(checked.checkError, `${ask} + ${tick}`).toBeUndefined();
        expect(checked.data?.detectionMaxPrice, `${ask} + ${tick}`).toBe(expectedCap);
        expect(checked.data?.limitPrice, `${ask} + ${tick}`).toBe(expectedCap);
      }
      expect(pmSubmitOrder).not.toHaveBeenCalled();
    }, 30_000,
  );
  test.each([[2.5, false], [2.55, true]])("%s USDC minimum shares checked at cap", async (amount, ready) => {
    const leg = raw(amount);
    const checked = await polymarketProvider.checkBet(pmBettingAccount(), leg);
    expect(Boolean(checked.data)).toBe(ready);
    expect(checked.betMoney).toBe(amount);
    if (!ready) expect(checked.checkError).toContain("最小份数");
    expect(pmSubmitOrder).not.toHaveBeenCalled();
  });
  test("book tick mismatch invalidates the quote rather than shrinking its buffer", async () => {
    mockPluginGetWithBook({ tick_size: "0.001", min_order_size: "5", neg_risk: false, asks: [{ price: "0.5", size: "1000" }] });
    const checked = await polymarketProvider.checkBet(pmBettingAccount(), raw());
    expect(checked.data).toBeNull();
    expect(checked.checkError).toContain("tick 已改变");
  });
  test("missing and mismatching tick caps cannot use the legacy inverse-odds fallback", async () => {
    for (const change of [{ pmTickQuote: undefined }, { detectionMaxPrice: 0.52 }]) {
      const leg = raw(); Object.assign(leg.data, change);
      expect((await polymarketProvider.checkBet(pmBettingAccount(), leg)).data).toBeNull();
    }
    expect(pmGetBook).not.toHaveBeenCalled();
  });
  test("new tick metadata cannot change percentage submission prices", async () => {
    notePmTickBufferBook("123456789", { asset_id: "123456789", tick_size: "0.001", timestamp: Date.now() + 10000 });
    const checked = await polymarketProvider.checkBet(pmBettingAccount(), {
      itemId: "123456789", odds: 1.980, betMoney: 10,
      data: { detectionClobPrice: 0.505, detectionMaxPrice: 0.505 },
    } as any);
    expect(checked.data).toMatchObject({ detectionMaxPrice: 0.505, limitPrice: 0.5, detectionOdds: 1.980 });
    expect(checked.data?.pmBufferMode).toBeUndefined();
    expect(checked.odds).toBe(2);
    expect((await polymarketProvider.betting(pmBettingAccount(), checked)).success).toBe(true);
    expect((pmSubmitOrder.mock.calls[0]![1] as any).order).toMatchObject({ makerAmount: "10000000", takerAmount: "20000000" });
  });
  test.each(["percent", "tick"] as const)("unified %s quote retains UI odds, exact cap and SDK price through dispatch", async mode => {
    const result = transformPmPrice("123456789", 0.5, { enabled: true, mode, multiplier: 1.01 }, "0.01");
    if (result.status !== "ready") throw new Error("quote unavailable");
    const quote = result.quote;
    const account = pmBettingAccount();
    const checked = await polymarketProvider.checkBet(account, {
      itemId: quote.tokenId, odds: quote.displayOdds, betMoney: 10,
      data: { pmPriceQuote: quote,
        ...(mode === "tick" ? { pmBufferMode: "tick", pmTickQuote: quote } : {}),
        detectionOdds: quote.displayOdds, detectionMaxPrice: quote.cap, detectionClobPrice: quote.cap },
    } as any);
    expect(checked.checkError).toBeUndefined();
    expect(checked.odds).toBe(quote.displayOdds);
    expect(checked.data).toMatchObject({ pmPriceQuote: quote, detectionMaxPrice: quote.cap,
      limitPrice: mode === "tick" ? 0.51 : 0.5 });
    expect((await polymarketProvider.betting(account, checked)).success).toBe(true);
    expect((pmSubmitOrder.mock.calls[0]![1] as any).order).toMatchObject({ makerAmount: "10000000",
      takerAmount: mode === "tick" ? "19607800" : "20000000" });
  });
  test.each([
    ["percent", "0.001", 2.5, false, 0.505],
    ["percent", "0.001", 2.52, false, 0.505],
    ["percent", "0.001", 2.53, true, 0.505],
    ["percent", "0.01", 2.5, true, 0.5],
    ["tick", "0.001", 2.5, false, 0.501],
    ["tick", "0.001", 2.51, true, 0.501],
  ] as const)("%s / tick %s / %s USDC checks the minimum at the actual signed limit", async (mode, tick, amount, ready, limit) => {
    mockPluginGetWithBook({ tick_size: tick, min_order_size: "5", neg_risk: false,
      asks: [{ price: "0.5", size: "1000" }] });
    const result = transformPmPrice("123456789", 0.5, { enabled: true, mode, multiplier: 1.01 }, tick);
    if (result.status !== "ready") throw new Error("quote unavailable");
    const quote = result.quote; const account = pmBettingAccount();
    const checked = await polymarketProvider.checkBet(account, { itemId: quote.tokenId,
      odds: quote.displayOdds, betMoney: amount, data: { pmPriceQuote: quote,
        detectionOdds: quote.displayOdds, detectionMaxPrice: quote.cap } } as any);
    expect(Boolean(checked.data)).toBe(ready);
    expect(checked.betMoney).toBe(amount);
    if (!ready) {
      expect(checked.checkError).toContain("最小份数");
      expect(pmSubmitOrder).not.toHaveBeenCalled();
      return;
    }
    expect(checked.checkError).toBeUndefined();
    expect(checked.data?.limitPrice).toBe(limit);
    expect((await polymarketProvider.betting(account, checked)).success).toBe(true);
    const signed = (pmSubmitOrder.mock.calls[0]![1] as any).order;
    expect(Number(signed.takerAmount) / 1_000_000).toBeGreaterThanOrEqual(5);
    expect(Number(signed.takerAmount) / 1_000_000).toBe(pmBuyOrderShares(amount, limit, tick));
    expect(Number(signed.makerAmount) / 1_000_000).toBe(amount);
  });
  test.each(["percent", "tick"] as const)("%s signs defensively recheck the SDK's actual shares before any POST", async mode => {
    const result = transformPmPrice("123456789", 0.5, { enabled: true, mode, multiplier: 1.01 }, "0.01");
    if (result.status !== "ready") throw new Error("quote unavailable");
    const quote = result.quote; const account = pmBettingAccount();
    const checked = await polymarketProvider.checkBet(account, { itemId: quote.tokenId,
      odds: quote.displayOdds, betMoney: 10, data: { pmPriceQuote: quote,
        detectionOdds: quote.displayOdds, detectionMaxPrice: quote.cap } } as any);
    expect(checked.checkError).toBeUndefined();
    const { OrderBuilder } = await import("@polymarket/clob-client-v2");
    const original = OrderBuilder.prototype.buildMarketOrder;
    const signing = vi.spyOn(OrderBuilder.prototype, "buildMarketOrder").mockImplementationOnce(async function (...args) {
      const signed = await original.apply(this, args);
      return { ...signed, takerAmount: "4999999" };
    });
    try {
      const result = await polymarketProvider.betting(account, checked);
      expect(result.success).toBe(false);
      expect(result.message).toContain("最小份数");
      expect(pmSubmitOrder).not.toHaveBeenCalled();
    } finally { signing.mockRestore(); }
  });
  test("percentage precision boundaries keep frozen caps identical in precheck, signing and submission metrics", async () => {
    clearPmExecutionMetrics();
    mockPluginGetWithBook({ tick_size: "0.0001", min_order_size: "5", neg_risk: false,
      asks: [{ price: "0.956", size: "1000" }, { price: "0.987", size: "1000" }] });
    const result = transformPmPrice("123456789", 0.956, { enabled: true, mode: "percent", multiplier: 1.032 });
    if (result.status !== "ready") throw new Error("quote unavailable");
    const quote = result.quote; const account = pmBettingAccount();
    expect(quote).toMatchObject({ cap: 0.9866, displayOdds: 1.013 });
    const checked = await polymarketProvider.checkBet(account, { itemId: quote.tokenId,
      odds: quote.displayOdds, betMoney: 10, data: { pmPriceQuote: quote,
        detectionOdds: quote.displayOdds, detectionMaxPrice: quote.cap, detectionClobPrice: quote.cap } } as any);
    expect(checked.checkError).toBeUndefined();
    expect(checked.data).toMatchObject({ detectionMaxPrice: 0.9866, limitPrice: 0.9866 });
    pmGetBook.mockClear();
    expect((await polymarketProvider.betting(account, checked)).success).toBe(true);
    expect(pmGetBook).not.toHaveBeenCalled();
    expect((pmSubmitOrder.mock.calls[0]![1] as any).order).toMatchObject({ makerAmount: "10000000", takerAmount: "10135819" });
    for (const kind of ["check", "submit", "betting"] as const) {
      expect(getPmExecutionMetrics().find(row => row.kind === kind && row.success)).toMatchObject({
        detectionOdds: 1.013, detectionMaxPrice: 0.9866, depthAvailableAtCap: 956,
        ...(kind === "check" ? {} : { limitPrice: 0.9866 }),
      });
    }
  });
  test("a unified tick quote alone cannot bypass current book tick validation", async () => {
    const result = transformPmPrice("123456789", 0.5, { enabled: true, mode: "tick", multiplier: 1.01 }, "0.01");
    if (result.status !== "ready") throw new Error("quote unavailable");
    const quote = result.quote;
    mockPluginGetWithBook({ tick_size: "0.001", min_order_size: "5", neg_risk: false, asks: [{ price: "0.5", size: "1000" }] });
    const checked = await polymarketProvider.checkBet(pmBettingAccount(), { itemId: quote.tokenId,
      odds: quote.displayOdds, betMoney: 10, data: { pmPriceQuote: quote,
        detectionOdds: quote.displayOdds, detectionMaxPrice: quote.cap } } as any);
    expect(checked.data).toBeNull();
    expect(checked.checkError).toContain("tick 已改变");
    expect(pmSubmitOrder).not.toHaveBeenCalled();
  });
  test.each([
    ["percent", 0.97, "0.01", false],
    ["tick", 0.97, "0.01", false],
    ["none", 0.975, "0.01", false],
    ["percent", 0.97, "0.0001", true],
  ] as const)("%s / ask %s / new tick %s revalidates frozen limits after waiting for the submit lock", async (mode, ask, newTick, allowed) => {
    const tokenId = "123456789";
    const bookTimestamp = Date.now();
    mockPluginGetWithBook({ tick_size: "0.001", timestamp: bookTimestamp, min_order_size: "5", neg_risk: false,
      asks: [{ price: String(ask), size: "1000" }] });
    const result = transformPmPrice(tokenId, ask, { enabled: mode !== "none", mode: mode === "tick" ? "tick" : "percent", multiplier: 1.01 }, "0.001");
    if (result.status !== "ready") throw new Error("quote unavailable");
    const quote = result.quote; const account = pmBettingAccount();
    const checked = await polymarketProvider.checkBet(account, { itemId: tokenId, odds: quote.displayOdds, betMoney: 10,
      data: { ...(mode !== "none" ? { pmPriceQuote: quote } : {}),
        detectionOdds: quote.displayOdds, detectionMaxPrice: quote.cap, detectionClobPrice: quote.cap } } as any);
    expect(checked.checkError).toBeUndefined();
    const frozen = checked.data!;
    const limit = Number(frozen.limitPrice);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const entered = vi.fn();
    vi.stubGlobal("navigator", { locks: { request: async (_name: string, callback: () => Promise<unknown>) => {
      entered(); await gate; return callback();
    } } });
    pmGetBook.mockClear();
    try {
      const task = polymarketProvider.betting(account, checked);
      await vi.waitFor(() => expect(entered).toHaveBeenCalledOnce());
      notePmTickFrame(JSON.stringify({ event_type: "tick_size_change", asset_id: tokenId, new_tick_size: newTick, timestamp: bookTimestamp + 1 }));
      release();
      const submitted = await task;
      expect(submitted.success).toBe(allowed);
      expect(checked.data).toBe(frozen);
      expect(frozen).toMatchObject({ detectionMaxPrice: quote.cap, limitPrice: limit });
      expect(pmGetBook).not.toHaveBeenCalled();
      if (allowed) {
        expect(pmSubmitOrder).toHaveBeenCalledOnce();
        const signed = (pmSubmitOrder.mock.calls[0]![1] as any).order;
        expect(Number(signed.takerAmount) / 1_000_000).toBe(pmBuyOrderShares(10, limit, "0.001"));
      } else {
        expect(submitted.message).toContain("tick 已改变");
        expect(pmSubmitOrder).not.toHaveBeenCalled();
      }
    } finally { release(); vi.unstubAllGlobals(); }
  });
});

describe("PM phase 1 frozen attempt", () => {
  beforeEach(() => {
    vi.restoreAllMocks(); pmGetBook.mockReset(); pmSubmitOrder.mockReset(); polymarketPluginGet.mockReset();
    mockPluginGetWithBook({ tick_size: "0.005", min_order_size: "5", neg_risk: false,
      asks: [{ price: "0.505", size: "1000" }] });
    pmSubmitOrder.mockResolvedValue({ success: true, status: "matched", orderID: "one", takingAmount: "20", makingAmount: "10" });
  });
  const option = () => ({ itemId: "123456789", odds: 1 / 0.505, betMoney: 10 }) as any;
  test.each(["local", "vps"] as const)("%s BUY submission exceptions return ordinary failures and permit a freshly checked retry", async mode => {
    setPmOrderSubmitMode(mode);
    const account = pmBettingAccount();
    for (const message of ["timeout of 30000ms exceeded", "Network Error", "upstream 502"]) {
      pmSubmitOrder.mockClear();
      pmSubmitOrder.mockRejectedValueOnce(new Error(message));
      const checked = await polymarketProvider.checkBet(account, option());
      const failed = await polymarketProvider.betting(account, checked);
      expect(failed).toMatchObject({ success: false, pending: false, orderId: null, reject: null });
      expect(failed.pmSubmitUnknown).not.toBe(true);
      expect(failed.message).not.toContain("正在核对原单");
      expect(pmAccountSubmitAttempts(account)).toHaveLength(0);
      expect(pmSubmitOrder).toHaveBeenCalledOnce();
      // A consumed quote still cannot be reused; the existing retry path must precheck again.
      expect((await polymarketProvider.betting(account, checked)).success).toBe(false);
      expect(pmSubmitOrder).toHaveBeenCalledOnce();
      const retry = await polymarketProvider.checkBet(account, option());
      expect((await polymarketProvider.betting(account, retry)).success).toBe(true);
      expect(pmSubmitOrder).toHaveBeenCalledTimes(2);
    }
  });
  test.each([
    { success: true, status: "matched", takingAmount: "20" },
    { success: false, errorMsg: "INVALID_ORDER_DUPLICATED" },
    { error: "Bad Gateway" },
  ])("BUY responses without an acceptance receipt return ordinary failures: %j", async response => {
    pmSubmitOrder.mockResolvedValueOnce(response);
    const account = pmBettingAccount();
    const checked = await polymarketProvider.checkBet(account, option());
    const failed = await polymarketProvider.betting(account, checked);
    expect(failed).toMatchObject({ success: false, pending: false, orderId: null });
    expect(failed.pmSubmitUnknown).not.toBe(true);
    expect(pmAccountSubmitAttempts(account)).toHaveLength(0);
    const retry = await polymarketProvider.checkBet(account, option());
    expect((await polymarketProvider.betting(account, retry)).success).toBe(true);
    expect(pmSubmitOrder).toHaveBeenCalledTimes(2);
  });
  test("a legacy unknown BUY journal does not block a new checked BUY or discard original recovery evidence", async () => {
    const account = pmBettingAccount();
    const checked = await polymarketProvider.checkBet(account, option());
    await polymarketProvider.betting(account, checked);
    const body = pmSubmitOrder.mock.calls[0][1];
    await expect(guardedPmSubmit(account, body, { version: 2, negRisk: false }, async () => {
      throw new Error("legacy lost ACK");
    })).rejects.toThrow("正在核对原单");
    const original = pmAccountSubmitAttempts(account)[0];
    const retry = await polymarketProvider.checkBet(account, option());
    expect((await polymarketProvider.betting(account, retry)).success).toBe(true);
    expect(pmSubmitOrder).toHaveBeenCalledTimes(2);
    expect(pmAccountSubmitAttempts(account)).toEqual([original]);
  });
  test("post-acceptance bookkeeping failure preserves the actual fill instead of enabling a retry", async () => {
    const account = pmBettingAccount();
    const checked = await polymarketProvider.checkBet(account, option());
    vi.spyOn(pmOrigin, "markPolymarketChangmenOrder").mockImplementation(() => { throw new Error("bookkeeping failed"); });
    const result = await polymarketProvider.betting(account, checked);
    expect(result).toMatchObject({ success: true, pending: false, orderId: "one" });
    expect(result.pmSubmitUnknown).not.toBe(true);
    expect(pmSubmitOrder).toHaveBeenCalledOnce();
  });
  test.each(["accountId", "target", "depth"])("changing %s before wallet preparation cannot bind unchecked inputs", async field => {
    const account = pmBettingAccount(); account.accountId = 47;
    const raw = option();
    let release!: (value: boolean) => void;
    const gate = new Promise<boolean>(resolve => { release = resolve; });
    const task = polymarketProvider.checkBet(account, raw, { prepareSigning: gate });
    // Public book/guard finish while wallet preparation is still pending.
    for (let i = 0; i < 12; i++) await Promise.resolve();
    if (field === "accountId") account.accountId = 48;
    if (field === "target") raw.target = "Away";
    if (field === "depth") setPmFokDepthBufferPrefs({ enabled: true, multiplier: 10 });
    release(true);
    const checked = await task;
    expect(checked.data).toBeNull();
    expect(pmSubmitOrder).not.toHaveBeenCalled();
    resetPmFokDepthBufferPrefsForTests();
  });
  test("overlapping checks cannot revive a rejected attempt when the first request finishes", async () => {
    const account = pmBettingAccount(); const raw = option(); raw.data = null;
    let release!: (value: boolean) => void;
    const gate = new Promise<boolean>(resolve => { release = resolve; });
    const first = polymarketProvider.checkBet(account, raw, { prepareSigning: gate });
    expect((await polymarketProvider.checkBet(account, raw)).data).toBeNull();
    release(true);
    expect((await first).data).toBeNull();
  });
  test.each(["tick", "minimum"])("invalid book %s cannot be hidden by cached tick metadata", async field => {
    notePmTickFrame(JSON.stringify({ event_type: "tick_size_change", asset_id: "123456789", new_tick_size: "0.005", timestamp: Date.now() }));
    pmGetBook.mockResolvedValue({ asset_id: "123456789", tick_size: field === "tick" ? "unsupported" : "0.005",
      min_order_size: field === "minimum" ? null : "5", neg_risk: false, asks: [{ price: "0.505", size: "100" }] });
    expect((await polymarketProvider.checkBet(pmBettingAccount(), option())).data).toBeNull();
  });
  test("unprepared or repeated-check attempts never trigger submission-time reads", async () => {
    const account = pmBettingAccount(); const raw = option();
    expect((await polymarketProvider.betting(account, raw)).success).toBe(false);
    expect(pmGetBook).not.toHaveBeenCalled();
    await polymarketProvider.checkBet(account, raw);
    const repeated = await polymarketProvider.checkBet(account, raw);
    expect(repeated.data).toBeNull(); expect(pmGetBook).toHaveBeenCalledOnce();
    expect((await polymarketProvider.betting(account, raw)).success).toBe(false);
    expect(pmSubmitOrder).not.toHaveBeenCalled();
  });
  test("concurrent consumption signs and submits once; no post-check market reads", async () => {
    const account = pmBettingAccount(); const checked = await polymarketProvider.checkBet(account, option());
    expect(checked.data).toBeTruthy();
    pmGetBook.mockClear(); polymarketPluginGet.mockClear();
    const result = await Promise.all([polymarketProvider.betting(account, checked), polymarketProvider.betting(account, checked)]);
    expect(result.filter(r => r.success)).toHaveLength(1);
    expect(pmSubmitOrder).toHaveBeenCalledOnce(); expect(pmGetBook).not.toHaveBeenCalled(); expect(polymarketPluginGet).not.toHaveBeenCalled();
  });
  test.each(["local", "vps"] as const)("%s order choice preserves builder attribution in the signed buy body", async mode => {
    setPmOrderSubmitMode(mode);
    const account = pmBettingAccount();
    const checked = await polymarketProvider.checkBet(account, option());
    expect((await polymarketProvider.betting(account, checked)).success).toBe(true);
    expect(pmSubmitOrder).toHaveBeenCalledOnce();
    expect(pmSubmitOrder.mock.calls[0][1]).toMatchObject({
      orderType: "FOK", order: { builder: POLYMARKET_BUILDER_CODE_DEFAULT, signature: expect.stringMatching(/^0x/) },
    });
  });
  test.each(["amount", "token", "account", "data", "wallet", "submitRoute"])("changed %s cannot reuse a prepared attempt", async what => {
    const account = pmBettingAccount(); const checked = await polymarketProvider.checkBet(account, option());
    if (what === "amount") checked.betMoney += 1;
    if (what === "token") checked.itemId = "other";
    if (what === "account") account.token += " ";
    if (what === "data") checked.data = { ...checked.data };
    if (what === "wallet") clearPolymarketOrderClientCacheForTests();
    if (what === "submitRoute") setPmOrderSubmitMode("local");
    pmGetBook.mockClear();
    expect((await polymarketProvider.betting(account, checked)).success).toBe(false);
    expect(pmSubmitOrder).not.toHaveBeenCalled(); expect(pmGetBook).not.toHaveBeenCalled();
  });
  test("known newer tick invalidates the frozen price without rebuilding", async () => {
    const account = pmBettingAccount(); const checked = await polymarketProvider.checkBet(account, option());
    notePmTickFrame(JSON.stringify({ event_type: "tick_size_change", asset_id: "123456789", new_tick_size: "0.01", timestamp: Date.now() }));
    expect((await polymarketProvider.betting(account, checked)).success).toBe(false);
    expect(pmSubmitOrder).not.toHaveBeenCalled();
  });
  test("precheck-only has no wallet requirement but is not executable", async () => {
    const account = accountWithToken("{}");
    const checked = await polymarketProvider.checkBet(account, option(), { role: "precheckOnly" });
    expect(checked.data).toBeTruthy();
    expect((await polymarketProvider.betting(account, checked)).success).toBe(false);
    expect(pmSubmitOrder).not.toHaveBeenCalled();
  });
  test("wallet preparation is concurrent with book and completes before execute succeeds", async () => {
    let release!: (ready: boolean) => void;
    const ready = new Promise<boolean>(resolve => { release = resolve; });
    const account = pmBettingAccount(); let done = false;
    const task = polymarketProvider.checkBet(account, option(), { prepareSigning: ready }).then(r => { done = true; return r; });
    expect(pmGetBook).toHaveBeenCalledOnce(); await Promise.resolve(); expect(done).toBe(false);
    release(true); expect((await task).data).toBeTruthy();
  });
  test("failed submit consumes the attempt permanently", async () => {
    const account = pmBettingAccount(); const checked = await polymarketProvider.checkBet(account, option());
    pmSubmitOrder.mockRejectedValue(new Error("Network Error"));
    expect((await polymarketProvider.betting(account, checked)).success).toBe(false);
    expect((await polymarketProvider.betting(account, checked)).success).toBe(false);
    expect(pmSubmitOrder).toHaveBeenCalledOnce();
  });
  test.each(["future", "", null])("unknown book version %s fails in precheck", async version => {
    pmGetBook.mockResolvedValue({ asset_id: "123456789", version, tick_size: "0.01", min_order_size: "5", neg_risk: false, asks: [{ price: "0.5", size: "100" }] });
    const checked = await polymarketProvider.checkBet(pmBettingAccount(), option());
    expect(checked.data).toBeNull(); expect(checked.checkError).toContain("版本无效");
  });
  test("v2 book routes to Exchange V3 and preserves position ID", async () => {
    pmGetBook.mockResolvedValue({ asset_id: "123456789", version: "v2", tick_size: "0.005", min_order_size: "5", neg_risk: false, asks: [{ price: "0.505", size: "100" }] });
    const account = pmBettingAccount(); const checked = await polymarketProvider.checkBet(account, option());
    expect(checked.data?.orderOptions).toMatchObject({ version: 3 });
    expect((await polymarketProvider.betting(account, checked)).success).toBe(true);
    expect(pmSubmitOrder.mock.calls[0][1]).toMatchObject({ orderType: "FOK", order: { tokenId: "123456789" } });
  });
});
