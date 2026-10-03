/**
 * POD 跟单门槛。只存在本机 localStorage，不进 USERCONFIG / ACCOUNT。
 * 用于筛「可以拿去对 OB 的警报」。自动下注默认关。
 */
import type { PodDropAlert } from "@/runtime/podAlerts";
import { parsePodYaboSettings, POD_YABO_SETTINGS_DEFAULTS } from "@/runtime/podYabo/settings";

export const POD_BET_SETTINGS_KEY = "changmen:podBetSettings";
export const POD_BET_SETTINGS_UPDATED = "changmen:pod-bet-settings-updated";
export const POD_FOLLOW_STAKE_PRESETS = [50, 100, 200, 500] as const;

export type PodBetSettings = {
  /** 开：跟单浮窗列出过门槛的警报 */
  enabled: boolean;
  /** 只跟未开赛（滚球 OB 往往比 Pinnacle 更快） */
  prematchOnly: boolean;
  /** 只要足球（POD sportId=1） */
  footballOnly: boolean;
  /** 含半场。默认只全场 */
  includeHt: boolean;
  moneyline: boolean;
  totals: boolean;
  /** OB 让球通常已经很锐，默认关 */
  spreads: boolean;
  /** 最小降幅 % */
  minDropPct: number;
  /** AutoYabo EV 阈值：目标场馆报价须高于 NVP 的最小边 %。大小/独赢用这个。 */
  minObEdgePct: number;
  /** AutoYabo：让球 EV 下限、EV 上限、副盘、随机注额。见 podYabo/settings。 */
  spreadObEdgePct: number;
  maxObEdgePct: number;
  lineMatch: "strict" | "loose";
  stakeRandomStep: number;
  stakeRandomLevels: number;
  minOdds: number;
  maxOdds: number;
  /** 警报过期秒数 */
  maxAgeSec: number;
  /** @deprecated 旧版默认金额；不再参与 OB/PM 跟单下单。 */
  stake: number;
  /** OB 跟单下注金额；0 = 未设，不下单 */
  obStake: number;
  /** Polymarket 跟单下注金额；0 = 未设，不下单 */
  pmStake: number;
  rayStake: number;
  /** 过线且对上盘口后自动下单。默认关 */
  autoPlace: boolean;
  /** @deprecated 场馆由已选账号决定；仅保留旧 localStorage 兼容。 */
  followVenues: Array<"OB" | "Polymarket" | "RAY">;
  /**
   * 跟单用的 OB 账号（可多选）。空 = 未选择，不下单。
   */
  followAccountIds: number[];
  /** OB 多账号每笔只用一个账号，并按账号列表顺序轮换。 */
  obAccountRotation: boolean;
  /** 跟单用的 Polymarket 账号（可多选）。空 = 未选择，不下单。 */
  pmFollowAccountIds: number[];
  rayFollowAccountIds: number[];
  /** @deprecated 读时等于 followAccountIds[0]||0；写仍会迁进 followAccountIds */
  followAccountId: number;
  /** 自动当日亏损上限（已结算亏损 + 未结算注码）；0 = 不设 */
  maxDailyLoss: number;
  /** OB 每日跟单订单数上限；0 = 不限 */
  obDailyOrderLimit: number;
  /** Polymarket 每日跟单订单数上限；0 = 不限 */
  pmDailyOrderLimit: number;
  rayDailyOrderLimit: number;
};

export const POD_BET_SETTINGS_DEFAULTS: PodBetSettings = {
  enabled: true,
  prematchOnly: true,
  footballOnly: true,
  includeHt: false,
  moneyline: true,
  totals: true,
  spreads: false,
  minDropPct: 8,
  minObEdgePct: 4,
  ...POD_YABO_SETTINGS_DEFAULTS,
  minOdds: 1.45,
  maxOdds: 3.2,
  // AutoYabo 无 maxAge：50ms 盯最新一行，就绪立刻打、见过不重打。
  // 我们列表常驻，需要「降赔后多久内必须就绪」的冷票保护——不是等满再下。
  maxAgeSec: 45,
  stake: 0,
  obStake: 0,
  pmStake: 0,
  rayStake: 0,
  rayFollowAccountIds: [],
  rayDailyOrderLimit: 0,
  autoPlace: false,
  followVenues: [],
  followAccountIds: [],
  obAccountRotation: false,
  pmFollowAccountIds: [],
  followAccountId: 0,
  maxDailyLoss: 0,
  obDailyOrderLimit: 0,
  pmDailyOrderLimit: 0,
};

