/** OB HTTP 盘口锁盘 — 与 game/view block 字段一致，save_bets / lock_decision 共用 */

export const MARKET_STATUS_OPEN = 6;
export const MARKET_VISIBLE_SHOW = 1;
export const MARKET_SUSPENDED_OFF = 0;

export function obBlockLocked(block: Record<string, unknown>): boolean {
  return block.status !== 6 || block.visible !== 1 || block.suspended !== 0;
}
