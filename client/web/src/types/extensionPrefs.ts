import type { ValueBetSharpPlatform } from "@/extensions/valueBet/evConfig";
import type { PlatformId } from "@/types/esport";
import {
  clampValueBetEdgePctRange,
  clampValueBetOddsRange,
  createDefaultValueBetSoftPlatforms,
  DEFAULT_AUTO_BET_MAX_EDGE_PCT,
  DEFAULT_AUTO_BET_MAX_ODDS,
  DEFAULT_AUTO_BET_MAX_PER_MAP,
  DEFAULT_AUTO_BET_MIN_EDGE_PCT,
  DEFAULT_AUTO_BET_MIN_ODDS,
  DEFAULT_MIN_EDGE_PCT,
  normalizeValueBetCount,
  normalizeValueBetEdgePct,
  normalizeValueBetOdds,
  normalizeValueBetSharp,
  normalizeValueBetSoftPlatforms,

} from "@/extensions/valueBet/evConfig";
import { ALL_PLATFORMS } from "@/types/userConfig";

export {
  createDefaultValueBetSoftPlatforms,
  normalizeValueBetSoftPlatforms,
} from "@/extensions/valueBet/evConfig";

/** [changmen 扩展] 高利润时放大总注（比例仍按 1/odds） */
export interface StakeScaleByProfitPrefs {
  /** 是否启用 */
  enabled: boolean;
  /**
   * implied 阈值（与 config.profit 同口径）。
   * 默认 1.05 = 利润 ≥ 5% 时触发。
   */
  minImplied: number;
  /** 触发后对两腿 betMoney 同乘的倍数（默认 2） */
  multiplier: number;
  /**
   * 触发加仓时，预检/下注换算是否忽略账号比例系数（rateConfig）。
   * 默认关闭：仍按账号比例缩放。
   */
  skipAccountRateOnScale: boolean;
}

/**
 * [changmen 扩展] 套利失败敞口自动减仓。
 * 一腿 PM/PF 已成交、对侧拒单且未能入补单队列（或补单随后放弃）时，市价卖掉已成交预测市场腿。
 * 默认关闭；不做止盈，仅风控减仓。
 *
 * 暂不可开启：与 A8 补单 prune 叠加有误卖敞口风险，待 staging 验证后再放开。
 * 放开时：改 `ARB_FAIL_AUTO_SELL_AVAILABLE`、UI 开关，并恢复 normalize 对 enabled 的解析。
 */
export interface ArbFailAutoSellPrefs {
  enabled: boolean;
}

/**
 * [changmen 扩展] RAY 接口受理后发生延迟拒单时，交给现有补单队列处理。
 * 仅控制旁路监控的后续动作；监控本身始终开启。默认关闭。
 */
export interface RayLateRejectAutoMakeupPrefs {
  enabled: boolean;
  /** 从 RAY 官网订单买入时间起计算的延迟拒单观察窗口（分钟）。 */
  monitorMinutes: number;
}

export const RAY_REJECT_MONITOR_DEFAULT_MINUTES = 5;
export const RAY_REJECT_MONITOR_MIN_MINUTES = 1;
export const RAY_REJECT_MONITOR_MAX_MINUTES = 60;

export function createDefaultRayLateRejectAutoMakeup(): RayLateRejectAutoMakeupPrefs {
  return {
    enabled: false,
    monitorMinutes: RAY_REJECT_MONITOR_DEFAULT_MINUTES,
  };
}

/** 失败减仓是否允许用户开启（临时锁死） */
export const ARB_FAIL_AUTO_SELL_AVAILABLE = false;

/**
 * [changmen 扩展] 双边预测市场提前锁利。
 * 仅当套利 Link 两边都是可卖的 PM/PF 时生效：两边同时市价卖出，
 * 卖出净利 ≥ 锁定利润 × (1 + minExtraProfitPct/100) 才触发。
 * 庄+预测市场不触发（避免打单边）。默认关闭。
 */
