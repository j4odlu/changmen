import type { BetOption } from "@changmen/client-core/models/betOption";
import type { BetResult } from "@changmen/client-core/models/betResult";
import type { PlatformAccount } from "@changmen/client-core/models/platformAccount";
import type { ViewMatch } from "@changmen/client-core/models/match";
import type { CollectBetDto, CollectMatchDto } from "@changmen/client-core/types/collect";
import type { PlatformId } from "@changmen/api-contract";
import type { UserConfig } from "@changmen/client-core/types/userConfig";

export interface CollectStoreBridge {
  collect: Map<PlatformId, boolean>;
  log: boolean;
  ready: boolean;
  isEnabled(platform: PlatformId): boolean;
  saveMatch(platform: PlatformId, matchs: CollectMatchDto[]): Promise<boolean>;
  saveBets(
    platform: PlatformId,
    matchId: string | number,
    bets: CollectBetDto[],
    matchResult?: Record<string, unknown>,
  ): Promise<boolean>;
  logCollect(title: string, rows: unknown[]): Promise<void>;
}

export interface MatchStoreBridge {
  matchs: ViewMatch[];
  refreshOddsOnBets(): void;
}

export interface MessageStoreBridge {
  collectMessage(platform: string, detail: string): void;
  limitMessage(
    account: PlatformAccount,
    payload: {
      match?: string;
      bet?: string;
      betMoney?: number;
      odds?: number;
      limit?: number;
    },
  ): string;
}

export interface AccountStoreBridge {
  accounts: PlatformAccount[];
  refreshBalance(account: PlatformAccount): void;
  getAccount(
    provider: PlatformId,
    betMoney: number,
    excludeAccountIds?: number[],
    filter?: (acc: PlatformAccount) => boolean,
    options?: BetOption[],
  ): PlatformAccount | undefined;
  checkBetting(account: PlatformAccount | undefined, option: BetOption): Promise<BetOption>;
  betting(
    account: PlatformAccount | undefined,
    option: BetOption,
    toastSeconds?: number,
  ): Promise<BetResult>;
}

/** [changmen 扩展] venue-adapter 可读的用户扩展偏好子集 */
export type ExtensionPrefsBridge = Record<string, unknown>;

export interface UserStoreBridge {
  userId: number;
  userName: string;
  isLoggedIn: boolean;
  config: UserConfig;
  extensionPrefs: ExtensionPrefsBridge;
  fetchUserInfo(): Promise<void>;
}

export interface VenueWebBridge {
  useCollectStore: () => CollectStoreBridge;
  useMatchStore: () => MatchStoreBridge;
  useMessageStore: () => MessageStoreBridge;
  useAccountStore: () => AccountStoreBridge;
  useUserStore: () => UserStoreBridge;
}
