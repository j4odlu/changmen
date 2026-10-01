import { PM_MAINTENANCE_CHANNEL } from "./channels.js";

export const PM_STATUS_PAGE_URL = "https://status.polymarket.com";

const DEFAULT_POLL_MS = 60_000;
const MIN_POLL_MS = 30_000;
const DEFAULT_TIMEOUT_MS = 10_000;

/** 状态翻转需连续读数一致的次数（防抖） */
const STATE_FLIP_STREAK = 2;
/** 连续网络失败达到该值后公开状态置为 unknown */
const UNKNOWN_FAIL_STREAK = 3;

/** @typedef {"unknown" | "operational" | "maintenance" | "incident"} PmMaintenanceState */

/**
 * @param {unknown} raw
 * @returns {PmMaintenanceState}
 */
export function normalizePmMaintenanceState(raw) {
  return raw === "operational" || raw === "maintenance" || raw === "incident" ? raw : "unknown";
}

/**
 * 拍平 Instatus 组件树（含 children）
 * @param {unknown} components
 * @returns {{ name: string; status: string }[]}
 */
export function flattenStatusComponents(components) {
  if (!Array.isArray(components))
    return [];
  /** @type {{ name: string; status: string }[]} */
  const out = [];
  const walk = (list) => {
    for (const item of list) {
      if (!item || typeof item !== "object")
        continue;
      const name = String(item.name ?? "").trim();
      const status = String(item.status ?? "").trim().toUpperCase();
      if (name && status)
        out.push({ name, status });
      if (Array.isArray(item.children))
        walk(item.children);
    }
  };
  walk(components);
  return out;
}

/**
 * 由状态页响应推导维护状态（纯函数）
 * @param {{ status?: unknown } | null | undefined} summary
 * @param {unknown} components
 * @returns {{ state: PmMaintenanceState; pageStatus: string; affected: string[] }}
 */
export function evaluateStatusPage(summary, components) {
  const pageStatus = String(summary?.status ?? summary?.page?.status ?? "").trim().toUpperCase();
  const all = flattenStatusComponents(components);
  const affected = all.filter(c => c.status !== "OPERATIONAL");
  let state = "operational";
  if (pageStatus === "UNDERMAINTENANCE" || affected.some(c => c.status === "UNDERMAINTENANCE"))
    state = "maintenance";
  else if (pageStatus === "HASISSUES" || affected.length > 0)
    state = "incident";
  return {
    state,
    pageStatus,
    affected: affected.map(c => `${c.name}=${c.status}`),
  };
}

/**
 * 拉取并评估 Polymarket 状态页
 * @param {{ timeoutMs?: number; fetchImpl?: typeof fetch }} [options]
 */
export async function fetchPolymarketStatus({ timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl = fetch } = {}) {
  const get = (url) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    return fetchImpl(url, { signal: ctrl.signal, headers: { accept: "application/json" } })
      .finally(() => clearTimeout(timer));
  };
  const [summaryRes, componentsRes] = await Promise.all([
    get(`${PM_STATUS_PAGE_URL}/api/v2/summary.json`),
    get(`${PM_STATUS_PAGE_URL}/api/v2/components.json`),
  ]);
  for (const res of [summaryRes, componentsRes]) {
    if (!res.ok)
      throw new Error(`HTTP ${res.status}`);
  }
  const [summary, componentsBody] = await Promise.all([summaryRes.json(), componentsRes.json()]);
  return {
    ...evaluateStatusPage(summary, componentsBody?.components),
    checkedAt: Date.now(),
    source: PM_STATUS_PAGE_URL,
  };
}

/**
 * 从环境变量解析 watcher 配置
 * @param {NodeJS.ProcessEnv} [env]
 */