export interface ArbEarlyLockSellPrefs {
  enabled: boolean;
  /**
   * 遗留字段（旧版 pmEdge/floor）。新逻辑固定「双边同卖净利 vs 锁定利润」，忽略 mode。
   * 保留以免旧 Clients 反序列化炸掉。
   */
  mode: "pmEdge" | "floor";
  /**
   * 相对锁定利润至少再多出的百分比（默认 0）。
   * 例：10 = 同卖净利 ≥ 锁定利润 × 1.10。旧字段 minExtraProfit（CNY）忽略。
   */
  minExtraProfitPct: number;
}

/** [changmen 扩展] PM 套利：卖一 × multiplier（展示 + FOK；见 PM_ARB_PRICE_BUFFER_PLAN.md） */
export interface PmArbPriceBufferPrefs {
  enabled: boolean;
  /** [changmen 扩展] 缺失 = 原百分比；tick = 卖一增加一档。 */
  mode?: "percent" | "tick";
  /** 卖一倍数；默认 1.01 */
  multiplier: number;
}

export function createDefaultPmArbPriceBufferPrefs(): PmArbPriceBufferPrefs {
  return { enabled: false, multiplier: 1.01 };
}

/** [changmen 扩展] PM FOK：成交价及更优档须 ≥ 本金 × multiplier；默认关 = 现网 1× */
export interface PmFokDepthBufferPrefs {
  enabled: boolean;
  /** 深度倍数；默认 1.5 */
  multiplier: number;
}

export function createDefaultPmFokDepthBufferPrefs(): PmFokDepthBufferPrefs {
  return { enabled: false, multiplier: 1.5 };
}

/** [changmen 扩展] PF 套利：卖一 × multiplier（展示 + 限价；见 PF_ARB_PRICE_BUFFER_PLAN.md） */
export interface PfArbPriceBufferPrefs {
  enabled: boolean;
  /** 卖一倍数；默认 1.01 */
  multiplier: number;
}

export function createDefaultPfArbPriceBufferPrefs(): PfArbPriceBufferPrefs {
  return { enabled: false, multiplier: 1.01 };
}

export type MakeupOddsBandMode = "oddsFactor" | "profitRate";

/**
 * [changmen 扩展] 补单消费上下沿。
 * 默认关 = 现网 makeProfit 地板；开则替代补单消费 / anyOdds 重试门槛。
 * `oddsFactor` 保留原「打平赔率 × 系数」行为；`profitRate` 按补单后总体保底利润率判断。
 */
export interface MakeupOddsBandPrefs {
  enabled: boolean;
  /** 缺省按旧版 oddsFactor，保证存量用户行为不变 */
  mode?: MakeupOddsBandMode;
  /** 打平赔率上浮系数，默认 1.02，须 > 1 */
  upper: number;
  /** 打平赔率下浮系数，默认 0.96；0 = 关闭下沿（只留上沿） */
  lower: number;
  /** 总体盈利率上沿（百分数，例如 4 = 4%） */
  upperProfitPct?: number;
  /** 总体亏损率下沿的绝对值（百分数，例如 3 = -3%） */
  lowerLossPct?: number;
}

export const DEFAULT_MAKEUP_ODDS_BAND_UPPER = 1.02;
export const DEFAULT_MAKEUP_ODDS_BAND_LOWER = 0.96;
export const DEFAULT_MAKEUP_PROFIT_UPPER_PCT = 4;
export const DEFAULT_MAKEUP_LOSS_LOWER_PCT = 3;

export function createDefaultMakeupOddsBandPrefs(): MakeupOddsBandPrefs {
  return {
    enabled: false,
    mode: "oddsFactor",
    upper: DEFAULT_MAKEUP_ODDS_BAND_UPPER,
    lower: DEFAULT_MAKEUP_ODDS_BAND_LOWER,
    upperProfitPct: DEFAULT_MAKEUP_PROFIT_UPPER_PCT,
    lowerLossPct: DEFAULT_MAKEUP_LOSS_LOWER_PCT,
  };
}

