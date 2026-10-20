/** 套利 LinkID 下限（与 SaveOrderBind Date.now() 对齐） */
export const ARB_LINK_MIN = 1_000_000_000_000;

/** 与 client-core format.VALUE_BET_LINK_BASE 对齐：正 EV 编码基线 */
export const VALUE_BET_LINK_BASE = 7_000_000_000_000_000;

/**
 * 侧栏/改绑排序键：正 EV 还原真实时间戳，其余取绝对值。
 * 与 packages/client-core orderLinkSortKey 一致。
 */
export function orderLinkSortKey(link) {
  const n = Math.abs(Number(link)) || 0;
  if (n >= VALUE_BET_LINK_BASE)
    return n - VALUE_BET_LINK_BASE;
  return n;
}

/** PostgreSQL：把 Link 还原成开弓毫秒（正 EV 去掉 7e15 基线） */
export function sqlLinkHomeTsExpr(linkExpr = "link") {
  return `(CASE WHEN ABS(${linkExpr}) >= ${VALUE_BET_LINK_BASE} THEN ABS(${linkExpr}) - ${VALUE_BET_LINK_BASE} ELSE ABS(${linkExpr}) END)`;
}

/**
 * 按日/按月列表归属 SQL：[start, end) 毫秒。
 * 时间戳 Link（套利 / 9999 / 正 EV）跟开弓时间；否则回退 create_at。
 * 这样开弓日没有成交、次日才补单时，开弓日仍能捞到种子。
 */
export function sqlOrderBelongsToRange(startParam, endParam, opts = {}) {
  const alias = opts.alias ? `${String(opts.alias).replace(/\.$/, "")}.` : "";
  const link = `${alias}link`;
  const createAt = `${alias}create_at`;
  const home = sqlLinkHomeTsExpr(link);
  const s = `$${Number(startParam)}`;
  const e = `$${Number(endParam)}`;
  return `((ABS(${link}) >= ${ARB_LINK_MIN} AND ${home} >= ${s} AND ${home} < ${e})`
    + ` OR ((${link} IS NULL OR ABS(${link}) < ${ARB_LINK_MIN}) AND ${createAt} >= ${s} AND ${createAt} < ${e}))`;
}

/** 与 sqlOrderBelongsToRange 同一套规则（单测 / 文档） */
export function orderBelongsToMsRange(link, createAt, start, end) {
  const n = Math.abs(Number(link)) || 0;
  const ts = n >= VALUE_BET_LINK_BASE ? n - VALUE_BET_LINK_BASE : n;
  if (ts >= ARB_LINK_MIN)
    return ts >= start && ts < end;
  const at = Number(createAt) || 0;
  return at >= start && at < end;
}

/**
 * [changmen 扩展] 手动改绑：仅允许把较新的 Link 改到较老的 Link。
 * from !== to 且双方非 0。
 */
export function canRebindLinkNewerToOlder(fromLink, toLink) {
  const from = Number(fromLink);
  const to = Number(toLink);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from === 0 || to === 0)
    return false;
  if (from === to)
    return false;
  return orderLinkSortKey(from) > orderLinkSortKey(to);
}

/** 从 bet 抽出地图槽（全场 / 地图N）；无法识别则 "—" */
export function parseBetMapLabel(bet) {
  const s = String(bet || "").trim();
  if (!s)
    return "—";
  const bracketMap = /^\[地图\s*(\d+)\]/.exec(s);
  if (bracketMap)
    return `地图${bracketMap[1]}`;
  const bracketFull = /^\[全场\]/.exec(s);
  if (bracketFull)
    return "全场";
  const plainMap = /^地图\s*(\d+)/.exec(s);
  if (plainMap)
    return `地图${plainMap[1]}`;
  const enMap = /^Map\s*(\d+)\b/i.exec(s);
  if (enMap)
    return `地图${enMap[1]}`;
  if (/全场/.test(s))
    return "全场";
  return "—";
}

