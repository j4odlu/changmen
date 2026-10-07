import { beforeEach, afterEach, expect, test, vi } from "vitest";
import { getPolymarketOrderClientRuntime, clearPolymarketOrderClientCacheForTests, hasPolymarketOrderClientRuntime } from "./pmOrderClientCache";
import { resolveApiCreds } from "./l2Auth";
import { pmSignedOrderHash } from "./pmSubmitJournal";

const config = { walletAddress: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266", privateKey: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  apiCreds: { apiKey: "key", secret: "c2VjcmV0", passphrase: "pass" } };
const input = { gateway: "https://clob.polymarket.com", privateKey: config.privateKey as `0x${string}`, config,
  creds: resolveApiCreds(config), signatureType: 0 };
beforeEach(() => clearPolymarketOrderClientCacheForTests());
afterEach(() => vi.restoreAllMocks());

test("concurrent initialization shares runtime; locking while loading cannot revive cache", async () => {
  const first = getPolymarketOrderClientRuntime(input);
  clearPolymarketOrderClientCacheForTests();
  await expect(first).rejects.toThrow("会话已失效");
  expect(hasPolymarketOrderClientRuntime(input)).toBe(false);
  const [a, b] = await Promise.all([getPolymarketOrderClientRuntime(input), getPolymarketOrderClientRuntime(input)]);
  expect(a.runtime).toBe(b.runtime);
  expect((await getPolymarketOrderClientRuntime(input)).cacheHit).toBe(true);
}, 20_000);

test("432 SDK vectors: BUY/SELL × 4 wallet types × 3 routes × 6 ticks × 3 amounts, identical FOK body with zero network", async () => {
  const fetchMock = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("unexpected fetch"));
  const axios = (await import("axios")).default;
  const httpMocks = ["request", "get", "post"] .map(method => vi.spyOn(axios, method as "request").mockRejectedValue(new Error("unexpected HTTP")));
  const { verifyTypedData, hashTypedData } = await import("viem");
  vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
  vi.spyOn(Math, "random").mockReturnValue(0.125);
  let vectors = 0;
  for (const signatureType of [0, 1, 2, 3]) {
    const funder = signatureType ? "0x8ed24e533d24c2f381983eda8f97c2358f8d65e5" : undefined;
    const { runtime } = await getPolymarketOrderClientRuntime({ ...input, signatureType, config: { ...config, funder } });
    const { clob, builder, builderCode } = runtime;
    const signer = (builder as any).signer;
    const sign = vi.spyOn(signer, "signTypedData");
    const high = new clob.ClobClient({ host: input.gateway, chain: 137, signer, signatureType,
      funderAddress: funder, builderConfig: { builderCode } }) as any;
    for (const [version, negRisk] of [[2, false], [2, true], [3, false]] as const) {
      for (const tickSize of ["0.1", "0.01", "0.005", "0.0025", "0.001", "0.0001"]) {
        for (const amount of [10.12, 100, 179.99]) {
          for (const side of [clob.Side.BUY, clob.Side.SELL]) {
          const tokenID = "123456789";
          // 高层 SDK 的对照样本使用显式真实测试费率；生产低层路径不写这些缓存。
          high.feeInfos[tokenID] = { rate: 0.07, exponent: 1 };
          high.builderFeeRates[builderCode] = { maker: 0.001, taker: 0.002 };
          high.tickSizes[tokenID] = tickSize; high.negRisk[tokenID] = negRisk;
          const user = { tokenID, price: 0.5, amount, side };
          const signed = await builder.buildMarketOrder({ ...user, builderCode }, { tickSize, negRisk } as any, version);
          expect(clob.orderToJsonV2(signed as any, "key", clob.OrderType.FOK).order.builder).toBe(builderCode);
          const params = sign.mock.calls.at(-1)![0] as any;
          const contracts = clob.getContractConfig(137);
          expect(params.domain.version).toBe(String(version));
          expect(params.domain.verifyingContract.toLowerCase()).toBe((version === 3 ? contracts.exchangeV3 : negRisk ? contracts.negRiskExchangeV2 : contracts.exchangeV2).toLowerCase());
          if (signatureType === 0) expect(await verifyTypedData({ ...params, address: config.walletAddress, signature: signed.signature })).toBe(true);
          if (signatureType === 3) {
            expect(params.primaryType).toBe("TypedDataSign");
            expect(params.message).toMatchObject({ name: "DepositWallet", version: "1", verifyingContract: funder });
            expect(signed).toMatchObject({ maker: funder, signer: funder, signatureType: 3 });
            expect(await verifyTypedData({ ...params, address: config.walletAddress,
              signature: signed.signature.slice(0, 132) as `0x${string}` })).toBe(true);
          }
          const orderMessage = signatureType === 3 ? params.message.contents : params.message;
          expect(pmSignedOrderHash(clob.orderToJsonV2(signed as any, "key", clob.OrderType.FOK).order,
            { version, negRisk })).toBe(hashTypedData({ domain: params.domain,
              types: { Order: params.types.Order }, primaryType: "Order", message: orderMessage }));
          const expected = await high.createMarketOrder(user, { tickSize, negRisk, version });
          expect(clob.orderToJsonV2(signed as any, "key", clob.OrderType.FOK)).toEqual(clob.orderToJsonV2(expected, "key", clob.OrderType.FOK));
          vectors++;
          }
        }
      }
    }
  }
  expect(vectors).toBe(432);
  expect(fetchMock).not.toHaveBeenCalled(); for (const mock of httpMocks) expect(mock).not.toHaveBeenCalled();
}, 30_000);
