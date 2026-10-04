/**
 * 账号列表：合并本机钥 / 落库 DTO 投影（Polymarket + PredictFun）
 */

import type { PlatformAccount } from "@/models/platformAccount";
import {
  extractPrivateKeyFromToken,
  isVaultKeyProvider,
  isPolymarketProvider,
  mergePrivateKeyIntoToken,
  tokenWalletAddress,
  toPersistTokenForProvider,
} from "./tokenStrip";
import {
  getCachedPrivateKey,
  isPmVaultUnlocked,
  putPrivateKeyInVault,
} from "./session";
import { getRetainedPmPrivateKey } from "./retainedPmSession";

export function mergeVaultKeysIntoAccounts(
  accounts: PlatformAccount[],
  userId: string,
): { merged: number; pendingMigrate: number } {
  let merged = 0;
  let pendingMigrate = 0;
  if (!isPmVaultUnlocked(userId)) {
    for (const acc of accounts) {
      const retained = isPolymarketProvider(acc.provider) ? getRetainedPmPrivateKey(acc.accountId, userId, tokenWalletAddress(acc.token)) : undefined;
      if (retained) {
        acc.token = mergePrivateKeyIntoToken(acc.token, retained, acc.provider);
        merged += 1;
        continue;
      }
      if (isVaultKeyProvider(acc.provider) && extractPrivateKeyFromToken(acc.token))
        pendingMigrate += 1;
    }
    return { merged, pendingMigrate };
  }
  for (const acc of accounts) {
    if (!isVaultKeyProvider(acc.provider) || !acc.accountId)
      continue;
    const fromVault = getCachedPrivateKey(acc.accountId, tokenWalletAddress(acc.token));
    const fromToken = extractPrivateKeyFromToken(acc.token);
    if (fromVault) {
      acc.token = mergePrivateKeyIntoToken(acc.token, fromVault, acc.provider);
      merged += 1;
    }
    else if (fromToken) {
      pendingMigrate += 1;
    }
  }
  return { merged, pendingMigrate };
}

/** 将 token 内遗留明文私钥迁入 vault（需已解锁） */
export async function migrateTokenPrivateKeysToVault(
  accounts: PlatformAccount[],
  userId: string,
): Promise<number> {
  if (!isPmVaultUnlocked(userId))
    return 0;
  let n = 0;
  for (const acc of accounts) {
    if (!isVaultKeyProvider(acc.provider) || !acc.accountId)
      continue;
    const fromToken = extractPrivateKeyFromToken(acc.token);
    if (!fromToken)
      continue;
    if (!getCachedPrivateKey(acc.accountId)) {
      await putPrivateKeyInVault(userId, acc.accountId, fromToken);
      n += 1;
    }
    const persist = toPersistTokenForProvider(acc.provider, acc.token);
    acc.token = mergePrivateKeyIntoToken(persist, fromToken, acc.provider);
  }
  return n;
}

/** 写回服务端前：投影为落库 DTO（不含私钥） */
export function stripPrivateKeysForPersist(accounts: Array<{ provider?: unknown; Provider?: unknown; token?: unknown; Token?: unknown }>): void {
  for (const row of accounts) {
    const provider = row.provider ?? row.Provider;
    if (!isVaultKeyProvider(provider))
      continue;
    if (typeof row.token === "string")
      row.token = toPersistTokenForProvider(provider, row.token);
    if (typeof row.Token === "string")
      row.Token = toPersistTokenForProvider(provider, row.Token);
  }
}
