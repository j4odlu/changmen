import { beforeEach, expect, test, vi } from "vitest";
import type { PlatformAccount } from "@changmen/client-core/models/platformAccount";
import { clearPmSubmitJournalForTests, finishPmSubmitAttempt, guardedPmSubmit,
  pmAccountSubmitAttempts, pmSubmitScope, PmSubmitUnknownError } from "./pmSubmitJournal";
import { getPolymarketOrderClientRuntime } from "./pmOrderClientCache";
import { resolveApiCreds } from "./l2Auth";
const owner = vi.hoisted(() => ({ userId: 1 as unknown }));
vi.mock("../shared/webBridge", () => ({ useUserStore: () => owner }));

const config = { walletAddress: "0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf",
  privateKey: `0x${"0".repeat(63)}1`, signatureType: 3,
  funder: "0x8ed24e533d24c2f381983eda8f97c2358f8d65e5",
  apiKey: "api-key", secret: "c2VjcmV0", passphrase: "pass" };
const account = { accountId: 9001, provider: "Polymarket", gateway: "https://clob.polymarket.com",
  token: JSON.stringify(config) } as PlatformAccount;
const context = { version: 2 as const, negRisk: false };
async function body(side: "BUY" | "SELL" = "BUY", tokenID = "123") {
  const { runtime: { builder, builderCode, clob } } = await getPolymarketOrderClientRuntime({ gateway: account.gateway,
    privateKey: config.privateKey as `0x${string}`, config, creds: resolveApiCreds(config), signatureType: 3 });
  return clob.orderToJsonV2(await builder.buildMarketOrder({ tokenID, price: 0.5, amount: 10, side, builderCode },
    { tickSize: "0.01", negRisk: false }, 2) as any, "api-key", clob.OrderType.FOK);
}
beforeEach(() => { localStorage.clear(); clearPmSubmitJournalForTests(); vi.restoreAllMocks(); vi.unstubAllGlobals(); owner.userId = 1; });

test("an unlocked browser with a UUID user can submit and retains per-user recovery isolation", async () => {
  vi.stubGlobal("window", {});
  vi.stubGlobal("navigator", { locks: { request: async (_key: string, run: () => Promise<unknown>) => run() } });
  const userA = "11111111-1111-4111-8111-111111111111";
  const userB = "22222222-2222-4222-8222-222222222222";
  owner.userId = userA;
  const post = vi.fn(async () => { throw new Error("lost ACK"); });
  await expect(guardedPmSubmit(account, await body(), context, post)).rejects.toBeInstanceOf(PmSubmitUnknownError);
  expect(post).toHaveBeenCalledOnce();
  const originalScope = pmSubmitScope(account);
  expect(pmAccountSubmitAttempts(account)).toHaveLength(1);
  owner.userId = userB;
  expect(pmSubmitScope(account)).not.toBe(originalScope);
  expect(pmAccountSubmitAttempts(account)).toHaveLength(0);
  owner.userId = userA;
  const retry = vi.fn();
  await expect(guardedPmSubmit(account, await body(), context, retry)).rejects.toBeInstanceOf(PmSubmitUnknownError);
  expect(retry).not.toHaveBeenCalled();
});

test.each([0, -1, NaN, Infinity, undefined, null, "", " ", "0", "-1", "undefined", "not-a-user-id"])(
  "an invalid browser user remains blocked before dispatch: %s", async (userId) => {
    vi.stubGlobal("window", {});
    owner.userId = userId;
    const post = vi.fn();
    await expect(guardedPmSubmit(account, await body(), context, post)).rejects.toThrow("PM 用户会话尚未准备好");
    expect(post).not.toHaveBeenCalled();
    expect(localStorage.length).toBe(0);
  });

test.each([1, "1"])("legacy positive user IDs remain valid without changing their scope: %s", (userId) => {
  owner.userId = userId;
  const scopeBeforeBrowser = pmSubmitScope(account);
  vi.stubGlobal("window", {});
  expect(pmSubmitScope(account)).toBe(scopeBeforeBrowser);
});