/** [changmen 扩展] 控制台显示皮肤；不改 DOM 结构，仅换 CSS 令牌 */
export type UiTheme = "default" | "brutal" | "paper" | "terminal";

export const UI_THEMES: readonly UiTheme[] = ["default", "brutal", "paper", "terminal"];

/** 浅色皮：需去掉 html.dark，避免 EP 深色变量压过 */
export const LIGHT_UI_THEMES: ReadonlySet<UiTheme> = new Set(["brutal", "paper"]);

export function isLightUiTheme(theme: UiTheme): boolean {
  return LIGHT_UI_THEMES.has(theme);
}

/**
 * [changmen 扩展] EV 金色标记 / 正 EV 自动下注配置（「界面」Tab）。
 * 确认下单与角标共用 sharp / 正EV 阈值；自动下单用 autoBet，金额仍在参数配置。
 */
export interface ValueBetAutoBetPrefs {
  /** 自动下注开关。默认关。开启后主循环扫描，不依赖套利开关。 */
  enabled: boolean;
  /** 软盘 edge 下限（含，百分比）。与金色正EV阈值独立。默认 3 */
  minEdgePct: number;
  /** 软盘 edge 上限（含，百分比）。默认 20 */
  maxEdgePct: number;
  /** 基准馆该侧赔率下限（含）。默认 1.3 */
  minOdds: number;
  /** 基准馆该侧赔率上限（含）。默认 10 */
  maxOdds: number;
  /**
   * 同一比赛同一地图（ViewBet.round，含全场 0）最多下几笔 EV（确认+自动合计）。
   * 默认 1；本机累计（多标签共用），刷新不清零。
   */
  maxPerMap: number;
}

export interface ValueBetMarkerPrefs {
  sharp: ValueBetSharpPlatform;
  /** 正 EV 阈值（百分比）。≥ 此值金色，并可点角标确认下单。默认 3 */
  minEdgePct: number;
  autoBet: ValueBetAutoBetPrefs;
}

/**
 * [changmen 扩展] Client_SaveData key=Extensions。
 * 界面皮肤 / BetRow UI / EV sharp·阈值在用户中心「界面」Tab；
 * EV 软盘 / 套利场馆白名单及其余扩展项在「扩展」Tab。
 */
export interface ExtensionPrefs extends Record<string, unknown> {
  /** BetRow 套利划线、利润角标、赔率 flash、EV 标记（「界面」Tab） */
  betRowUi: boolean;
  /** EV 金色标记基准与阈值（「界面」Tab） */
  valueBet: ValueBetMarkerPrefs;
  /**
   * EV 可标记/下注的软盘（「扩展」Tab）。
   * normalize 后永非空；运行时再剔除 sharp。默认 = VALUE_BET_SOFT_CANDIDATES。
   */
  valueBetSoftPlatforms: PlatformId[];
  /**
   * 自动套利允许场馆（「扩展」Tab）。
   * null = 不限制（现网：凡有余额够本金的馆都参与）；非空 = 与 getProviders 求交。
   * 空数组在 normalize 时升为 null，禁止静默全关。
   */
  arbAllowedPlatforms: PlatformId[] | null;
  /** 比例 9999 单边模式：本侧是否参与自动套利预检（仍不自动下单） */
  singleLeg9999Precheck: boolean;
  /**
   * 9999 单边时，真下单腿改用参数配置的正 EV 金额（valueBetMoney）。
   * 预检腿保持原套利计划额。默认关闭。
   */
  singleLeg9999UseValueBetMoney: boolean;
  /**
   * 9999 单边同一比赛同一地图（ViewBet.round，含全场 0）最多下几笔。
   * 默认 1；独立于正 EV 同图次数。
   */
  singleLeg9999MaxPerMap: number;
  /** 利润达阈值时放大下注金额 */
  stakeScaleByProfit: StakeScaleByProfitPrefs;
  /** 套利失败敞口：自动卖掉已成交的 PM/PF 腿 */
  arbFailAutoSell: ArbFailAutoSellPrefs;
  /** RAY 延迟拒单：复用现有补单策略自动入队 */
  rayLateRejectAutoMakeup: RayLateRejectAutoMakeupPrefs;
  /** 双边预测市场：同卖净利优于锁定利润时两边一起卖 */
  arbEarlyLockSell: ArbEarlyLockSellPrefs;
  /** PM 套利：有 fo 时读打折档（展示/扫描/对冲/FOK）；无 fo 不打折；默认关 = 现网 */
  pmArbPriceBuffer: PmArbPriceBufferPrefs;
  /** PM FOK：成交价及更优档深度倍数；默认关 = 现网 1× */
  pmFokDepthBuffer: PmFokDepthBufferPrefs;
  /** PF 套利：有 fo 时读打折档（展示/扫描/对冲/限价）；无 fo 不打折；默认关 = 裸限价 */
  pfArbPriceBuffer: PfArbPriceBufferPrefs;
  /**
   * 补单上下沿（赔率系数 / 总体利润率）。默认关；UI 在参数配置「补单配置」，存储仍走 Extensions。
   */
  makeupOddsBand: MakeupOddsBandPrefs;
  /**
   * 控制台 UI 皮肤（「界面」Tab）。
   * default = 现有深色；brutal = 粗边框；paper = 浅纸感；terminal = 终端风。
   */
  uiTheme: UiTheme;
}

