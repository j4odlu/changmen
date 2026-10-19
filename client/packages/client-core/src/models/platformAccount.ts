import type { AccountCurrency, AccountRecord } from "../types/account";
import type { PlatformId } from "@changmen/api-contract";
import { ALL_PLATFORMS } from "../types/platforms";
import { resolveAccountMultiply } from "@changmen/shared/account_multiply";
import { getExchange, resolveAccountCurrency } from "@changmen/shared/currency";

const DEFAULT_GAMES = ["英雄联盟", "DOTA2", "CS:GO", "王者荣耀", "无畏契约"];

export interface AccountRateRow { minOdds: number; maxOdds: number; rate: number }

/** [A8 可证实] 保存账号：`rateConfig.filter(C => C.rate !== 0)` */
export function normalizeAccountRateConfig(rows: AccountRateRow[] | undefined): AccountRateRow[] {
  if (!rows?.length)
    return [];
  return rows
    .map(r => ({
      minOdds: Number(r.minOdds) || 0,
      maxOdds: Number(r.maxOdds) || 0,
      rate: Number(r.rate),
    }))
    .filter(r => !Number.isNaN(r.rate) && r.rate !== 0);
}

/** 对齐 A8 bundle `uv`（单平台操盘账号） */
export class PlatformAccount implements AccountRecord {
  accountId: number;
  platformId?: number;
  platformName?: string;
  playerName: string;
  provider: PlatformId;
  proxyId?: number;
  gateway?: string;
  token?: string;
  referer?: string;
  userAgent?: string;
  cookie?: string;
  balance?: number;
  credit?: number;
  currency: AccountCurrency | string;
  updateTime: number;
  loadingBalance = false;
  /**
   * [changmen 扩展] 本轮余额刷新瞬时失败，但仍保留上次余额供显示。
   * 不落库；真鉴权失败仍清 balance → TOKEN ERROR。
   */
  balanceStale = false;
  /**
   * [changmen 扩展] 熊猫体育钱包，只给 `/sports` 展示。
   * 不进 `account.balance`、不写 Client_UpdateBalance、不进 ACCOUNT JSON。
   */
  sportBalance?: number;
  sportBalanceStale = false;
  /** 体育余额最近一次失败原因；仅内存展示，不落 ACCOUNT。 */
  sportBalanceError = "";
  active = false;
  today = 0;
  orderCount = 0;
  unsettle = 0;
  maxBalance = 0;
  maxBalanceOdds = 2;
  minOdds = 0;
  maxOdds = 0;
  minDefault = 0;
  maxDefault = 0;
  totalProfit?: number;
  maxProfit?: number;
  maxOrder = 0;
  todayOrder = 0;
  description?: string;
  maxWinBalance = 0;
  winBalance = 0;
  markupOnly = false;
  noMarkup = false;
  pause = false;
  realName?: string;
  mobile?: string;
  city?: string;
  rateConfig: AccountRecord["rateConfig"] = [];
  profit = 0;
  maxBetCount = 0;
  game: AccountRecord["game"] = {};
  workTimes?: string[];
  lastOdds?: boolean;
  multiply = 1;
  /** 对齐 A8 uv：连续接口异常计数（如 redis:nil） */
  errorCount = 0;
  /** [changmen 扩展] 场馆会员 ID（如 OB uid） */
  venueMemberId?: string;
  /** [changmen 扩展] 场馆登录名（如 OB account） */
  venueAccountName?: string;
  /**
   * [changmen 扩展] 熊猫体育凭证，与电竞 token 分存。
   * 不经 Client_SaveData(ACCOUNT)。
   */
  sportOb?: AccountRecord["sportOb"];

  constructor(raw: Partial<AccountRecord>) {
    this.accountId = Number(raw.accountId) || 0;
    this.platformId = raw.platformId;
    this.platformName = raw.platformName;
    this.playerName = raw.playerName || "";
    this.provider = (raw.provider as PlatformId) || "OB";
    const legacy = raw as Partial<AccountRecord> & {
      venueId?: string;
      sportBalance?: number;
      sportBalanceStale?: boolean;
      sportBalanceError?: string;
    };
    const { balance: _storedBalance, active: _storedActive, venueId: legacyVenueId, sportBalance: _sportBal, sportBalanceStale: _sportStale, ...rest } = legacy;
    Object.assign(this, rest);
    if (!this.venueMemberId && legacyVenueId != null && String(legacyVenueId).trim())
      this.venueMemberId = String(legacyVenueId).trim();
    this.rateConfig = normalizeAccountRateConfig(raw.rateConfig);
    this.balance = undefined;
    this.balanceStale = false;
    this.sportBalance = undefined;
    this.sportBalanceStale = false;
    this.sportBalanceError = "";
    this.active = false;
    this.credit = raw.credit ?? 0;
    this.currency = resolveAccountCurrency(this.provider, raw.currency);
    this.updateTime = raw.updateTime ?? 0;
    this.today = raw.today ?? 0;
    this.orderCount = raw.orderCount ?? 0;
    this.unsettle = raw.unsettle ?? 0;
    this.multiply = resolveAccountMultiply(this.provider, raw.multiply);
    for (const g of DEFAULT_GAMES) {
      if (!this.game?.[g]) {
        this.game = { ...this.game, [g]: { betCount: 0, profit: 0, odds: [] } };
      }
    }
  }

  /** 对齐 A8 `uv.getBalance`：场馆原币余额 × 汇率（CNY 口径） */
  getBalance(): number | undefined {
    if (this.balance === undefined)
      return undefined;
    return this.balance * getExchange(this.currency);
  }

