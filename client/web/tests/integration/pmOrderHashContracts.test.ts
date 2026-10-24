import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { getContractConfig } from "@polymarket/clob-client-v2";
import type { PlatformAccount } from "@changmen/client-core/models/platformAccount";
import { POLYGON_POLYMARKET, polymarketTradeSpenders } from "@changmen/venue-browser/polymarket/wallet/contracts";
import { acceptPmSubmitAttempt, clearPmSubmitJournalForTests, finishPmSubmitAttempt,
  guardedPmSubmit, pmAccountSubmitAttempts, pmSignedOrderHash, pmSubmitAttemptForOrder,
  pmSubmitScope, PmSubmitUnknownError } from "@changmen/venue-browser/polymarket/submission/recovery/pmSubmitJournal";

vi.mock("@changmen/venue-browser/shared/webBridge", () => ({ useUserStore: () => ({ userId: 1 }) }));

// Captured before decoupling from CLOB 1.2.0 / getContractConfig(137).
// Keep literal digests so a domain/address/field change cannot rewrite the oracle.
const vectors = [
  { version: 2, negRisk: false, side: "BUY", hash: "0x267900401c7c7b7af62321ff73af107099cf1a967f5bd83ce966a7877a2884fe" },
  { version: 2, negRisk: false, side: "SELL", hash: "0xd92811f14e37a0fba0de3e3098ea3bd029a23350b4f4b9a20e612dc6aa235690" },
  { version: 2, negRisk: true, side: "BUY", hash: "0x93cddaef11bfeb32d7b142691c1b417bc24c79959025ccd85bf43c027188a8cc" },
  { version: 2, negRisk: true, side: "SELL", hash: "0xe5aae0e352d7b07136c32f89a13378f9ba12415aa894fd4a4973afa18972858e" },
  { version: 3, negRisk: false, side: "BUY", hash: "0xa8e10b505e7808b9671e7619f7154c13e5f3c65387f5bdd3169592ce007c7390" },
  { version: 3, negRisk: false, side: "SELL", hash: "0xb3dd1c8d6c209487096a178be40e213765047086a5a3ee85c37b787d47b8769e" },
  { version: 3, negRisk: true, side: "BUY", hash: "0xa8e10b505e7808b9671e7619f7154c13e5f3c65387f5bdd3169592ce007c7390" },
  { version: 3, negRisk: true, side: "SELL", hash: "0xb3dd1c8d6c209487096a178be40e213765047086a5a3ee85c37b787d47b8769e" },
] as const;
const orderFields = {
  salt: "123456789", maker: "0x8ed24e533d24c2f381983eda8f97c2358f8d65e5",
  signer: "0x8ed24e533d24c2f381983eda8f97c2358f8d65e5",
  tokenId: "1234567890123456789012345678901234567890",
  makerAmount: "101234567", takerAmount: "202469135", signatureType: 3,
  timestamp: "1700000000000", metadata: `0x${"00".repeat(32)}`, builder: `0x${"11".repeat(32)}`,
};
const account = { accountId: 9001, provider: "Polymarket", gateway: "https://clob.polymarket.com",
  token: JSON.stringify({ walletAddress: "0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf",
    funder: orderFields.maker, signatureType: 3, apiKey: "key", secret: "c2VjcmV0", passphrase: "pass" }) } as PlatformAccount;

beforeEach(() => { localStorage.clear(); clearPmSubmitJournalForTests(); });
afterEach(() => { localStorage.clear(); clearPmSubmitJournalForTests(); });

test.each(vectors)("preserves the pre-migration hash: v$version negRisk=$negRisk $side", vector => {
  const order = Object.freeze({ ...orderFields, side: vector.side });
  expect(pmSignedOrderHash(order, vector)).toBe(vector.hash);
  expect(pmSignedOrderHash({ ...order, side: vector.side === "BUY" ? 0 : 1 }, vector)).toBe(vector.hash);
  expect(order).toEqual({ ...orderFields, side: vector.side });
});

test.each(vectors)("legacy recovery remains locked and can finish by official ID: v$version negRisk=$negRisk $side", async vector => {
  const order = { ...orderFields, side: vector.side };
  const id = "11111111-1111-4111-8111-111111111111";
  const key = "changmen:pm:submission:v1:" + id;
  const row = { id, scope: pmSubmitScope(account), accountId: account.accountId,
    orderHash: vector.hash, state: "submit_unknown", submittedAt: 1_700_000_000_000,
    side: vector.side, tokenId: order.tokenId, makerAmount: order.makerAmount, takerAmount: order.takerAmount };
  const raw = JSON.stringify(row);
  localStorage.setItem(key, raw);
  clearPmSubmitJournalForTests(); // Simulate a reload with only the old persisted record.
  const hash = pmSignedOrderHash(order, vector);
  expect(pmSubmitAttemptForOrder(account, hash)).toEqual(row);
  expect(localStorage.getItem(key)).toBe(raw);
  const resend = vi.fn();
  await expect(guardedPmSubmit(account, { order }, vector, resend)).rejects.toBeInstanceOf(PmSubmitUnknownError);
  expect(resend).not.toHaveBeenCalled();
  const officialId = "0x" + "ab".repeat(32);
  acceptPmSubmitAttempt(account, hash, officialId);
  clearPmSubmitJournalForTests();
  expect(pmSubmitAttemptForOrder(account, officialId)).toEqual({ ...row, state: "accepted", acceptedOrderId: officialId });
  expect(pmSubmitAttemptForOrder(account, hash)?.acceptedOrderId).toBe(officialId);
  finishPmSubmitAttempt(account, officialId);
  expect(pmAccountSubmitAttempts(account)).toEqual([]);
  expect(localStorage.getItem(key)).toBeNull();
});

test("Polygon contracts match the pinned SDK; recovery configuration does not expand V2 approvals", () => {
  const contracts = getContractConfig(137);
  expect(POLYGON_POLYMARKET.CTF_EXCHANGE).toBe(contracts.exchangeV2);
  expect(POLYGON_POLYMARKET.NEG_RISK_EXCHANGE).toBe(contracts.negRiskExchangeV2);
  expect(POLYGON_POLYMARKET.CTF_EXCHANGE_V3).toBe(contracts.exchangeV3);
  expect(polymarketTradeSpenders()).toEqual([
    "0xE111180000d2663C0091e4f400237545B87B996B", "0xe2222d279d744050d28e00520010520000310F59",
    "0xAdA100Db00Ca00073811820692005400218FcE1f", "0xadA2005600Dec949baf300f4C6120000bDB6eAab",
  ]);
  expect(polymarketTradeSpenders()).not.toContain(contracts.exchangeV3);
});