export function normalizeUiTheme(raw: unknown): UiTheme {
  if (raw === "brutal" || raw === "paper" || raw === "terminal")
    return raw;
  return "default";
}

export function createDefaultStakeScaleByProfit(): StakeScaleByProfitPrefs {
  return {
    enabled: false,
    minImplied: 1.05,
    multiplier: 2,
    skipAccountRateOnScale: false,
  };
}

export function createDefaultArbFailAutoSell(): ArbFailAutoSellPrefs {
  return { enabled: false };
}

export function createDefaultArbEarlyLockSell(): ArbEarlyLockSellPrefs {
  return {
    enabled: false,
    mode: "floor",
    minExtraProfitPct: 0,
  };
}

export function createDefaultValueBetAutoBetPrefs(): ValueBetAutoBetPrefs {
  return {
    enabled: false,
    minEdgePct: DEFAULT_AUTO_BET_MIN_EDGE_PCT,
    maxEdgePct: DEFAULT_AUTO_BET_MAX_EDGE_PCT,
    minOdds: DEFAULT_AUTO_BET_MIN_ODDS,
    maxOdds: DEFAULT_AUTO_BET_MAX_ODDS,
    maxPerMap: DEFAULT_AUTO_BET_MAX_PER_MAP,
  };
}

export function createDefaultValueBetMarkerPrefs(): ValueBetMarkerPrefs {
  return {
    sharp: "PB",
    minEdgePct: DEFAULT_MIN_EDGE_PCT,
    autoBet: createDefaultValueBetAutoBetPrefs(),
  };
}

/**
 * 套利白名单：null/缺省/非数组/过滤后空 → null（不限制）。
 * 不把空数组当「全关」。
 */
export function normalizeArbAllowedPlatforms(raw: unknown): PlatformId[] | null {
  if (raw == null)
    return null;
  if (!Array.isArray(raw))
    return null;
  const allowed = new Set<string>(ALL_PLATFORMS);
  const out: PlatformId[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "string" || !allowed.has(item) || seen.has(item))
      continue;
    seen.add(item);
    out.push(item as PlatformId);
  }
  return out.length > 0 ? out : null;
}

/** 自动套利 providerKeys：null/空 = 透传 funded。 */
export function filterArbProviderKeys(
  funded: readonly PlatformId[],
  allowed: PlatformId[] | null | undefined,
): PlatformId[] {
  if (allowed == null || allowed.length === 0)
    return [...funded];
  const set = new Set(allowed);
  return funded.filter(p => set.has(p));
}

