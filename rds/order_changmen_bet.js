/**
 * [changmen 扩展] SaveOrder 入库：用 user_logs 判定 changmen 主动下注（手动/自动），非 A8 被动 sync。
 *
 * 优先级：
 *   1. 下注日志 orderId 精确匹配 +「下注 => true」
 *   2. 下注日志 平台 + 时间窗 + 金额/赔率弱匹配
 *   3. fallback：预检「请求盘口数据 => true」+ 平台 + match/金额/赔率对齐
 */

export const BET_LOG_BEFORE_MS = 5 * 60 * 1000;
export const BET_LOG_AFTER_MS = 60 * 1000;

/** 客户端列表筛选（已取消，查询返回全量；保留常量供运维脚本引用） */
export const CHANGMEN_ORDER_LIST_SQL = "changmen_bet = true";

export function orderChangmenBetSqlAnd(baseWhere) {
  const w = String(baseWhere || "").trim();
  if (!w)
    return CHANGMEN_ORDER_LIST_SQL;
  return `${w} AND ${CHANGMEN_ORDER_LIST_SQL}`;
}

export function parseBetLogData(raw) {
  if (raw == null || raw === "")
    return null;
  if (typeof raw === "object")
    return raw;
  try {
    return JSON.parse(String(raw));
  }
  catch {
    return null;
  }
}

export function isSuccessBetLogTitle(title) {
  const t = String(title || "");
  return t.includes("下注 =>") && /下注\s*=>\s*true/i.test(t);
}

/** 预检成功（有盘口 data）；仅作下注日志缺失时的 fallback */
export function isSuccessCheckLogTitle(title) {
  const t = String(title || "");
  return t.includes("请求盘口数据") && /请求盘口数据\s*=>\s*true/i.test(t);
}

export function extractBetLogProvider(title, parsed) {
  const bracket = String(title || "").match(/^\[([^\]]+)\]/);
  if (bracket?.[1])
    return String(bracket[1]).trim();
  if (parsed?.result?.provider)
    return String(parsed.result.provider).trim();
  if (parsed?.options?.type)
    return String(parsed.options.type).trim();
  return "";
}

/** 下注结果里的场馆 orderId（与 user_log_lookup.extractLogOrderId 对齐） */
export function extractBetLogOrderId(parsed) {
  const oid = parsed?.result?.orderId ?? parsed?.result?.order_id;
  if (oid == null || oid === "")
    return "";
  return String(oid).trim();
}

function normProvider(p) {
  return String(p || "").trim().toUpperCase();
}

function normMoney(n) {
  const v = Number(n);
  return Number.isFinite(v) ? Math.round(v) : null;
}

function normOdds(n) {
  const v = Number(n);
  return Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null;
}

function orderTimeWindow(order, opts) {
  const createAt = Number(order?.create_at ?? order?.createAt) || 0;
  const provider = normProvider(order?.provider ?? order?.Type);
  if (!createAt || !provider)
    return null;
  const beforeMs = Number(opts.beforeMs) || BET_LOG_BEFORE_MS;
  const afterMs = Number(opts.afterMs) || BET_LOG_AFTER_MS;
  return {
    createAt,
    provider,
    from: createAt - beforeMs,
    to: createAt + afterMs,
  };
}

function logInWindow(row, from, to) {
  const logAt = Number(row.create_at ?? row.createAt) || 0;
  return logAt > 0 && logAt >= from && logAt <= to;
}

/** 日志 options 与订单字段弱匹配（降误关联） */
export function betLogMatchesOrder(parsed, order) {
  if (!parsed || !order)
    return true;
  const opts = parsed.options || parsed.result?.request?.options;
  if (!opts || typeof opts !== "object")
    return true;

  const logMoney = normMoney(opts.betMoney ?? opts.bet_money);
  const orderMoney = normMoney(order.bet_money ?? order.betMoney);
  if (logMoney != null && orderMoney != null && logMoney !== orderMoney)
    return false;

  const logOdds = normOdds(opts.odds);
  const orderOdds = normOdds(order.odds);
  if (logOdds != null && orderOdds != null && logOdds !== orderOdds)
    return false;

  return true;
}

/** 预检 options 与订单对齐（比下注 fallback 更严，避免「只点预检」误判） */
export function checkLogMatchesOrder(parsed, order) {
  if (!parsed || !order)
    return false;
  const opts = parsed.options;
  if (!opts || typeof opts !== "object")
    return false;

  const orderProvider = normProvider(order?.provider ?? order?.Type);
  if (opts.type && normProvider(opts.type) !== orderProvider)
    return false;

  const logMatch = String(opts.match || "").trim();
  const orderMatch = String(order.match ?? order.Match ?? "").trim();
  if (logMatch && orderMatch && logMatch !== orderMatch)
    return false;

  return betLogMatchesOrder(parsed, order);
}

function matchBetLogByOrderId(order, logs, win) {
  const orderId = String(order?.order_id ?? order?.orderId ?? "").trim();
  if (!orderId)
    return false;

  for (const row of logs || []) {
    if (!logInWindow(row, win.from, win.to))
      continue;
    if (!isSuccessBetLogTitle(row.title))
      continue;
    const parsed = parseBetLogData(row.data);
    if (extractBetLogOrderId(parsed) !== orderId)
      continue;
    const logProvider = normProvider(extractBetLogProvider(row.title, parsed));
    if (logProvider !== win.provider)
      continue;
    return true;
  }
  return false;
}

function matchBetLogByProvider(order, logs, win) {
  for (const row of logs || []) {
    if (!logInWindow(row, win.from, win.to))
      continue;
    if (!isSuccessBetLogTitle(row.title))
      continue;
    const parsed = parseBetLogData(row.data);
    const logProvider = normProvider(extractBetLogProvider(row.title, parsed));
    if (logProvider !== win.provider)
      continue;
    if (!betLogMatchesOrder(parsed, order))
      continue;
    return true;
  }
  return false;
}

function matchCheckLogFallback(order, logs, win) {
  for (const row of logs || []) {
    if (!logInWindow(row, win.from, win.to))
      continue;
    if (!isSuccessCheckLogTitle(row.title))
      continue;
    const parsed = parseBetLogData(row.data);
    const logProvider = normProvider(extractBetLogProvider(row.title, parsed));
    if (logProvider !== win.provider)
      continue;
    if (!checkLogMatchesOrder(parsed, order))
      continue;
    return true;
  }
  return false;
}

/**
 * 单笔订单是否能在日志窗内找到 changmen 主动下注痕迹。
 * @param {object} order — order_id, provider, create_at, match, bet_money, odds
 * @param {object[]} logs — user_logs 行（title, data, create_at）
 */
export function matchChangmenBetFromLogs(order, logs, opts = {}) {
  const win = orderTimeWindow(order, opts);
  if (!win)
    return false;

  if (matchBetLogByOrderId(order, logs, win))
    return true;
  if (matchBetLogByProvider(order, logs, win))
    return true;
  if (matchCheckLogFallback(order, logs, win))
    return true;
  return false;
}

/** 一批订单共用一次日志查询时的窗口 */
export function betLogWindowForOrders(orders, opts = {}) {
  const beforeMs = Number(opts.beforeMs) || BET_LOG_BEFORE_MS;
  const afterMs = Number(opts.afterMs) || BET_LOG_AFTER_MS;
  const times = (orders || [])
    .map(o => Number(o.create_at ?? o.createAt) || 0)
    .filter(t => t > 0);
  if (!times.length)
    return null;
  const min = Math.min(...times);
  const max = Math.max(...times);
  return { fromMs: min - beforeMs, toMs: max + afterMs };
}