export function resolvePmMaintenanceConfig(env = process.env) {
  const rawWatch = String(env.PM_MAINTENANCE_WATCH ?? "").trim().toLowerCase();
  const enabled = rawWatch !== "0" && rawWatch !== "off" && rawWatch !== "false";
  const pollMs = Math.max(MIN_POLL_MS, Number(env.PM_MAINTENANCE_POLL_MS) || DEFAULT_POLL_MS);
  const timeoutMs = Number(env.PM_MAINTENANCE_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;
  return { enabled, pollMs, timeoutMs };
}

/**
 * @typedef {object} PmMaintenanceWatcherOptions
 * @property {(channel: string, message: unknown) => void} emit
 * @property {NodeJS.ProcessEnv} [env]
 * @property {typeof fetch} [fetchImpl] 测试注入
 * @property {(fn: () => void, ms: number) => unknown} [setIntervalImpl] 测试注入
 * @property {(handle: unknown) => void} [clearIntervalImpl] 测试注入
 * @property {() => number} [now] 测试注入
 */

/**
 * 轮询 Polymarket 状态页并向浏览器广播维护状态。
 * 返回停止函数。状态翻转带 2 次连续读数防抖；连续网络失败转 unknown。
 * @param {PmMaintenanceWatcherOptions} options
 * @returns {() => void}
 */
export function startPmMaintenanceWatcher({
  emit,
  env = process.env,
  fetchImpl = fetch,
  setIntervalImpl = setInterval,
  clearIntervalImpl = clearInterval,
  now = Date.now,
}) {
  const { enabled, pollMs, timeoutMs } = resolvePmMaintenanceConfig(env);
  if (!enabled) {
    console.log("[pm-maintenance] watcher disabled (PM_MAINTENANCE_WATCH=off)");
    return () => {};
  }

  /** @type {PmMaintenanceState | null} null = 尚无成功读数 */
  let publicState = null;
  /** @type {PmMaintenanceState | null} */
  let pendingState = null;
  let pendingStreak = 0;
  let failStreak = 0;
  let inFlight = false;
  let stopped = false;

  const publish = (payload) => {
    if (!stopped)
      emit(PM_MAINTENANCE_CHANNEL, payload);
  };

  async function tick() {
    if (inFlight || stopped)
      return;
    inFlight = true;
    try {
      const raw = await fetchPolymarketStatus({ timeoutMs, fetchImpl });
      failStreak = 0;
      const rawState = normalizePmMaintenanceState(raw.state);
      if (publicState === null || rawState === publicState) {
        publicState = rawState;
        pendingState = null;
        pendingStreak = 0;
      }
      else {
        if (pendingState === rawState) {
          pendingStreak += 1;
        }
        else {
          pendingState = rawState;
          pendingStreak = 1;
        }
        if (pendingStreak >= STATE_FLIP_STREAK) {
          publicState = rawState;
          pendingState = null;
          pendingStreak = 0;
        }
      }
      publish({ ...raw, state: publicState ?? "unknown", pollMs });
    }
    catch (err) {
      failStreak += 1;
      if (failStreak === 1 || failStreak === UNKNOWN_FAIL_STREAK)
        console.warn(`[pm-maintenance] poll failed (${failStreak}): ${err instanceof Error ? err.message : String(err)}`);
      // [changmen 扩展] 首次检测失败也发送诊断；持续 unknown 仍广播，供晚加入的页面读取。
      if (publicState === null || publicState === "unknown" || failStreak >= UNKNOWN_FAIL_STREAK) {
        publicState = "unknown";
        publish({
          state: "unknown",
          pageStatus: "",
          affected: [],
          checkedAt: now(),
          source: PM_STATUS_PAGE_URL,
          pollMs,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    finally {
      inFlight = false;
    }
  }

  void tick();
  const timer = setIntervalImpl(() => { void tick(); }, pollMs);
  console.log(`[pm-maintenance] watcher started poll=${pollMs}ms source=${PM_STATUS_PAGE_URL}`);

  return () => {
    stopped = true;
    clearIntervalImpl(timer);
  };
}