function asRecord(raw: unknown): Record<string, unknown> | null {
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : null;
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

function clampNum(v: unknown, fallback: number, min: number, max: number): number {
  const n = Number(v);
  if (!Number.isFinite(n))
    return fallback;
  return Math.min(max, Math.max(min, n));
}

/** 归一跟单账号 id 列表；兼容旧 followAccountId。 */
export function parseFollowAccountIds(raw: unknown, legacyId: unknown = 0): number[] {
  const out: number[] = [];
  const push = (v: unknown) => {
    const n = Math.round(Number(v) || 0);
    if (!(n > 0) || out.includes(n))
      return;
    out.push(n);
  };
  if (Array.isArray(raw)) {
    for (const item of raw)
      push(item);
  }
  else if (raw != null && raw !== "") {
    push(raw);
  }
  if (!out.length)
    push(legacyId);
  return out;
}

export function parseFollowVenues(raw: unknown): Array<"OB" | "Polymarket" | "RAY"> {
  const out: Array<"OB" | "Polymarket" | "RAY"> = [];
  const push = (v: unknown) => {
    const s = String(v || "").trim();
    if ((s === "OB" || s === "Polymarket" || s === "RAY") && !out.includes(s))
      out.push(s);
  };
  if (Array.isArray(raw)) {
    for (const item of raw)
      push(item);
  }
  else if (raw != null && raw !== "") {
    push(raw);
  }
  return out;
}

export function parsePodBetSettings(raw: unknown): PodBetSettings {
  const row = asRecord(raw) || {};
  const d = POD_BET_SETTINGS_DEFAULTS;
  const lo = clampNum(row.minOdds, d.minOdds, 1.01, 20);
  const hi = clampNum(row.maxOdds, d.maxOdds, 1.05, 50);
  const moneyline = bool(row.moneyline, d.moneyline);
  const totals = bool(row.totals, d.totals);
  const spreads = bool(row.spreads, d.spreads);
  const anyMarket = moneyline || totals || spreads;
  const yabo = parsePodYaboSettings(row);
  const followAccountIds = parseFollowAccountIds(row.followAccountIds, row.followAccountId);
  const pmFollowAccountIds = parseFollowAccountIds(row.pmFollowAccountIds, 0);
  const stake = clampNum(row.stake, d.stake, 0, 1_000_000);
  return {
    enabled: bool(row.enabled, d.enabled),
    prematchOnly: bool(row.prematchOnly, d.prematchOnly),
    footballOnly: bool(row.footballOnly, d.footballOnly),
    includeHt: bool(row.includeHt, d.includeHt),
    moneyline: anyMarket ? moneyline : d.moneyline,
    totals: anyMarket ? totals : d.totals,
    spreads: anyMarket ? spreads : d.spreads,
    minDropPct: clampNum(row.minDropPct, d.minDropPct, 0, 80),
    minObEdgePct: clampNum(row.minObEdgePct, d.minObEdgePct, 0, 40),
    ...yabo,
    minOdds: Math.min(lo, hi),
    maxOdds: Math.max(lo, hi),
    maxAgeSec: (() => {
      const n = Math.round(clampNum(row.maxAgeSec, d.maxAgeSec, 0, 600));
      // 撤回误默认 180；30 是上一版短默认，并入新默认 45（仍只是冷票保护）
      if (n === 180 || n === 30)
        return d.maxAgeSec;
      return n;
    })(),
    stake,
    obStake: clampNum(row.obStake, d.obStake, 0, 1_000_000),
    pmStake: clampNum(row.pmStake, d.pmStake, 0, 1_000_000),
    rayStake: clampNum(row.rayStake, d.rayStake, 0, 1_000_000),
    rayFollowAccountIds: parseFollowAccountIds(row.rayFollowAccountIds),
    rayDailyOrderLimit: Math.round(clampNum(row.rayDailyOrderLimit, d.rayDailyOrderLimit, 0, 10_000)),
    autoPlace: bool(row.autoPlace, d.autoPlace),
    followVenues: parseFollowVenues(row.followVenues),
    followAccountIds,
    obAccountRotation: bool(row.obAccountRotation, d.obAccountRotation),
    pmFollowAccountIds,
    followAccountId: followAccountIds[0] || 0,
    maxDailyLoss: clampNum(row.maxDailyLoss, d.maxDailyLoss, 0, 1_000_000),
    obDailyOrderLimit: Math.round(clampNum(row.obDailyOrderLimit, d.obDailyOrderLimit, 0, 10_000)),
    pmDailyOrderLimit: Math.round(clampNum(row.pmDailyOrderLimit, d.pmDailyOrderLimit, 0, 10_000)),
  };
}

export type PodLineKind = "moneyline" | "totals" | "spreads" | "other";

export function podAlertLineKind(alert: Pick<PodDropAlert, "lineType" | "market" | "outcome">): PodLineKind {
  const text = `${alert.lineType} ${alert.market}`.toLowerCase();
  const outcome = String(alert.outcome || "").toLowerCase();
  if (/team\s*total|player|球队大小|队进球/.test(text))
    return "other";
  if (/total|totals|\bou\b|over\/under|大小/.test(text) || outcome === "over" || outcome === "under")
    return "totals";
  if (/spread|spreads|handicap|\bah\b|让/.test(text))
    return "spreads";
  if (/moneyline|\bml\b|1x2|独赢|match winner/.test(text) || outcome === "draw")
    return "moneyline";
  if ((outcome === "home" || outcome === "away") && !/spread|total/.test(text))
    return "moneyline";
  return "other";
}

function isFootballAlert(alert: PodDropAlert): boolean {
  if (Number(alert.sportId) === 1)
    return true;
  return /football|soccer/i.test(alert.sport);
}

function alertOdds(alert: PodDropAlert): number {
  if (alert.nvp > 1)
    return alert.nvp;
  return alert.current;
}

/**
 * 自动冷票保护：降赔出现后须在此时间内对场/核价并下单。
 * 就绪瞬间就会下，不会等满再下。0 = 不限（可打冷边）。
 * [AutoYabo] 原文无此字段——它只处理 POD 最新一行，过期行自然滚走。
 */
export function podAlertWithinFollowAge(
  alert: Pick<PodDropAlert, "alertedAt">,
  maxAgeSec: number,
  now = Date.now(),
): boolean {
  if (!(maxAgeSec > 0))
    return true;
  if (!Number.isFinite(alert.alertedAt))
    return false;
  return now - alert.alertedAt <= maxAgeSec * 1000;
}

export type PodBetGateFail =
  | "disabled"
  | "age"
  | "sport"
  | "live"
  | "period"
  | "market"
  | "drop"
  | "odds";

export function podAlertBetFailReason(
  alert: PodDropAlert,
  settings: PodBetSettings,
  now = Date.now(),
): PodBetGateFail | null {
  if (!settings.enabled)
    return "disabled";
  if (!podAlertWithinFollowAge(alert, settings.maxAgeSec, now))
    return "age";
  if (settings.footballOnly && !isFootballAlert(alert))
    return "sport";
  if (settings.prematchOnly) {
    const start = Number(alert.starts) || 0;
    if (!(start > now))
      return "live";
  }
  const period = Number(alert.period) || 0;
  if (period === 1 && !settings.includeHt)
    return "period";
  if (period !== 0 && period !== 1)
    return "period";
  const kind = podAlertLineKind(alert);
  if (kind === "moneyline" && !settings.moneyline)
    return "market";
  if (kind === "totals" && !settings.totals)
    return "market";
  if (kind === "spreads" && !settings.spreads)
    return "market";
  if (kind === "other")
    return "market";
  if (alert.dropPct < settings.minDropPct)
    return "drop";
  const odds = alertOdds(alert);
  if (!(odds >= settings.minOdds && odds <= settings.maxOdds))
    return "odds";
  return null;
}

export function podAlertPassesBetGate(
  alert: PodDropAlert,
  settings: PodBetSettings,
  now = Date.now(),
): boolean {
  if (!settings.enabled)
    return true;
  return podAlertBetFailReason(alert, settings, now) == null;
}

export function filterPodAlertsForBet(
  alerts: PodDropAlert[],
  settings: PodBetSettings,
  now = Date.now(),
): PodDropAlert[] {
  if (!settings.enabled)
    return alerts;
  return alerts.filter(a => podAlertPassesBetGate(a, settings, now));
}

export function readPodBetSettings(): PodBetSettings {
  try {
    const raw = localStorage.getItem(POD_BET_SETTINGS_KEY);
    if (!raw)
      return { ...POD_BET_SETTINGS_DEFAULTS };
    return parsePodBetSettings(JSON.parse(raw));
  }
  catch {
    return { ...POD_BET_SETTINGS_DEFAULTS };
  }
}

export function writePodBetSettings(next: PodBetSettings): PodBetSettings {
  const row = parsePodBetSettings(next);
  const json = JSON.stringify(row);
  try {
    if (localStorage.getItem(POD_BET_SETTINGS_KEY) === json)
      return row;
    localStorage.setItem(POD_BET_SETTINGS_KEY, json);
  }
  catch { /* quota */ }
  if (typeof window !== "undefined")
    window.dispatchEvent(new Event(POD_BET_SETTINGS_UPDATED));
  return row;
}
