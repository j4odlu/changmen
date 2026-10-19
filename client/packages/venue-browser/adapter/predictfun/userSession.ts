/**
 * 用户自有 Predict Account 会话：OrderBuilder + JWT（内存缓存，不落库）。
 * 凭证来自账号 token（Privy 钥 + predictAccount）；与运营主号 house 路径分离。
 */

import type { PlatformAccount } from "@changmen/client-core/models/platformAccount";

import { PREDICT_FUN_API } from "./api";
import { fetchPredictFunJwt } from "./auth";
import {
  isValidPredictFunAddress,
  isValidPredictFunPrivateKey,
  normalizePredictFunPrivateKey,
  parsePredictFunTokenConfig,
  resolvePredictFunEnvFallbackCredentials,
  resolvePredictFunPredictAccount,
  resolvePredictFunPrivyPrivateKey,
} from "./credentials";

export interface PredictFunOrderBuilderLike {
  balanceOf: (token?: "USDT", address?: string) => Promise<bigint>;
  signPredictAccountMessage?: (message: string) => Promise<string>;
  setApprovals?: () => Promise<{ success?: boolean }>;
  getMarketOrderAmounts: (input: unknown, book: unknown) => {
    makerAmount: bigint;
    takerAmount: bigint;
    pricePerShare: bigint;
    slippageBps: bigint;
    isMinAmountOut: boolean;
  };
  buildOrder: (strategy: string, opts: unknown) => unknown;
  buildTypedData: (order: unknown, opts: unknown) => unknown;
  signTypedDataOrder: (typed: unknown) => Promise<Record<string, unknown>>;
  buildTypedDataHash: (typed: unknown) => string;
}

export interface PredictFunUserSession {
  orderBuilder: PredictFunOrderBuilderLike;
  maker: string;
  privyAddress: string;
  getJwt: () => Promise<string>;
}

type BuilderCacheEntry = {
  key: string;
  orderBuilder: PredictFunUserSession["orderBuilder"];
  maker: string;
  privyAddress: string;
  signMessage: (message: string) => Promise<string>;
};

let builderCache: BuilderCacheEntry | null = null;

function resolveChainIdEnum(ChainId: { BnbMainnet: unknown; BnbTestnet: unknown }) {
  return String(PREDICT_FUN_API).includes("testnet")
    ? ChainId.BnbTestnet
    : ChainId.BnbMainnet;
}

function sessionCacheKey(privyPrivateKey: string, predictAccount: string): string {
  return `${normalizePredictFunPrivateKey(privyPrivateKey).toLowerCase()}:${predictAccount.toLowerCase()}`;
}

export function clearPredictFunUserSessionCache(): void {
  builderCache = null;
}

export function resolvePredictFunUserCredentials(account: PlatformAccount): {
  privyPrivateKey: string;
  predictAccount: string;
} {
  const cfg = parsePredictFunTokenConfig(account?.token);
  const env = resolvePredictFunEnvFallbackCredentials();
  let privyPrivateKey = resolvePredictFunPrivyPrivateKey(cfg)
    || normalizePredictFunPrivateKey(String(
      (cfg as { privateKey?: string }).privateKey
      ?? (cfg as { private_key?: string }).private_key
      ?? "",
    ));
  let predictAccount = resolvePredictFunPredictAccount(cfg);

  if (!predictAccount && env.predictAccount)
    predictAccount = env.predictAccount;
  if (!isValidPredictFunPrivateKey(privyPrivateKey) && env.privyPrivateKey) {
    if (!predictAccount || predictAccount.toLowerCase() === env.predictAccount.toLowerCase())
      privyPrivateKey = env.privyPrivateKey;
  }

  if (!isValidPredictFunPrivateKey(privyPrivateKey))
    throw new Error("PredictFun 缺少 Privy 私钥（请解锁本机钱包或配置 VITE_PREDICT_FUN_PRIVY_PRIVATE_KEY）");
  if (!isValidPredictFunAddress(predictAccount))
    throw new Error("PredictFun 缺少 Predict 智能钱包地址");
  return { privyPrivateKey, predictAccount };
}

async function ensureUserBuilder(
  privyPrivateKey: string,
  predictAccount: string,
): Promise<BuilderCacheEntry> {
  const key = sessionCacheKey(privyPrivateKey, predictAccount);
  if (builderCache?.key === key)
    return builderCache;

  const [{ OrderBuilder, ChainId }, { Wallet }] = await Promise.all([
    import("@predictdotfun/sdk"),
    import("ethers"),
  ]);
  const signer = new Wallet(privyPrivateKey);
  const privyAddress = await signer.getAddress();
  const orderBuilder = await OrderBuilder.make(
    resolveChainIdEnum(ChainId) as never,
    signer,
    { predictAccount },
  );
  const signMessage = async (message: string) => {
    if (typeof orderBuilder.signPredictAccountMessage === "function")
      return orderBuilder.signPredictAccountMessage(message);
    return signer.signMessage(message);
  };
  builderCache = {
    key,
    orderBuilder: orderBuilder as unknown as PredictFunOrderBuilderLike,
    maker: predictAccount,
    privyAddress,
    signMessage,
  };
  return builderCache;
}

/** 构建用户会话（OrderBuilder 缓存 + JWT 懒加载） */
export async function preparePredictFunUserSession(
  account: PlatformAccount,
): Promise<PredictFunUserSession> {
  const { privyPrivateKey, predictAccount } = resolvePredictFunUserCredentials(account);
  const built = await ensureUserBuilder(privyPrivateKey, predictAccount);
  return {
    orderBuilder: built.orderBuilder,
    maker: built.maker,
    privyAddress: built.privyAddress,
    getJwt: () => fetchPredictFunJwt({
      signer: built.maker,
      signMessage: built.signMessage,
    }),
  };
}

/** USDT wei → 两位小数 */
export function predictFunUsdtFromWei(wei: bigint): number {
  const whole = wei / 1000000000000000000n;
  const frac = wei % 1000000000000000000n;
  const asNumber = Number(whole) + Number(frac) / 1e18;
  if (!Number.isFinite(asNumber))
    return 0;
  return Math.round(asNumber * 100) / 100;
}
