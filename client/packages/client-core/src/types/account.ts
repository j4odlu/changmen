import type { PlatformId } from "@changmen/api-contract";

export type AccountCurrency = "CNY" | "USDT";

/** ACCOUNT KV 单条记录（对齐 A8 `uv` 序列化字段） */
export interface AccountRecord {
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
  currency?: AccountCurrency | string;
  updateTime?: number;
  loadingBalance?: boolean;
  active?: boolean;
  today?: number;
  orderCount?: number;
  unsettle?: number;
  maxBalance?: number;
  maxBalanceOdds?: number;
  minOdds?: number;
  maxOdds?: number;
  minDefault?: number;
  maxDefault?: number;
  totalProfit?: number;
  maxProfit?: number;
  maxOrder?: number;
  todayOrder?: number;
  description?: string;
  maxWinBalance?: number;
  winBalance?: number;
  markupOnly?: boolean;
  noMarkup?: boolean;
  pause?: boolean;
  realName?: string;
  mobile?: string;
  city?: string;
  rateConfig?: { minOdds: number; maxOdds: number; rate: number }[];
  profit?: number;
  maxBetCount?: number;
  game?: Record<string, { betCount: number; profit: number; odds: string[] }>;
  workTimes?: string[];
  lastOdds?: boolean;
  multiply?: number;
  /** [changmen 扩展] 场馆会员 ID（如 OB balance.uid），text 避免超大整数精度丢失 */
  venueMemberId?: string;
  /** [changmen 扩展] 场馆登录名（如 OB balance.account） */
  venueAccountName?: string;
  /**
   * [changmen 扩展] 熊猫体育凭证。与电竞 `token` 独立。
   * Client_SaveData(ACCOUNT) 不写此字段；走 Client_SaveSportAccount。
   */
  sportOb?: {
    token: string;
    gateway?: string;
    referer?: string;
    venueMemberId?: string;
    /** 体育官网会员账号名；与同卡电竞 venueAccountName 校验一致。 */
    venueAccountName?: string;
  };
}

export interface CreateTagPlatformResult {
  playerId: number;
  playerName: string;
  platformId: number;
  platformName: string;
  venueMemberId?: string;
  provider?: string;
}

export type CreateTagPlatformIdentity =
  | string
  | {
    playerName?: string;
    venueMemberId?: string;
    provider?: string;
  };

export interface UpdateBalanceResult {
  total: number;
  platformId?: number;
  platformName?: string;
}
