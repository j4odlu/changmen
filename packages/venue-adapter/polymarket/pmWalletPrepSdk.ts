/**
 * Polymarket 钱包准备（Relayer / Deposit Wallet）SDK 选型。
 *
 * - unified（默认）：@polymarket/client（createSecureClient / remoteBuilderSigning）
 * - legacy：显式回滚使用 @polymarket/builder-relayer-client + builder-signing-sdk
 *
 * 下单热路径（bet.ts / pmTransport）不走此开关。
 * 切换：localStorage PM_WALLET_PREP_SDK 或 VITE_PM_WALLET_PREP_SDK
 */

export type PmWalletPrepSdk = "legacy" | "unified";

const LS_KEY = "PM_WALLET_PREP_SDK";

let testOverride: PmWalletPrepSdk | null = null;

function normalizeSdk(raw: string | undefined | null): PmWalletPrepSdk | null {
  const v = String(raw ?? "").trim().toLowerCase();
  if (v === "legacy" || v === "v2" || v === "relay")
    return "legacy";
  if (v === "unified" || v === "client" || v === "ts-sdk")
    return "unified";
  return null;
}

/** [changmen 扩展] 用户账号使用 Deposit Wallet，默认官方 unified SDK；legacy 仅显式回滚。 */
export function resolvePmWalletPrepSdk(): PmWalletPrepSdk {
  if (testOverride)
    return testOverride;
  if (typeof globalThis.localStorage !== "undefined") {
    const fromLs = normalizeSdk(globalThis.localStorage.getItem(LS_KEY));
    if (fromLs)
      return fromLs;
  }
  const env = typeof import.meta !== "undefined"
    ? normalizeSdk((import.meta as ImportMeta & { env?: Record<string, string> }).env?.VITE_PM_WALLET_PREP_SDK)
    : null;
  if (env)
    return env;
  return "unified";
}

export function setPmWalletPrepSdkForTests(sdk: PmWalletPrepSdk | null): void {
  testOverride = sdk;
}

export function setPmWalletPrepSdk(sdk: PmWalletPrepSdk): void {
  try {
    globalThis.localStorage?.setItem(LS_KEY, sdk);
  }
  catch {
    /* ignore */
  }
}
