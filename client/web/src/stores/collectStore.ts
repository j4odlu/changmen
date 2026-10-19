import type { CollectBetDto, CollectConfigDto, CollectMatchDto } from "@changmen/client-core/types/collect";
import type { PlatformId } from "@/types/esport";
import { isVpsOwnedPlatformCollect } from "@changmen/venue-adapter/registry";
import { defineStore } from "pinia";
import { getClientData, saveBetSource, saveClientData, saveMatchSource, saveUserLog } from "@/api/esport";
import { ALL_PLATFORMS } from "@/types/userConfig";

const CONFIG_KEY = "CollectConfig";

/**
 * 对齐 A8 Pinia `Tf`：`collect` 开关只控制是否调用后端 SaveMatch/SaveBets（数据回传），
 * 不控制前端是否向场馆拉数或写入 oddsStore。各采集器应常驻运行，经本 store 上报时才检查开关。
 */
export const useCollectStore = defineStore("collect", {
  state: () => ({
    log: false,
    collect: new Map<PlatformId, boolean>(),
    ready: false,
  }),

  getters: {
    isEnabled: s => (platform: PlatformId) => Boolean(s.collect.get(platform)),
  },

  actions: {
    async init() {
      const raw = await getClientData<CollectConfigDto>(CONFIG_KEY);
      const merged = new Map<PlatformId, boolean>();
      for (const id of ALL_PLATFORMS) {
        merged.set(id, false);
      }
      if (raw?.collect) {
        for (const [id, on] of raw.collect as [PlatformId, boolean][]) {
          merged.set(id, Boolean(on));
        }
      }
      // 无 collect 字段：与 A8 空 Map 一致，全平台 false（不本地默认开 OB/RAY）
      this.collect = merged;
      this.log = Boolean(raw?.log);
      this.ready = true;
    },

    async saveConfig(patch: Partial<{ log: boolean; collect: Map<PlatformId, boolean> }>) {
      if (patch.log !== undefined)
        this.log = patch.log;
      if (patch.collect)
        this.collect = patch.collect;
      const payload: CollectConfigDto = {
        log: this.log,
        collect: [...this.collect.entries()],
      };
      await saveClientData(CONFIG_KEY, JSON.stringify(payload));
    },

    async saveMatch(platform: PlatformId, matchs: CollectMatchDto[]): Promise<boolean> {
      if (isVpsOwnedPlatformCollect(platform))
        return false;
      if (!this.collect.get(platform))
        return false;
      // [A8 可证实] Pinia Af.saveMatch：仅 collect 开关门控，空数组仍 POST API_SaveMatch
      const ok = await saveMatchSource(platform, matchs);
      void this.logCollect(
        `${platform}赛事采集${matchs.length}场 => ${ok}`,
        matchs.map(m => ({ matchId: m.SourceMatchID, game: m.SourceGameID, startTime: m.StartTime, title: `${m.Home} VS ${m.Away}` })),
      );
      return ok;
    },

    async saveBets(
      platform: PlatformId,
      matchId: string | number,
      bets: CollectBetDto[],
      matchResult?: Record<string, unknown>,
    ): Promise<boolean> {
      if (isVpsOwnedPlatformCollect(platform))
        return false;
      if (!this.collect.get(platform))
        return false;
      const ok = matchResult === undefined
        ? await saveBetSource(platform, matchId, bets)
        : await saveBetSource(platform, matchId, bets, matchResult);
      void this.logCollect(
        `${platform}盘口采集${matchId}/${bets.length} => ${ok}`,
        bets.map(b => ({ matchId: b.SourceMatchID, betId: b.SourceBetID, betName: b.BetName, team: `${b.HomeName} vs ${b.AwayName}` })),
      );
      return ok;
    },

    async logCollect(title: string, rows: unknown[]) {
      if (!this.log)
        return;
      await saveUserLog(title, rows).catch(() => {});
    },
  },
});