/** 归一化对阵标题：去 HTML、运动前缀、Game/Map 后缀；主客对调视为同场 */
export function normalizeOrderMatchKey(match) {
  let raw = String(match || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  if (!raw)
    return "";
  // PM 等：`LoL: Team A vs Team B - Game 2 Winner`
  raw = raw.replace(
    /^(lol|league of legends|dota\s*2?|cs:?go|cs2|counter[- ]?strike|valorant|val|kog|王者荣耀|英雄联盟)\s*[:：\-–—]\s*/i,
    "",
  );
  const parts = raw.split(/\s+vs\.?\s+|\s+v\.?\s+/i);
  if (parts.length === 2) {
    const clean = (s) => String(s || "")
      .replace(/\s*[-–—]\s*(game|map|地图)\s*\d+\b.*$/i, "")
      .replace(/\s*[-–—]\s*.*\b(winner|获胜|胜负)\b.*$/i, "")
      .trim();
    const a = clean(parts[0]);
    const b = clean(parts[1]);
    if (a && b)
      return [a, b].sort().join(" vs ");
  }
  return raw;
}

/**
 * [changmen 扩展] 手动改绑：须同场（Match）且同地图槽（Bet 前缀）。
 * 无法解析地图时拒绝。
 */
export function isSameOrderMatchMap(a, b) {
  const matchA = normalizeOrderMatchKey(a?.match ?? a?.Match);
  const matchB = normalizeOrderMatchKey(b?.match ?? b?.Match);
  if (!matchA || !matchB || matchA !== matchB)
    return false;
  const mapA = parseBetMapLabel(a?.bet ?? a?.Bet);
  const mapB = parseBetMapLabel(b?.bet ?? b?.Bet);
  if (mapA === "—" || mapB === "—")
    return false;
  return mapA === mapB;
}

/**
 * [changmen 推测] 旧占位：link = create_at（场馆时间 ms）；仅 legacy 读路径/迁移用。
 */
export function placeholderLinkFromCreateAt(createAt, fallbackMs = Date.now()) {
  const ts = Number(createAt);
  if (Number.isFinite(ts) && ts > 0)
    return ts;
  const fb = Number(fallbackMs);
  return Number.isFinite(fb) && fb > 0 ? fb : Date.now();
}

/** 未绑单 SaveOrder 占位 Link = RDS 入库时刻（ms） */
export function placeholderLinkFromInsertAt(insertMs = Date.now()) {
  const ts = Number(insertMs);
  if (Number.isFinite(ts) && ts > 0)
    return ts;
  return Date.now();
}

/** 非套利 SaveOrder 后端绑定：略早于 create_at，满足 link < create_at */
export function backendBindLinkFromCreateAt(createAt) {
  const ca = Number(createAt);
  if (Number.isFinite(ca) && ca > 1)
    return ca - 1;
  const now = Date.now();
  return now > 1 ? now - 1 : 0;
}

/** 旧 changmen 占位 hash：link 为 0 / null 或 0 < link < 1e12 */
export function isHashLink(link) {
  const n = Number(link);
  if (!Number.isFinite(n) || n === 0)
    return true;
  if (n > 0 && n < ARB_LINK_MIN)
    return true;
  return false;
}

/** legacy 未绑单占位：link 与 create_at 同为 ms 时间戳 */
export function isCreateAtPlaceholderLink(link, createAt) {
  const l = Number(link);
  const ca = Number(createAt);
  if (!Number.isFinite(l) || l < ARB_LINK_MIN)
    return false;
  if (!Number.isFinite(ca) || ca <= 0)
    return false;
  return l === ca;
}

/**
 * SaveOrder 未绑占位：link = create_at - 1（backendBindLinkFromCreateAt）。
 * 与前端 isUnboundPlaceholderLink / auto-rebind 对齐；须允许改绑到继承的 arb linkId
 *（补单成交常晚于 attempt 数分钟，不能走「近 create_at 优先」距离门控）。
 */
export function isBackendBindPlaceholderLink(link, createAt) {
  const l = Number(link);
  const ca = Number(createAt);
  if (!Number.isFinite(l) || l < ARB_LINK_MIN)
    return false;
  if (!Number.isFinite(ca) || ca <= 1)
    return false;
  return l === ca - 1;
}

/** 未绑单 RDS 入库占位：≥ 1e12 且晚于场馆 create_at（与 legacy create_at 占位区分） */
export function isInsertTimePlaceholderLink(link, createAt) {
  const l = Number(link);
  const ca = Number(createAt);
  if (!Number.isFinite(l) || l < ARB_LINK_MIN)
    return false;
  if (isCreateAtPlaceholderLink(l, ca))
    return false;
  if (isBackendBindPlaceholderLink(l, ca))
    return false;
  if (!Number.isFinite(ca) || ca <= 0)
    return true;
  return l > ca;
}

/** SaveOrderBind 写入的套利/共享 LinkID（≥ 1e12） */
export function isArbBindLink(link) {
  const n = Number(link);
  return Number.isFinite(n) && n >= ARB_LINK_MIN;
}

/** 正 EV 单边：`-(VALUE_BET_LINK_BASE + ts)`（与 client-core isValueBetLink 对齐） */
export function isValueBetLink(link) {
  const n = Number(link);
  return Number.isFinite(n) && n < 0 && Math.abs(n) >= VALUE_BET_LINK_BASE;
}

/** 比例 9999 单边：负时间戳且非正 EV */
export function isSingleLegRateLink(link) {
  const n = Number(link);
  return Number.isFinite(n) && n < 0 && Math.abs(n) < VALUE_BET_LINK_BASE;
}

/**
 * SaveOrder 已确认的客户端分组 link（套利 / 正 EV / 9999），同步时不得被场馆占位覆盖。
 */
export function isConfirmedClientBindLink(link) {
  return isArbBindLink(link) || isValueBetLink(link) || isSingleLegRateLink(link);
}

/** 套利 linkId 与场馆 create_at 允许偏差（SaveOrderBind 用 Date.now()，通常 ≤ 数秒） */
export const ARB_LINK_CREATE_AT_TOLERANCE_MS = 90_000;

/**
 * SaveOrderBind 是否允许把已有套利 link 改成另一套利 link。
 * 防止拒单复检时 orders[0] 误绑历史订单（如 PM delayed 列表尚未含新单）。
 */
export function shouldAllowOrderBind(prevRow, linkVal) {
  const prevLink = Number(prevRow?.link);
  const next = Number(linkVal);
  if (!isArbBindLink(next))
    return true;
  if (!isArbBindLink(prevLink))
    return true;
  if (prevLink === next)
    return true;
  if (isCreateAtPlaceholderLink(prevLink, prevRow?.create_at))
    return true;
  if (isBackendBindPlaceholderLink(prevLink, prevRow?.create_at))
    return true;
  if (isHashLink(prevLink))
    return true;
  const ca = Number(prevRow?.create_at);
  if (!Number.isFinite(ca) || ca <= 0)
    return false;
  const prevDist = Math.abs(prevLink - ca);
  const nextDist = Math.abs(next - ca);
  if (prevDist < nextDist && nextDist > ARB_LINK_CREATE_AT_TOLERANCE_MS)
    return false;
  return true;
}

/** SaveOrderBind：从占位 link 改为共享 LinkID 时触发 bound 通知 */
export function shouldFireOrderBoundHook(prevRow, linkVal) {
  const prevLink = Number(prevRow?.link);
  const next = Number(linkVal);
  if (!isArbBindLink(next))
    return false;
  if (prevLink === next)
    return false;
  if (isHashLink(prevLink))
    return true;
  if (isCreateAtPlaceholderLink(prevLink, prevRow?.create_at))
    return true;
  if (isBackendBindPlaceholderLink(prevLink, prevRow?.create_at))
    return true;
  return isInsertTimePlaceholderLink(prevLink, prevRow?.create_at);
}

/** 仅 PB 平台的 hash 占位单（读路径与通知均排除） */
export function isPbHashOrder(link, provider) {
  if (!isHashLink(link))
    return false;
  return String(provider ?? "").trim() === "PB";
}

/** [A8 可证实] bundle 无客户端过滤；通知等辅助判断（非 changmen 侧栏 SQL） */
export function isOrderListVisible(link, provider) {
  const n = Number(link);
  if (Number.isFinite(n) && n < 0)
    return true;
  if (Number.isFinite(n) && n >= ARB_LINK_MIN)
    return true;
  return String(provider ?? "").trim() !== "PB";
}

/**
 * [已废弃] 曾用 link < create_at 隐藏 A8 同步单；订单查询现返回全量。
 */
export const CLIENT_ORDER_LIST_SQL = "link < create_at";

export function isClientOrderListVisible(link, createAt) {
  const l = Number(link);
  const ca = Number(createAt);
  if (!Number.isFinite(l) || !Number.isFinite(ca))
    return false;
  return l < ca;
}

/** 拼到已有 WHERE 后：`base AND link < create_at` */
export function orderVisibleSqlAnd(baseWhere) {
  const w = String(baseWhere || "").trim();
  if (!w)
    return CLIENT_ORDER_LIST_SQL;
  return `${w} AND ${CLIENT_ORDER_LIST_SQL}`;
}
