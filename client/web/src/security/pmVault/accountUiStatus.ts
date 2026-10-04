/**
 * 投注账号条：Polymarket 本机钱包解锁状态（方案 C）
 */

import { reactive, shallowRef } from "vue";
import type { PlatformAccount } from "@/models/platformAccount";
import { extractPrivateKeyFromToken, isVaultKeyProvider, tokenWalletAddress } from "./tokenStrip";
import {
  getCachedPrivateKey,
  hasVault,
  isPmVaultUnlocked,
  normalizePmVaultUserId,
  pmVaultSessionRev,
} from "./session";
import { listVaultKeys } from "./store";

export const pmVaultAccountUi = reactive({
  userId: "",
  vaultExists: false,
  unlocked: false,
});

const keyAccountIds = shallowRef<ReadonlySet<number>>(new Set());

/** 该 PM 账号是否应在顶栏显示「待解锁」 */
export function pmAccountShowsUnlockPending(
  account: PlatformAccount,
  currentUserId?: unknown,
): boolean {
  void pmVaultSessionRev.value;
  if (!isVaultKeyProvider(account.provider))
    return false;
  const accountId = Number(account.accountId);
  if (!accountId)
    return false;
  const uid = normalizePmVaultUserId(currentUserId ?? pmVaultAccountUi.userId);
  if (!uid || uid !== normalizePmVaultUserId(pmVaultAccountUi.userId))
    return false;
  if (!pmVaultAccountUi.vaultExists)
    return false;
  if (getCachedPrivateKey(accountId, tokenWalletAddress(account.token)))
    return false;
  if (extractPrivateKeyFromToken(account.token))
    return false;
  return keyAccountIds.value.has(accountId);
}

/** 同步 session 解锁位（session 非响应式，解锁/锁定后立即 bump UI） */
export function touchPmVaultAccountUiSession(userId?: unknown): void {
  const uid = normalizePmVaultUserId(userId ?? pmVaultAccountUi.userId);
  pmVaultAccountUi.unlocked = uid ? isPmVaultUnlocked(uid) : false;
}

export async function refreshPmVaultAccountUi(
  accounts: PlatformAccount[],
  userId: unknown,
): Promise<void> {
  const uid = normalizePmVaultUserId(userId);
  pmVaultAccountUi.userId = uid;
  touchPmVaultAccountUiSession(uid);
  pmVaultAccountUi.vaultExists = uid ? await hasVault(uid) : false;

  const ids = new Set<number>();
  if (uid && pmVaultAccountUi.vaultExists) {
    try {
      for (const row of await listVaultKeys(uid))
        ids.add(Number(row.accountId));
    }
    catch {
      /* IndexedDB 不可用 */
    }
    for (const acc of accounts) {
      if (!isVaultKeyProvider(acc.provider) || !acc.accountId)
        continue;
      if (extractPrivateKeyFromToken(acc.token))
        ids.add(Number(acc.accountId));
    }
  }
  keyAccountIds.value = ids;
  applyPmVaultBalanceGate(accounts, uid);
}

/**
 * [changmen 扩展] 待解锁 vault 场馆不写 balance，编排层按 balance===undefined 自然跳过（不改 accountPicker）。
 */
export function applyPmVaultBalanceGate(
  accounts: PlatformAccount[],
  userId: unknown,
): void {
  for (const acc of accounts) {
    if (!pmAccountShowsUnlockPending(acc, userId))
      continue;
    acc.balance = undefined;
    acc.balanceStale = false;
  }
}

export async function refreshPmVaultAccountUiFromStore(): Promise<void> {
  try {
    const { useAccountStore } = await import("@/stores/accountStore");
    const { useUserStore } = await import("@/stores/userStore");
    const { refreshAccountBalance } = await import("@/stores/account/balanceRefresh");
    const store = useAccountStore();
    const userId = useUserStore().userId;
    await refreshPmVaultAccountUi(store.accounts, userId);
    const uid = normalizePmVaultUserId(userId);
    if (uid && isPmVaultUnlocked(uid)) {
      for (const acc of store.accounts) {
        if (!isVaultKeyProvider(acc.provider) || !acc.accountId)
          continue;
        if (pmAccountShowsUnlockPending(acc, uid))
          continue;
        void refreshAccountBalance(store, acc);
      }
    }
  }
  catch {
    /* store 未就绪 */
  }
}

export function resetPmVaultAccountUi(): void {
  pmVaultAccountUi.userId = "";
  pmVaultAccountUi.vaultExists = false;
  pmVaultAccountUi.unlocked = false;
  keyAccountIds.value = new Set();
  pmVaultSessionRev.value += 1;
}