test("dispatch is durable before POST; lost ACK survives restart and blocks a fresh signature", async () => {
  const order = await body();
  const submit = vi.fn(async () => {
    expect(pmAccountSubmitAttempts(account)[0].state).toBe("dispatching");
    throw new Error("network timeout");
  });
  await expect(guardedPmSubmit(account, order, context, submit)).rejects.toBeInstanceOf(PmSubmitUnknownError);
  const original = pmAccountSubmitAttempts(account)[0];
  expect(original.state).toBe("submit_unknown");
  clearPmSubmitJournalForTests();
  const resend = vi.fn();
  await expect(guardedPmSubmit(account, await body(), context, resend)).rejects.toMatchObject({ attempt: original });
  expect(resend).not.toHaveBeenCalled();
  expect(submit).toHaveBeenCalledOnce();
  const raw = localStorage.getItem("changmen:pm:submission:v1:" + original.id)!;
  for (const secret of [config.privateKey, config.secret, config.passphrase, config.apiKey, order.order.signature])
    expect(raw).not.toContain(secret);
});

test("storage failure stops before POST", async () => {
  const order = await body();
  vi.spyOn(localStorage, "setItem").mockImplementation(() => { throw new Error("quota"); });
  const submit = vi.fn();
  await expect(guardedPmSubmit(account, order, context, submit)).rejects.toThrow("quota");
  expect(submit).not.toHaveBeenCalled();
});

test("an empty success response stays unknown; explicit FOK rejection releases the attempt", async () => {
  const submit = vi.fn().mockResolvedValue({ success: false, errorMsg: "FOK_ORDER_NOT_FILLED_ERROR" });
  await guardedPmSubmit(account, await body(), context, submit);
  expect(pmAccountSubmitAttempts(account)).toHaveLength(0);
  await expect(guardedPmSubmit(account, await body(), context, async () => ({}))).rejects.toBeInstanceOf(PmSubmitUnknownError);
});

test("accepted SELL reserves its asset across different parent buys until accounting completes", async () => {
  await guardedPmSubmit(account, await body("SELL"), { ...context, parentBuyId: "buy-a" },
    async () => ({ success: true, orderID: "official-sell", status: "matched" }));
  const post = vi.fn();
  await expect(guardedPmSubmit(account, await body("SELL"), { ...context, parentBuyId: "buy-b" }, post)).rejects.toBeInstanceOf(PmSubmitUnknownError);
  expect(post).not.toHaveBeenCalled();
  await guardedPmSubmit(account, await body("SELL", "124"), { ...context, parentBuyId: "buy-c" },
    async () => ({ success: false, errorMsg: "FOK_ORDER_NOT_FILLED_ERROR" }));
  finishPmSubmitAttempt(account, "official-sell");
  await guardedPmSubmit(account, await body("SELL"), { ...context, parentBuyId: "buy-b" },
    async () => ({ success: false, errorMsg: "FOK_ORDER_NOT_FILLED_ERROR" }));
});

test("an ACK cannot become a failure when persisting the accepted state fails", async () => {
  const order = await body();
  const ack = { success: true, orderID: "official-id", status: "matched" };
  expect(await guardedPmSubmit(account, order, context, async () => {
    vi.spyOn(localStorage, "setItem").mockImplementation(() => { throw new Error("quota"); });
    return ack;
  })).toBe(ack);
  expect(pmAccountSubmitAttempts(account)[0].state).toBe("dispatching");
});

test("Web Locks serializes concurrent tabs and the second tab rechecks durable uncertainty", async () => {
  let tail = Promise.resolve();
  const request = vi.fn((_key: string, run: () => Promise<unknown>) => {
    const next = tail.then(run);
    tail = next.then(() => undefined, () => undefined);
    return next;
  });
  vi.stubGlobal("navigator", { locks: { request } });
  const firstBody = await body(); const secondBody = await body();
  let fail!: (error: Error) => void;
  const first = guardedPmSubmit(account, firstBody, context, () => new Promise((_resolve, reject) => { fail = reject; }));
  const firstChecked = expect(first).rejects.toBeInstanceOf(PmSubmitUnknownError);
  await Promise.resolve();
  const post = vi.fn();
  const second = guardedPmSubmit(account, secondBody, context, post);
  const secondChecked = expect(second).rejects.toBeInstanceOf(PmSubmitUnknownError);
  fail(new Error("ACK lost"));
  await Promise.all([firstChecked, secondChecked]);
  expect(post).not.toHaveBeenCalled();
  expect(request.mock.calls[0][0]).toBe(request.mock.calls[1][0]);
});

