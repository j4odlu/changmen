import type { AdminAccountDetail } from "@/types/admin";
import type { PlatformId } from "@/types/esport";
import { resolveAccountMultiply } from "@changmen/shared/account_multiply";
import { PlatformAccount } from "@/models/platformAccount";

export interface AccountEditFormState {
  platformName: string;
  playerName: string;
  /** [changmen 扩展] 场馆登录名，只读展示 */
  venueAccountName: string;
  /** [changmen 扩展] 场馆会员 ID，只读展示 */
  venueMemberId: string;
  provider: PlatformId;
  proxyId: number;
  gateway: string;
  token: string;
  referer: string;
  userAgent: string;
  cookie: string;
  credit: number;
  maxBalance: number;
  maxBalanceOdds: number;
  maxProfit: number;
  maxWinBalance: number;
  minOdds: number;
  maxOdds: number;
  minDefault: number;
  maxDefault: number;
  maxOrder: number;
  profit: number;
  maxBetCount: number;
  multiply: number;
  pause: boolean;
  markupOnly: boolean;
  noMarkup: boolean;
  lastOdds: boolean;
  realName: string;
  mobile: string;
  city: string;
  description: string;
  workTimes: string[];
  rateConfig: { minOdds: number; maxOdds: number; rate: number }[];
  game: Record<string, { betCount: number; profit: number; odds: string[] }>;
}

/** [changmen 扩展] 新建体育 OB 卡不继承默认电竞配置；编辑已有卡不改电竞会话。 */
export function prepareObSportAccountForm(form: AccountEditFormState, isNewAccount: boolean): void {
  if (isNewAccount && (form.provider !== "OB" || !form.token.trim())) {
    form.gateway = "";
    form.token = "";
    form.referer = "";
    form.userAgent = "";
    form.cookie = "";
    if (form.provider !== "OB") {
      form.venueMemberId = "";
      form.venueAccountName = "";
    }
  }
  form.provider = "OB";
}

function defaultGameMap() {
  return JSON.parse(
    JSON.stringify(new PlatformAccount({ accountId: 0, playerName: "", provider: "Polymarket" }).game),
  ) as AccountEditFormState["game"];
}

export function createAccountEditFormStateFromPlatformAccount(
  acc: PlatformAccount,
): AccountEditFormState {
  return {
    platformName: acc.platformName || "",
    playerName: acc.playerName ?? "",
    venueAccountName: acc.venueAccountName || "",
    venueMemberId: acc.venueMemberId || "",
    provider: acc.provider,
    proxyId: acc.proxyId ?? 0,
    gateway: acc.gateway || "",
    token: acc.token || "",
    referer: acc.referer || "",
    userAgent: acc.userAgent || "",
    cookie: acc.cookie || "",
    credit: acc.credit ?? 0,
    maxBalance: acc.maxBalance ?? 0,
    maxBalanceOdds: acc.maxBalanceOdds ?? 2,
    maxProfit: acc.maxProfit ?? 0,
    maxWinBalance: acc.maxWinBalance ?? 0,
    minOdds: acc.minOdds ?? 0,
    maxOdds: acc.maxOdds ?? 0,
    minDefault: acc.minDefault ?? 0,
    maxDefault: acc.maxDefault ?? 0,
    maxOrder: acc.maxOrder ?? 0,
    profit: acc.profit ?? 0,
    maxBetCount: acc.maxBetCount ?? 0,
    multiply: resolveAccountMultiply(acc.provider, acc.multiply),
    pause: acc.pause ?? false,
    markupOnly: acc.markupOnly ?? false,
    noMarkup: acc.noMarkup ?? false,
    lastOdds: acc.lastOdds ?? false,
    realName: acc.realName || "",
    mobile: acc.mobile || "",
    city: acc.city || "",
    description: acc.description || "",
    workTimes: acc.workTimes?.length ? [...acc.workTimes] : [],
    rateConfig: acc.rateConfig?.length ? acc.rateConfig.map(r => ({ ...r })) : [],
    game: JSON.parse(JSON.stringify(acc.game ?? defaultGameMap())),
  };
}

export function createAccountEditFormStateFromAdmin(acc: AdminAccountDetail): AccountEditFormState {
  const provider = (acc.platform || "OB") as PlatformId;
  const base = new PlatformAccount({
    accountId: acc.accountId,
    playerName: acc.playerName,
    provider,
    platformId: acc.platformId,
    platformName: acc.platformName,
    game: acc.game,
  });
  return {
    platformName: acc.platformName || "",
    playerName: acc.playerName || "",
    venueAccountName: acc.venueAccountName || "",
    venueMemberId: acc.venueMemberId || "",
    provider,
    proxyId: acc.proxyId ?? 0,
    gateway: acc.gateway || acc.gatewayHost || "",
    token: acc.token || "",
    referer: acc.referer || "",
    userAgent: acc.userAgent || "",
    cookie: acc.cookie || "",
    credit: acc.credit ?? 0,
    maxBalance: acc.maxBalance ?? 0,
    maxBalanceOdds: acc.maxBalanceOdds ?? 2,
    maxProfit: acc.maxProfit ?? 0,
    maxWinBalance: acc.maxWinBalance ?? 0,
    minOdds: acc.minOdds ?? 0,
    maxOdds: acc.maxOdds ?? 0,
    minDefault: acc.minDefault ?? 0,
    maxDefault: acc.maxDefault ?? 0,
    maxOrder: acc.maxOrder ?? 0,
    profit: acc.profit ?? 0,
    maxBetCount: acc.maxBetCount ?? 0,
    multiply: resolveAccountMultiply(provider, acc.multiply),
    pause: acc.pause ?? false,
    markupOnly: acc.markupOnly ?? false,
    noMarkup: acc.noMarkup ?? false,
    lastOdds: acc.lastOdds ?? false,
    realName: acc.realName || "",
    mobile: acc.mobile || "",
    city: acc.city || "",
    description: acc.description || "",
    workTimes: acc.workTimes?.length ? [...acc.workTimes] : [],
    rateConfig: acc.rateConfig?.length ? acc.rateConfig.map(r => ({ ...r })) : [],
    game: JSON.parse(JSON.stringify(acc.game ?? base.game)),
  };
}