  getBetMoney(amount: number, odds: number) {
    const money = Math.round(amount / getExchange(this.currency));
    if (!this.rateConfig?.length)
      return money;
    const row = this.rateConfig.find(
      r =>
        (r.minOdds === 0 || r.minOdds <= odds) && (r.maxOdds === 0 || r.maxOdds >= odds),
    );
    let rate = row?.rate ?? 0;
    if (rate === 0)
      rate = 1;
    return money < 1 ? money : Math.floor(money * rate);
  }

  getMinOdds() {
    const extra
      = this.maxBalance && (this.balance ?? 0) >= this.maxBalance ? this.maxBalanceOdds : 0;
    return Math.max(this.minOdds, extra);
  }

  getMaxOdds() {
    return this.maxOdds === 0 ? 99 : this.maxOdds;
  }

  checkOdds(odds: number, _gameId?: number) {
    return this.getMinOdds() <= odds && this.getMaxOdds() >= odds;
  }

  /** 对齐 A8 `uv.isPause`：当前小时是否落在任一 workTimes 区间（格式 `9-18`） */
  static isWithinWorkTimes(workTimes: string[] | undefined): boolean {
    if (!workTimes?.length)
      return true;
    const hour = new Date().getHours();
    let inRange = false;
    for (const slot of workTimes) {
      const [startRaw, endRaw] = slot.split("-");
      const start = Number(startRaw);
      const end = Number(endRaw);
      if (Number.isNaN(start) || Number.isNaN(end))
        continue;
      if (start <= hour && hour <= end) {
        inRange = true;
        break;
      }
    }
    return inRange;
  }

  /** 账号游戏配置：赔率区间 `min-max` 列表 */
  static passesGameOddsRanges(ranges: string[] | undefined, odds: number): boolean {
    if (!ranges?.length)
      return true;
    return ranges.some((raw) => {
      const [lo, hi] = raw.split("-").map(x => Number(x));
      return !Number.isNaN(lo) && !Number.isNaN(hi) && lo <= odds && odds <= hi;
    });
  }

  /** 该游戏最低利润要求：游戏级 > 账号级 > 全局默认 */
  static profitFloorForGame(
    account: PlatformAccount,
    gameName: string | undefined,
    configProfit: number,
  ): number {
    const gameProfit = gameName ? account.game?.[gameName]?.profit : 0;
    if (gameProfit)
      return gameProfit;
    if (account.profit)
      return account.profit;
    return configProfit;
  }

  passesGameSettings(gameName: string, odds: number, implied?: number): boolean {
    const row = this.game?.[gameName];
    if (!row)
      return true;
    if (row.profit && implied != null && implied < row.profit)
      return false;
    if (!PlatformAccount.passesGameOddsRanges(row.odds, odds))
      return false;
    return true;
  }

  isPause(): string | false {
    return resolveAccountPauseReason(this);
  }

  /** 对齐 A8 uv.logout：清空会话，停止使用该账号下单 */
  logout() {
    this.balance = undefined;
    this.balanceStale = false;
    this.token = undefined;
    this.errorCount = 0;
  }

  applyPatch(patch: Partial<AccountRecord>) {
    const { balance, rateConfig, game, workTimes, ...rest } = patch;
    Object.assign(this, rest);
    if (rateConfig !== undefined) {
      this.rateConfig = normalizeAccountRateConfig(rateConfig);
    }
    if (game !== undefined) {
      this.game = JSON.parse(JSON.stringify(game));
    }
    if (workTimes !== undefined) {
      this.workTimes = [...workTimes];
    }
    if (balance !== undefined) {
      this.balance = balance == null ? undefined : Number(balance);
    }
    if (rest.multiply !== undefined) {
      this.multiply = resolveAccountMultiply(this.provider, rest.multiply);
    }
  }

  toJSON(): AccountRecord {
    const {
      loadingBalance: _lb,
      balanceStale: _stale,
      sportBalance: _sb,
      sportBalanceStale: _sbs,
      sportBalanceError: _sbe,
      ...rest
    } = this;
    return JSON.parse(JSON.stringify(rest)) as AccountRecord;
  }

  static sortByProvider(a: PlatformAccount, b: PlatformAccount) {
    const ia = ALL_PLATFORMS.indexOf(a.provider);
    const ib = ALL_PLATFORMS.indexOf(b.provider);
    return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
  }
}

export interface AccountPauseInput {
  pause?: boolean;
  maxOrder?: number;
  todayOrder?: number;
  maxProfit?: number;
  totalProfit?: number;
  maxWinBalance?: number;
  winBalance?: number;
  workTimes?: string[];
}

/** 对齐 A8 `uv.isPause`：返回暂停原因文案，未暂停则 false */
export function resolveAccountPauseReason(account: AccountPauseInput): string | false {
  if (account.pause)
    return "手动设定账号暂停";
  if (account.maxOrder && (account.todayOrder ?? 0) >= account.maxOrder) {
    return `当日订单 ${account.todayOrder} 笔，超过设定 ${account.maxOrder}`;
  }
  if (account.maxProfit && account.totalProfit && account.totalProfit >= account.maxProfit) {
    return `整体盈利 ${account.totalProfit}，超过设定 ${account.maxProfit}`;
  }
  if (account.maxWinBalance && account.winBalance && account.winBalance >= account.maxWinBalance) {
    return `盈利余额 ${account.winBalance}，超过设定 ${account.maxWinBalance}`;
  }
  if (account.workTimes?.length && !PlatformAccount.isWithinWorkTimes(account.workTimes)) {
    return "不在工作时间";
  }
  return false;
}
