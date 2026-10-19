/**
 * Predict.fun 主号 / house 中转已下线。
 * `isPredictFunHouseMode()` 恒为 false；用户需自有账号下注（后续接入）。
 */

import type { PlatformAccount } from "@changmen/client-core/models/platformAccount";

import {
  parsePredictFunTokenConfig,
  resolvePredictFunPrivateKey,
  resolvePredictFunPrivyPrivateKey,
  resolvePredictFunPredictAccount,
  type PredictFunTokenConfig,
} from "./credentials";

/** @deprecated 会员中转已下线；保留常量避免旧 import 断裂 */
export const PREDICT_FUN_ACCOUNT_MODE = "house" as const;

export interface PredictFunMasterCredentials {
  privateKey: string;
  predictAccount?: string;
  privyPrivateKey?: string;
  source: "env" | "account";
}

function credentialsFromConfig(
  config: PredictFunTokenConfig,
  source: PredictFunMasterCredentials["source"],
): PredictFunMasterCredentials | null {
  const predictAccount = resolvePredictFunPredictAccount(config);
  const privyPrivateKey = resolvePredictFunPrivyPrivateKey(config);
  const privateKey = resolvePredictFunPrivateKey(config) || privyPrivateKey;
  if (!privateKey)
    return null;
  return {
    privateKey,
    predictAccount: predictAccount || undefined,
    privyPrivateKey: privyPrivateKey || undefined,
    source,
  };
}

/**
 * @deprecated 浏览器下单已废弃；下单走 Pf_*。仅保留给运维脚本/测试探测。
 */
export function resolvePredictFunMasterCredentials(
  account?: PlatformAccount,
): PredictFunMasterCredentials | null {
  const cfg = parsePredictFunTokenConfig(account?.token);
  return credentialsFromConfig(cfg, "account");
}

/** 会员中转已下线 */
export function isPredictFunHouseMode(): boolean {
  return false;
}

/** 用户侧账号是否为旧 house 占位（无 predict.fun 凭证） */
export function isPredictFunHousePlaceholderAccount(account: PlatformAccount): boolean {
  const cfg = parsePredictFunTokenConfig(account.token);
  if (cfg.house === true || String(cfg.mode ?? "").toLowerCase() === "house")
    return true;
  if (resolvePredictFunPrivateKey(cfg) || resolvePredictFunPrivyPrivateKey(cfg))
    return false;
  return true;
}