/** Chip：null/空 = 全部参与（全亮），与 filterArbProviderKeys 一致。 */
export function isArbAllowedPlatformOn(
  current: PlatformId[] | null | undefined,
  platform: PlatformId,
): boolean {
  if (current == null || current.length === 0)
    return true;
  return current.includes(platform);
}

/**
 * Chip 切换：亮=参与。null/全开 = 全部参与；可见馆至少留一个。
 * 关掉一张后不会升成 null（避免空名单被当成全部参与）。
 */
export function toggleArbAllowedPlatform(
  current: PlatformId[] | null | undefined,
  platform: PlatformId,
  allBet: readonly PlatformId[],
): PlatformId[] | null {
  const selected = new Set<PlatformId>(current == null || current.length === 0 ? allBet : current);
  if (selected.has(platform)) {
    const remainingBet = allBet.filter(p => p !== platform && selected.has(p));
    if (remainingBet.length === 0)
      return current == null || current.length === 0 ? null : current;
    selected.delete(platform);
    const next = normalizeArbAllowedPlatforms([...selected]);
    if (next == null)
      return current == null || current.length === 0 ? null : current;
    return next;
  }
  selected.add(platform);
  const normalized = normalizeArbAllowedPlatforms([...selected]);
  if (normalized && allBet.length > 0 && allBet.every(p => normalized.includes(p)))
    return null;
  return normalized;
}

export function createDefaultExtensionPrefs(): ExtensionPrefs {
  return {
    betRowUi: false,
    valueBet: createDefaultValueBetMarkerPrefs(),
    valueBetSoftPlatforms: createDefaultValueBetSoftPlatforms(),
    arbAllowedPlatforms: null,
    singleLeg9999Precheck: true,
    singleLeg9999UseValueBetMoney: false,
    singleLeg9999MaxPerMap: 1,
    stakeScaleByProfit: createDefaultStakeScaleByProfit(),
    arbFailAutoSell: createDefaultArbFailAutoSell(),
    rayLateRejectAutoMakeup: createDefaultRayLateRejectAutoMakeup(),
    arbEarlyLockSell: createDefaultArbEarlyLockSell(),
    pmArbPriceBuffer: createDefaultPmArbPriceBufferPrefs(),
    pmFokDepthBuffer: createDefaultPmFokDepthBufferPrefs(),
    pfArbPriceBuffer: createDefaultPfArbPriceBufferPrefs(),
    makeupOddsBand: createDefaultMakeupOddsBandPrefs(),
    uiTheme: "default",
  };
}

function normalizeStakeScaleByProfit(raw: unknown): StakeScaleByProfitPrefs {
  const defaults = createDefaultStakeScaleByProfit();
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    return defaults;
  const row = raw as Record<string, unknown>;
  const minImplied = Number(row.minImplied);
  const multiplier = Number(row.multiplier);
  return {
    enabled: row.enabled === true,
    minImplied: Number.isFinite(minImplied) && minImplied > 1 ? minImplied : defaults.minImplied,
    multiplier: Number.isFinite(multiplier) && multiplier > 0 ? multiplier : defaults.multiplier,
    skipAccountRateOnScale: row.skipAccountRateOnScale === true,
  };
}

function normalizeArbFailAutoSell(raw: unknown): ArbFailAutoSellPrefs {
  if (!ARB_FAIL_AUTO_SELL_AVAILABLE)
    return createDefaultArbFailAutoSell();
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    return createDefaultArbFailAutoSell();
  const row = raw as Record<string, unknown>;
  return { enabled: row.enabled === true };
}

function normalizeArbEarlyLockSell(raw: unknown): ArbEarlyLockSellPrefs {
  const defaults = createDefaultArbEarlyLockSell();
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    return defaults;
  const row = raw as Record<string, unknown>;
  const pct = Number(row.minExtraProfitPct);
  return {
    enabled: row.enabled === true,
    // 新逻辑忽略 mode；normalize 仍落合法值以免脏数据
    mode: row.mode === "pmEdge" ? "pmEdge" : "floor",
    // 不迁移旧 minExtraProfit（CNY），避免把「多 20 块」误读成 20%
    minExtraProfitPct: Number.isFinite(pct) && pct >= 0 && pct <= 500
      ? pct
      : defaults.minExtraProfitPct,
  };
}

