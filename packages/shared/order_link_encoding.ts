/** [changmen 扩展] 前后端共用的单边订单 Link 编码边界；数值均在安全整数范围内。 */
/** 正 EV 为 -(基线 + 毫秒时间戳)，比例 9999 为负毫秒时间戳。 */
export const VALUE_BET_LINK_BASE = 7_000_000_000_000_000;
export const LOW_ODDS_LINK_BASE = 6_000_000_000_000_000;
export const OB_SINGLE_LINK_BASE = 5_000_000_000_000_000;

/** 含 OB 仅下 OB：独立于比例 9999、LOS 和正 EV。 */
export function isObSingleLink(link: number | null | undefined): boolean {
  const n = Number(link);
  return Number.isFinite(n) && n < 0 && Math.abs(n) >= OB_SINGLE_LINK_BASE && Math.abs(n) < LOW_ODDS_LINK_BASE;
}

export function createObSingleLinkId(ts = Date.now()): number {
  return -(OB_SINGLE_LINK_BASE + ts);
}
