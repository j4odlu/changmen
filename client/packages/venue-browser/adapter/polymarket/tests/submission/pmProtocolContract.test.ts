import { expect, test, vi } from "vitest";
import { createWalletClient, hashTypedData, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { OrderBuilder, Chain, Side, orderToJsonV2, OrderType, isV2Order } from "@polymarket/clob-client-v2";
import { pmSignedOrderHash } from "@changmen/venue-browser/polymarket/submission/recovery/pmSubmitJournal";
import { polymarketMarketOrderOptions } from "@changmen/venue-browser/polymarket/pmMarketOrderOptions";
import { polymarketMarketAssetIds } from "@changmen/shared/pm_market_assets";
import { getPolymarketMarketBlockReason } from "@changmen/venue-browser/polymarket/markets/pmMarketGuard";
import samples from "../fixtures/protocolMarkets.json";

const asset = samples[1]!.book.asset_id;
const cases = ([2, 3] as const).flatMap(version => [false, true].flatMap(negRisk => ([0, 1, 2, 3] as const).flatMap(signatureType => [Side.BUY, Side.SELL].map(side => ({ version, negRisk, signatureType, side })))));
test.each(cases)("official SDK domain/hash/serialization: $version/$negRisk/$signatureType/$side", async ({ version, negRisk, signatureType, side }) => {
  const account = privateKeyToAccount(`0x${"0".repeat(63)}1`);
  const maker = signatureType === 0 ? account.address : "0x0000000000000000000000000000000000000002";
  const signer = createWalletClient({ account, transport: http("http://127.0.0.1:1") });
  const captured: Parameters<typeof hashTypedData>[0][] = [];
  vi.spyOn(signer, "signTypedData").mockImplementation(async args => { captured.push(args as unknown as typeof captured[number]); return account.signTypedData(args as never); });
  const builder = new OrderBuilder(signer, Chain.POLYGON, signatureType, maker);
  const signed = await builder.buildMarketOrder({ tokenID: asset, side, price: 0.52, amount: 10 }, { tickSize: "0.01", negRisk }, version);
  const typed = captured[0];
  if (!isV2Order(signed) || !typed) throw new Error("SDK did not capture the expected order");
  const contract = version === 3 ? "0xe3333700ca9d93003f00f0f71f8515005f6c00aa" : negRisk ? "0xe2222d279d744050d28e00520010520000310f59" : "0xe111180000d2663c0091e4f400237545b87b996b";
  expect(typed.domain?.version).toBe(String(version));
  expect(String(typed.domain?.verifyingContract).toLowerCase()).toBe(contract);
  expect(signed.maker.toLowerCase()).toBe(maker.toLowerCase());
  expect(signed.signer.toLowerCase()).toBe((signatureType === 3 ? maker : account.address).toLowerCase());
  expect(signed.tokenId).toBe(asset);
  const message = signatureType === 3 ? (typed.message as { contents: unknown }).contents : typed.message;
  expect(pmSignedOrderHash(signed, { version, negRisk })).toBe(hashTypedData({ ...typed, primaryType: "Order", message } as Parameters<typeof hashTypedData>[0]));
  expect(orderToJsonV2(signed, "offline-api-key", OrderType.FOK).order).toMatchObject({ tokenId: asset, signatureType });
});

test.each(samples)("official $version Gamma/CLOB/book wire contract retains the same asset", sample => {
  const ids = polymarketMarketAssetIds(sample.gamma);
  expect(ids).toHaveLength(2);
  expect(sample.clob.tokens.map(row => row.token_id).sort()).toEqual([...ids].sort());
  expect(getPolymarketMarketBlockReason(sample.clob, sample.book.asset_id, "clob", sample.gamma.conditionId)).toBeNull();
  expect(polymarketMarketOrderOptions(sample.book, sample.book.asset_id, sample.gamma.conditionId).version).toBe(sample.version === "v2" ? 3 : 2);
  expect(() => polymarketMarketOrderOptions(sample.book, sample.book.asset_id, "wrong-condition")).toThrow("订单簿结构");
});