function normalizePmArbPriceBuffer(raw: unknown): PmArbPriceBufferPrefs {
  const defaults = createDefaultPmArbPriceBufferPrefs();
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    return defaults;
  const row = raw as Record<string, unknown>;
  const multiplier = Number(row.multiplier);
  return {
    enabled: row.enabled === true,
    ...(row.mode === "tick" ? { mode: "tick" as const } : {}),
    multiplier: Number.isFinite(multiplier) && multiplier >= 1.01 && multiplier <= 1.1
      ? Math.round(multiplier * 1000) / 1000
      : defaults.multiplier,
  };
}

function normalizePmFokDepthBuffer(raw: unknown): PmFokDepthBufferPrefs {
  const defaults = createDefaultPmFokDepthBufferPrefs();
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    return defaults;
  const row = raw as Record<string, unknown>;
  const multiplier = Number(row.multiplier);
  return {
    enabled: row.enabled === true,
    multiplier: Number.isFinite(multiplier) && multiplier >= 1.1 && multiplier <= 10
      ? Math.round(multiplier * 10) / 10
      : defaults.multiplier,
  };
}

export function normalizeMakeupOddsBand(raw: unknown): MakeupOddsBandPrefs {
  const defaults = createDefaultMakeupOddsBandPrefs();
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    return defaults;
  const row = raw as Record<string, unknown>;
  const upper = Number(row.upper);
  const lowerMissing = row.lower == null || row.lower === "";
  const lower = Number(row.lower);
  const upperProfitPct = Number(row.upperProfitPct);
  const lowerLossPct = Number(row.lowerLossPct);
  return {
    enabled: row.enabled === true,
    mode: row.mode === "profitRate" ? "profitRate" : "oddsFactor",
    upper: Number.isFinite(upper) && upper > 1 && upper <= 1.5
      ? Math.round(upper * 1000) / 1000
      : defaults.upper,
    // el-input-number 清空为 null，不能当成「下沿 0=关闭」
    lower: lowerMissing
      ? defaults.lower
      : lower === 0
        ? 0
        : Number.isFinite(lower) && lower > 0 && lower < 1
          ? Math.round(Math.max(0.5, lower) * 1000) / 1000
          : defaults.lower,
    upperProfitPct: Number.isFinite(upperProfitPct) && upperProfitPct >= 0 && upperProfitPct <= 100
      ? Math.round(upperProfitPct * 100) / 100
      : defaults.upperProfitPct,
    lowerLossPct: Number.isFinite(lowerLossPct) && lowerLossPct >= 0 && lowerLossPct <= 100
      ? Math.round(lowerLossPct * 100) / 100
      : defaults.lowerLossPct,
  };
}

function normalizeRayLateRejectAutoMakeup(raw: unknown): RayLateRejectAutoMakeupPrefs {
  const defaults = createDefaultRayLateRejectAutoMakeup();
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    return defaults;
  const row = raw as Record<string, unknown>;
  const monitorMinutes = Number(row.monitorMinutes);
  return {
    enabled: row.enabled === true,
    monitorMinutes: Number.isFinite(monitorMinutes)
      ? Math.round(Math.min(
          RAY_REJECT_MONITOR_MAX_MINUTES,
          Math.max(RAY_REJECT_MONITOR_MIN_MINUTES, monitorMinutes),
        ))
      : defaults.monitorMinutes,
  };
}

function normalizePfArbPriceBuffer(raw: unknown): PfArbPriceBufferPrefs {
  const defaults = createDefaultPfArbPriceBufferPrefs();
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    return defaults;
  const row = raw as Record<string, unknown>;
  const multiplier = Number(row.multiplier);
  return {
    enabled: row.enabled === true,
    multiplier: Number.isFinite(multiplier) && multiplier >= 1.01 && multiplier <= 1.1
      ? Math.round(multiplier * 1000) / 1000
      : defaults.multiplier,
  };
}

