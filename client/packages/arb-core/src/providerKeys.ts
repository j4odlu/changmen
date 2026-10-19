import type { PlatformId } from "@changmen/api-contract";

/** auto 对齐 A8 `Io().getProviders()`；display 保留给测试/兼容，Telegram 用 `providerKeysFromBetItems` */
export type ArbProviderScope = "display" | "auto";

export function providerKeysFromBetItems(bet: {
  items: { type: PlatformId }[];
}): PlatformId[] {
  return bet.items.map(item => item.type);
}

/**
 * 收口套利检测用的平台列表。
 * - display：兼容别名；Telegram 全盘口扫描见 `extensions/arbBet`
 * - auto：自动买入与 `GetOrderOptions`（仅有余额 ≥ betMoney 的在线账号平台）
 */
export function resolveArbProviderKeys(
  scope: ArbProviderScope,
  ctx: {
    bet?: { items: { type: PlatformId }[] };
    accountProviderKeys?: Iterable<PlatformId>;
  },
): PlatformId[] {
  if (scope === "display") {
    return ctx.bet ? providerKeysFromBetItems(ctx.bet) : [];
  }
  return ctx.accountProviderKeys ? [...ctx.accountProviderKeys] : [];
}
