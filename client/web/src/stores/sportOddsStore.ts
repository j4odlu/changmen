import type { PlatformId } from "@/types/esport";
import { defineStore } from "pinia";
import { createRafTicker } from "@/runtime/rafTick";

const scheduleTick = createRafTicker();

/**
 * [changmen 扩展] 体育板实时赔率缓存。
 * 禁止与电竞 oddsStore(fo) 互通：不调用 saveVenueOdds / oddsStore.save。
 */
export const useSportOddsStore = defineStore("sportOdds", {
  state: () => ({
    /** platform → subscribeId（PM asset / PF marketId）→ 欧赔 */
    byVenue: {} as Record<string, Record<string, number>>,
    receivedAt: {} as Record<string, Record<string, number>>,
    /** 触发 BetRow 重算（fallback 同值时仍可 bump） */
    tick: 0,
  }),
  actions: {
    save(platform: PlatformId | string, subscribeId: string, decimalOdds: number) {
      this.saveMany(platform, [{ id: subscribeId, odds: decimalOdds }]);
    },
    saveMany(platform: PlatformId | string, rows: Array<{ id: string; odds: number }>) {
      const p = String(platform);
      if (!p || !rows.length)
        return;
      if (!this.byVenue[p])
        this.byVenue[p] = {};
      const bag = this.byVenue[p];
      const times = this.receivedAt[p] ||= {};
      let changed = false;
      for (const row of rows) {
        const id = String(row.id || "").trim();
        if (!id || !Number.isFinite(row.odds) || row.odds < 0)
          continue;
        times[id] = Date.now();
        if (bag[id] === row.odds)
          continue;
        bag[id] = row.odds;
        changed = true;
      }
      if (changed)
        scheduleTick(() => { this.tick += 1; });
    },
    has(platform: PlatformId | string, subscribeId: string): boolean {
      const row = this.byVenue[String(platform)];
      if (!row)
        return false;
      return row[String(subscribeId)] !== undefined;
    },
    hasFresh(platform: string, subscribeId: string, maxAgeMs = 5_000): boolean {
      const at = this.receivedAt[platform]?.[subscribeId];
      return at != null && Date.now() - at <= maxAgeMs && this.has(platform, subscribeId);
    },
    get(platform: PlatformId | string, subscribeId: string): number {
      const row = this.byVenue[String(platform)];
      if (!row)
        return 0;
      return Number(row[String(subscribeId)]) || 0;
    },
    clear() {
      this.byVenue = {};
      this.receivedAt = {};
      scheduleTick(() => { this.tick += 1; });
    },
    clearVenue(platform: string) {
      delete this.byVenue[platform];
      delete this.receivedAt[platform];
      scheduleTick(() => { this.tick += 1; });
    },
  },
});
