/**
 * Predict.fun 用户自有账号 token。
 * 官网鉴权（Predict Account）：Privy 私钥 + Predict Account 地址；
 * API Key 由平台共用，JWT 运行时签发，均不写入用户 token。
 * @see https://dev.predict.fun/doc-663127
 */

import { Wallet } from "ethers";

export interface PredictFunTokenConfig {
  /** @deprecated 旧会员占位；保存时剔除 */
  mode?: string;
  house?: boolean;
  privateKey?: string;
  private_key?: string;
  privyPrivateKey?: string;
  privy_private_key?: string;
  predictAccount?: string;
  predict_account?: string;
  walletAddress?: string;
  address?: string;
}

function parseJsonObject(text: string | undefined): PredictFunTokenConfig | undefined {
  if (!text)
    return undefined;
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? parsed as PredictFunTokenConfig : undefined;
  }
  catch {
    return undefined;
  }
}

export function parsePredictFunTokenConfig(raw: string | undefined): PredictFunTokenConfig {
  const text = raw?.trim();
  if (!text)
    return {};
  return parseJsonObject(text) ?? {};
}

/** 规范化 0x + 64 hex 私钥 */
export function normalizePredictFunPrivateKey(raw: string): string {
  const key = String(raw ?? "").trim();
  if (!key)
    return "";
  return key.startsWith("0x") || key.startsWith("0X") ? key : `0x${key}`;
}

export function isValidPredictFunPrivateKey(raw: string): boolean {
  return /^0x[0-9a-fA-F]{64}$/.test(normalizePredictFunPrivateKey(raw));
}

export function isValidPredictFunAddress(raw: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(String(raw ?? "").trim());
}

export function resolvePredictFunPrivateKey(config: PredictFunTokenConfig): string {
  const key = String(config.privateKey ?? config.private_key ?? "").trim();
  if (!key)
    return "";
  return normalizePredictFunPrivateKey(key);
}

export function resolvePredictFunPrivyPrivateKey(config: PredictFunTokenConfig): string {
  const key = String(config.privyPrivateKey ?? config.privy_private_key ?? "").trim();
  if (!key)
    return "";
  return normalizePredictFunPrivateKey(key);
}

/**
 * 由 Privy 私钥推导 EOA 地址（充 BNB / gas 用；≠ Predict 智能钱包）。
 * 无效钥返回空串。
 */
export function resolvePredictFunPrivyAddressFromPrivateKey(raw: string): string {
  const pk = normalizePredictFunPrivateKey(raw);
  if (!isValidPredictFunPrivateKey(pk))
    return "";
  try {
    return String(new Wallet(pk).address || "").trim();
  }
  catch {
    return "";
  }
}

export function resolvePredictFunPredictAccount(config: PredictFunTokenConfig): string {
  return String(
    config.predictAccount
    ?? config.predict_account
    ?? config.walletAddress
    ?? config.address
    ?? "",
  ).trim();
}

/**
 * 本机开发：从 Vite env 读主号凭证（勿打进生产包；仅 .env.local）。
 * 用于 River 等测试号在无私钥落库时仍能刷余额/签单。
 */
export function resolvePredictFunEnvFallbackCredentials(): {
  privyPrivateKey: string;
  predictAccount: string;
} {
  const env = typeof import.meta !== "undefined" ? import.meta.env : undefined;
  const predictAccount = String(env?.VITE_PREDICT_FUN_PREDICT_ACCOUNT ?? "").trim();
  const privyPrivateKey = normalizePredictFunPrivateKey(
    String(env?.VITE_PREDICT_FUN_PRIVY_PRIVATE_KEY ?? ""),
  );
  return {
    predictAccount: isValidPredictFunAddress(predictAccount) ? predictAccount : "",
    privyPrivateKey: isValidPredictFunPrivateKey(privyPrivateKey) ? privyPrivateKey : "",
  };
}

/** 会话内存：若 token 缺 Privy/地址，用本机 VITE_ 主号凭证补齐（地址须一致或为空） */
export function applyPredictFunEnvFallbackToToken(rawToken: string | undefined): string | undefined {
  const env = resolvePredictFunEnvFallbackCredentials();
  if (!env.privyPrivateKey || !env.predictAccount)
    return rawToken;
  const cfg = parsePredictFunTokenConfig(rawToken);
  const fromToken = resolvePredictFunPredictAccount(cfg);
  if (fromToken && fromToken.toLowerCase() !== env.predictAccount.toLowerCase())
    return rawToken;
  const predictAccount = fromToken || env.predictAccount;
  const privyPrivateKey = resolvePredictFunPrivyPrivateKey(cfg) || env.privyPrivateKey;
  if (!isValidPredictFunPrivateKey(privyPrivateKey) || !isValidPredictFunAddress(predictAccount))
    return rawToken;
  return buildPredictFunMemoryToken({ predictAccount, privyPrivateKey });
}

/** 落库/上报：仅 Predict Account，无私钥 */
export function buildPredictFunPersistToken(predictAccount: string): string {
  const addr = String(predictAccount ?? "").trim();
  if (!isValidPredictFunAddress(addr))
    throw new Error("Predict Account 须为 0x 开头的 40 位十六进制地址");
  return JSON.stringify({ predictAccount: addr });
}

/** 会话内存：persist + Privy 钥（供后续 JWT/下单） */
export function buildPredictFunMemoryToken(params: {
  predictAccount: string;
  privyPrivateKey: string;
}): string {
  const persist = JSON.parse(buildPredictFunPersistToken(params.predictAccount)) as PredictFunTokenConfig;
  const pk = normalizePredictFunPrivateKey(params.privyPrivateKey);
  if (!isValidPredictFunPrivateKey(pk))
    throw new Error("Privy 私钥格式无效（须为 0x + 64 hex）");
  return JSON.stringify({
    ...persist,
    privyPrivateKey: pk,
  });
}