export function normalizeExtensionPrefs(raw: unknown): ExtensionPrefs {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    return createDefaultExtensionPrefs();
  const row = raw as Record<string, unknown>;
  return {
    betRowUi: row.betRowUi === true,
    valueBet: normalizeValueBetMarkerPrefs(row.valueBet),
    valueBetSoftPlatforms: normalizeValueBetSoftPlatforms(row.valueBetSoftPlatforms),
    arbAllowedPlatforms: normalizeArbAllowedPlatforms(row.arbAllowedPlatforms),
    singleLeg9999Precheck: row.singleLeg9999Precheck !== false,
    singleLeg9999UseValueBetMoney: row.singleLeg9999UseValueBetMoney === true,
    singleLeg9999MaxPerMap: normalizeValueBetCount(row.singleLeg9999MaxPerMap, 1),
    stakeScaleByProfit: normalizeStakeScaleByProfit(row.stakeScaleByProfit),
    arbFailAutoSell: normalizeArbFailAutoSell(row.arbFailAutoSell),
    rayLateRejectAutoMakeup: normalizeRayLateRejectAutoMakeup(row.rayLateRejectAutoMakeup),
    arbEarlyLockSell: normalizeArbEarlyLockSell(row.arbEarlyLockSell),
    pmArbPriceBuffer: normalizePmArbPriceBuffer(row.pmArbPriceBuffer),
    pmFokDepthBuffer: normalizePmFokDepthBuffer(row.pmFokDepthBuffer),
    pfArbPriceBuffer: normalizePfArbPriceBuffer(row.pfArbPriceBuffer),
    makeupOddsBand: normalizeMakeupOddsBand(row.makeupOddsBand),
    uiTheme: normalizeUiTheme(row.uiTheme),
    // pbWsShadowUi 仅本机 localStorage，故意不从 RDS / Extensions 读取或写回
  };
}

function normalizeValueBetAutoBetPrefs(raw: unknown): ValueBetAutoBetPrefs {
  const defaults = createDefaultValueBetAutoBetPrefs();
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    return defaults;
  const row = raw as Record<string, unknown>;
  const minEdgePct = normalizeValueBetEdgePct(row.minEdgePct, defaults.minEdgePct);
  const maxEdgePct = normalizeValueBetEdgePct(row.maxEdgePct, defaults.maxEdgePct);
  const edgeRange = clampValueBetEdgePctRange(minEdgePct, maxEdgePct);
  const minOdds = normalizeValueBetOdds(row.minOdds, defaults.minOdds);
  const maxOdds = normalizeValueBetOdds(row.maxOdds, defaults.maxOdds);
  const range = clampValueBetOddsRange(minOdds, maxOdds);
  return {
    enabled: row.enabled === true,
    minEdgePct: edgeRange.minEdgePct,
    maxEdgePct: edgeRange.maxEdgePct,
    minOdds: range.minOdds,
    maxOdds: range.maxOdds,
    maxPerMap: normalizeValueBetCount(row.maxPerMap, defaults.maxPerMap),
  };
}

function normalizeValueBetMarkerPrefs(raw: unknown): ValueBetMarkerPrefs {
  const defaults = createDefaultValueBetMarkerPrefs();
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    return defaults;
  const row = raw as Record<string, unknown>;
  const minEdgePct = normalizeValueBetEdgePct(row.minEdgePct, defaults.minEdgePct);
  return {
    sharp: normalizeValueBetSharp(row.sharp),
    minEdgePct,
    autoBet: normalizeValueBetAutoBetPrefs(row.autoBet),
  };
}

/** 序列化 Extensions 上报体：不含本机-only 字段（如 pbWsShadowUi） */
export function serializeExtensionPrefsForSave(prefs: ExtensionPrefs): string {
  return JSON.stringify(normalizeExtensionPrefs(prefs));
}
