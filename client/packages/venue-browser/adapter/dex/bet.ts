import type { PlatformProvider, AccountBalanceResult, VenueOrder } from "../contract";
import type { BetOption } from "@changmen/client-core/models/betOption";
import { BetResult } from "@changmen/client-core/models/betResult";
import type { PlatformAccount } from "@changmen/client-core/models/platformAccount";
import {
  getDexTabId,
  dexPluginGet,
  dexPluginPost,
} from "./pluginApi";
import { DEX_SPORTSBOOK_API, DEX_SPORTSBOOK_BASE } from "./parse";

async function resolveTabId(): Promise<number> {
  const tabId = await getDexTabId();
  if (!tabId) throw new Error("DexSport 标签页未打开");
  return tabId;
}

export const dexProvider: PlatformProvider = {
  async getBalance(account: PlatformAccount): Promise<AccountBalanceResult | undefined> {
    try {
      const tabId = await resolveTabId();
      const token = account.token || "";
      const currency = String(account.currency || "");
      const data = await dexPluginGet<Record<string, unknown>>(
        tabId,
        `${DEX_SPORTSBOOK_BASE}/public/api/profile-balance?token=${encodeURIComponent(token)}&apiKey=DexSport&currency=${encodeURIComponent(currency)}`,
      );
      const balance = Number(data?.balance ?? data?.amount ?? 0);
      const cur = String(data?.currency ?? account.currency ?? "USDT");
      return { balance, currency: cur };
    } catch {
      return undefined;
    }
  },

  async getOrders(_account: PlatformAccount): Promise<VenueOrder[]> {
    return [];
  },

  async checkBet(_account: PlatformAccount, option: BetOption): Promise<BetOption> {
    try {
      const tabId = await resolveTabId();
      const data = await dexPluginGet<Record<string, unknown>>(
        tabId,
        `${DEX_SPORTSBOOK_API}/events/${option.matchId}/markets?locale=zh`,
      );
      const markets = Array.isArray(data) ? data : (data as Record<string, unknown>)?.markets;
      if (!Array.isArray(markets)) return option;

      for (const mkt of markets) {
        const raw = mkt as Record<string, unknown>;
        if (String(raw.id) !== option.betId) continue;
        const outcomes = (raw.outcomes ?? []) as Array<Record<string, unknown>>;
        for (const o of outcomes) {
          if (String(o.id) === option.data?.outcomeId) {
            const newOdds = Number(o.odds ?? 0);
            if (newOdds > 0) option.odds = newOdds;
          }
        }
      }
    } catch {
      // check 失败保持原赔率
    }
    return option;
  },

  async betting(account: PlatformAccount, option: BetOption): Promise<BetResult> {
    try {
      const tabId = await resolveTabId();
      const body = {
        amount: option.betMoney,
        currency: String(account.currency || "usdt").toLowerCase(),
        outcomeId: option.data?.outcomeId,
        odds: option.odds,
      };
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${account.token || ""}`,
      };
      const data = await dexPluginPost<Record<string, unknown>>(
        tabId,
        `${DEX_SPORTSBOOK_API}/placebet/ordinary`,
        body,
        headers,
      );

      const statusId = Number(data?.statusId ?? data?.status ?? -1);
      if (statusId === 1 || statusId === 0) {
        return new BetResult(account.provider, true, "下注成功", option.data, data);
      }
      const msg = String(data?.message ?? data?.error ?? `下注失败 (status: ${statusId})`);
      return new BetResult(account.provider, false, msg, option.data, data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return new BetResult(account.provider, false, msg, option.data);
    }
  },
};