test("user/wallet isolation; renewing API credentials cannot bypass an unknown order on the same wallet", async () => {
  await expect(guardedPmSubmit(account, await body(), context, async () => { throw new Error("timeout"); }))
    .rejects.toBeInstanceOf(PmSubmitUnknownError);
  const renewed = { ...account, token: JSON.stringify({ ...config, apiKey: "renewed-key" }) } as PlatformAccount;
  expect(pmAccountSubmitAttempts(renewed)).toHaveLength(1);
  const switched = { ...account, token: JSON.stringify({ ...config, funder: "0x1111111111111111111111111111111111111111" }) } as PlatformAccount;
  expect(pmAccountSubmitAttempts(switched)).toHaveLength(0);
  owner.userId = 2;
  expect(pmAccountSubmitAttempts(account)).toHaveLength(0);
});

test("a session that expires while waiting for a lock is rejected before dispatch", async () => {
  vi.stubGlobal("navigator", { locks: { request: async (_key: string, run: () => Promise<unknown>) => run() } });
  const post = vi.fn();
  await expect(guardedPmSubmit(account, await body(), { ...context,
    validateBeforeDispatch: () => { throw new Error("会话已失效"); } }, post)).rejects.toThrow("会话已失效");
  expect(post).not.toHaveBeenCalled();
  expect(pmAccountSubmitAttempts(account)).toHaveLength(0);
});

test("a user switch while waiting for Web Locks stops dispatch before persisting or posting", async () => {
  vi.stubGlobal("navigator", { locks: { request: async (_key: string, run: () => Promise<unknown>) => {
    owner.userId = 2;
    return run();
  } } });
  const post = vi.fn();
  await expect(guardedPmSubmit(account, await body(), context, post)).rejects.toThrow("PM 用户或钱包已改变");
  expect(post).not.toHaveBeenCalled();
  expect(pmAccountSubmitAttempts(account)).toHaveLength(0);
});

test("an unknown manual BUY cannot be adopted by a new arbitrage link or a changed stake", async () => {
  const recovery = { matchId: "match", venueBetId: "condition", itemId: "123", target: "Home", betMoney: 10, odds: 2 };
  await expect(guardedPmSubmit(account, await body(), { ...context, recovery }, async () => { throw new Error("lost ACK"); }))
    .rejects.toBeInstanceOf(PmSubmitUnknownError);
  for (const changed of [{ ...recovery, linkId: 99 }, { ...recovery, betMoney: 20 }]) {
    const post = vi.fn();
    await expect(guardedPmSubmit(account, await body(), { ...context, recovery: changed }, post))
      .rejects.toThrow("另一笔提交仍待确认");
    expect(post).not.toHaveBeenCalled();
  }
});

test("matched SELL receipt quantities remain durable until accounting finishes", async () => {
  await guardedPmSubmit(account, await body("SELL"), { ...context, parentBuyId: "buy-a" },
    async () => ({ success: true, orderID: "sell-ack", status: "matched", makingAmount: "10", takingAmount: "6" }));
  clearPmSubmitJournalForTests();
  expect(pmAccountSubmitAttempts(account)[0].evidence).toEqual({
    row: { id: "sell-ack", status: "matched", size_matched: "10" }, trade: { size: "10", price: "0.6" },
  });
});

test("a duplicate error in an HTTP 200 business response retains original-order uncertainty", async () => {
  await expect(guardedPmSubmit(account, await body(), context,
    async () => ({ success: false, errorMsg: "INVALID_ORDER_DUPLICATED" })))
    .rejects.toBeInstanceOf(PmSubmitUnknownError);
  expect(pmAccountSubmitAttempts(account)[0].state).toBe("submit_unknown");
});

test.each([{ success: true, orderID: "  " }, { success: true, orderID: {} },
  { success: false, error: { message: "proxy failed" } }, { success: false, errorMsg: {} }])(
  "malformed response remains unknown rather than a false ACK or retryable failure: %j", async (response) => {
    await expect(guardedPmSubmit(account, await body(), context, async () => response)).rejects.toBeInstanceOf(PmSubmitUnknownError);
    expect(pmAccountSubmitAttempts(account)[0].state).toBe("submit_unknown");
  });
