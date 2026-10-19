/** 对齐 A8 bundle `pt` 常用格式化 */

import { formatOdds } from "@changmen/shared/odds_format";
import { normalizeEpochMs } from "@changmen/shared/time/match_time";

export function formatDate(ts: number | string | null | undefined): string {
  const ms = normalizeEpochMs(ts);
  if (!ms)
    return "";
  const d = new Date(ms);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${mm}-${dd} ${hh}:${min}`;
}

/** 订单列表买入时间，对齐 A8 `pt.formatDate(CreateAt)` 默认 `yyyy-MM-dd HH:mm:ss` */
export function formatOrderTime(ts: number | string | null | undefined): string {
  const ms = normalizeEpochMs(ts);
  if (!ms)
    return "";
  return formatPbDateTime(new Date(ms));
}

/** A8 聊天室时间标签 `HH:mm:ss` */
export function formatTimeHms(ts: number): string {
  if (!ts)
    return "";
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  const sec = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${min}:${sec}`;
}

/** 对齐 A8 `pt.formatDate(date, "yyyy-MM-dd HH:mm:ss")` */
export function formatPbDateTime(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  const sec = String(d.getSeconds()).padStart(2, "0");
  return `${y}-${m}-${day} ${hh}:${min}:${sec}`;
}

export function formatDateKey(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function formatSecond(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

/** 与 @changmen/shared/odds_format、A8 展示一致 */
export function formatDisplayOdds(value: number): number {
  return formatOdds(value);
}

export function toFixed(n: number, digits = 3, mode: "round" | "floor" = "round"): string {
  const f = 10 ** digits;
  const v = mode === "floor" ? Math.floor(n * f) / f : Math.round(n * f) / f;
  return v.toFixed(digits);
}

export function percent(n: number, digits = 1): string {
  if (!Number.isFinite(n))
    return "N/A";
  return `${(n * 100).toFixed(digits)}%`;
}

export function arbPercent(homeOdds: number, awayOdds: number): string {
  if (!homeOdds || !awayOdds)
    return "N/A";
  return percent(1 / (1 / homeOdds + 1 / awayOdds));
}

/** 套利 implied 乘数（≥1）→ 净利润率，如 1.05 → 5.0% */
export function arbProfitRate(implied: number, digits = 1): string {
  if (!Number.isFinite(implied))
    return "N/A";
  return percent(implied - 1, digits);
}

/**
 * 正 EV 单边 Link 编码：`-(VALUE_BET_LINK_BASE + Date.now())`。
 * 与 9999 单边的 `-Date.now()` 区分；排序时用 `orderLinkSortKey` 还原时间戳。
 * 7e15 远大于当前 ms 时间戳（~1.7e12），且在 Number 安全整数内。
 */
export const VALUE_BET_LINK_BASE = 7_000_000_000_000_000;

/** 任意负 Link（9999 单边或正 EV）；双腿套利为正时间戳 */
export function isSingleLegLink(link: number | null | undefined): boolean {
  const n = Number(link);
  return Number.isFinite(n) && n < 0;
}

/** 正 EV 确认下单（方案 B） */
export function isValueBetLink(link: number | null | undefined): boolean {
  const n = Number(link);
  return Number.isFinite(n) && n < 0 && Math.abs(n) >= VALUE_BET_LINK_BASE;
}

/** 比例 9999 单边（负时间戳，且非正 EV 编码） */
export function isSingleLegRateLink(link: number | null | undefined): boolean {
  return isSingleLegLink(link) && !isValueBetLink(link);
}

export function createValueBetLinkId(linkTs = Date.now()): number {
  return -(VALUE_BET_LINK_BASE + linkTs);
}

/** 侧栏/分组排序键：正 EV 还原为真实时间戳，其余取绝对值 */
export function orderLinkSortKey(link: number | null | undefined): number {
  const n = Math.abs(Number(link)) || 0;
  if (n >= VALUE_BET_LINK_BASE)
    return n - VALUE_BET_LINK_BASE;
  return n;
}

/** 展示 LinkID：套利正数原样；9999→🏆；正 EV→💎 */
export function formatLinkId(link: number | null | undefined): string {
  const n = Number(link);
  if (!Number.isFinite(n) || n === 0)
    return "—";
  if (isValueBetLink(n))
    return "💎";
  if (n < 0)
    return "🏆";
  return String(n);
}

/** SaveOrderBind 时间戳 link vs SaveOrder linkFromOrder hash（u32） */
export type LinkIdSource = "arb" | "single" | "valueBet" | "hash";

const ARB_LINK_MIN = 1_000_000_000_000;

export function classifyLinkId(link: number | null | undefined): LinkIdSource | null {
  const n = Number(link);
  if (!Number.isFinite(n) || n === 0)
    return null;
  if (isValueBetLink(n))
    return "valueBet";
  if (n < 0)
    return "single";
  if (n >= ARB_LINK_MIN)
    return "arb";
  return "hash";
}

export function linkIdSourceLabel(source: LinkIdSource | null): string {
  switch (source) {
    case "arb":
      return "套利";
    case "single":
      return "单边";
    case "valueBet":
      return "正EV";
    case "hash":
      return "hash";
    default:
      return "";
  }
}
