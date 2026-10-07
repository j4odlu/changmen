import type { PlatformId } from "@/types/esport";
import type { LimitEntry } from "@changmen/client-core/types/limit";
/**
 * 实时赔率缓存（对齐 A8 `Qn()` / match store 内 `p=Qn()`；Pinia id `"counter"`）。
 * changmen Pinia id 为 `"odds"`。勿与 A8 `fo()`（账号 store）混淆。
 *
 * 与 ViewMatch 的分工：
 * - `Client_GetMatchs` → matchStore → ViewMatch / ViewBetItem：赛事结构、盘口 ID（betId）、选项 ID（homeId/awayId）
 * - 各平台采集器（HTTP 灌盘 + MQTT/WS 增量）→ 本 store `save()`：按 **oddId** 存最新赔率与锁盘
 *
 * 本 store **不存 matchId**；UI 只通过 ViewBetItem 持有的 id 来查赔率缓存。
 * 缓存里可能出现 ViewMatch 未引用的 oddId（多盘口、列表已下架残留、采集先于合并等）。
 */
import { defineStore } from "pinia";
import { truncateOddsTo3 } from "@changmen/shared/odds_format";
import { formatDisplayOdds } from "@changmen/client-core/shared/format";
import { PLATFORMS } from "@changmen/venue-adapter/shared";
import {
  isPmArbPriceBufferActive,
  pmEffectiveOddsFromFoEntry,
  isPmTickBufferActive,
  createPmTickBufferQuote,
} from "@changmen/venue-adapter/polymarket/pmArbPriceBufferMode";
import {
  isPfArbPriceBufferActive,
  pfEffectiveOddsFromFoEntry,
} from "@changmen/venue-adapter/predictfun/pfArbPriceBufferMode";

/** 写入赔率缓存的数据来源，便于排查 HTTP 初值 vs 推送覆盖 */
export type OddsSaveSource = "mqtt" | "http";

/**
 * 单条赔率缓存条目（key = `OddsEntry.id`，即平台侧的 **选项/odd id**，不是赛事 id）。
 *
 * 与 GetMatchs `Sources` 的对应关系（以 OB 为例）：
 * - `id`     ↔ `HomeID` / `AwayID`（下注时 itemId）
 * - `betId`  ↔ `BetID`（盘口/market id）
 */
export interface OddsEntry {
  /** 平台选项 ID（odd id / selection id），本 store 主键，全局唯一于该平台 bucket 内 */
  id: string;
  /** 原始赔率数值；锁盘时 UI 显示 0，不读 fallback */
  odds: number;
  /** [changmen 扩展] Polymarket / PredictFun CLOB best_ask（0~1）；预检限价用，其它平台不填 */
  clobPrice?: number;
  /** [changmen 扩展] Predict.fun market id */
  marketId?: string;
  /** 是否锁盘/不可下注（HTTP 灌盘公式或 MQTT 增量） */
  isLock: boolean;
  /** 所属盘口 ID（market / bet group id），用于 betIndex 按盘锁盘 */
  betId?: string;
  /** 该选项对应主/客侧（HTTP 灌盘写入；MQTT 增量时从已有条目保留） */
  side?: "home" | "away";
  /** 最后一次写入时间戳（ms）；`clean()` 无 platform 参数时按 1h 过期删条目 */
  time: number;
  /** 本条最后一次 save 的来源 */
  source?: OddsSaveSource;
}

/** 赔率相对上一条数值的涨跌方向；UI 样式见 `extensions/arbBet/ui` */
export type OddsFlashDir = "up" | "down";

/** 赔率涨跌高亮保持时长（与 arbBetUi.css 动画配合） */
const ODDS_FLASH_MS = 4_000;
/** OB MQTT `/odd/statusUpdate/`：status === 6 表示盘口开放，否则视为锁盘 */
const OB_MARKET_OPEN = 6;

/** 对齐 A8 `Qn()`（Pinia `"counter"`）— 实时赔率缓存 */
export const useOddsStore = defineStore("odds", {
  state: () => ({
    /**
     * 主表：`platform → oddId → OddsEntry`。
     * 扁平存储，不按赛事分组；读赔用 `getOdds`。
     */
    data: new Map<PlatformId, Map<string, OddsEntry>>(),

    /**
     * 盘口索引：`platform → betId → oddId[]`。
     * 用于 MQTT 盘口级锁盘推送时，批量更新该盘口下所有 oddId 的锁盘状态。
     */
    betIndex: new Map<PlatformId, Map<string, string[]>>(),

    /**
     * 调试：各平台最近一条 WS/MQTT 原始 payload 字符串（非业务主路径）。
     */
    messages: new Map<PlatformId, string>(),

    /**
     * 限红缓存：`platform → oddId → LimitEntry`。
     * 下注前 checkBet / stake 等写入；带 TTL，过期由 `cleanExpiredLimits` 清理。
     */
    limits: new Map<PlatformId, Map<string, LimitEntry>>(),

    /**
     * 涨跌闪烁：`"platform:oddId" → { dir, until, source }`。
     * `until` 为毫秒时间戳，过期后 `getFlash` 自动删除。
     */
    flash: new Map<string, { dir: OddsFlashDir; until: number; source: OddsSaveSource }>(),

    _limitsCleanedAt: 0,
    /** [changmen 扩展] 仅新模式的显示失效通知，不重写原始赔率。 */
    pmTickBufferEnabled: false,
    pmTickBufferVersion: 0,
  }),

  actions: {
    /**
     * 写入或覆盖一条赔率（对齐 A8 `Qn().save` / `p.save`）。
     * HTTP 灌盘与 MQTT 增量均直接覆盖，**不做**“旧 time 拒绝新数据”挡板。
     * 盘口 UI 靠 Pinia reactive Map 按 oddId 追踪；旁路盯盘用 `$subscribe`；
     * 订单现价由 OrderList 按挂单 token `$onAction` 局部刷新（不再全局 quoteTick）。
     */
    save(platform: PlatformId, entry: OddsEntry, source: OddsSaveSource = "http") {
      const id = String(entry.id);
      if (!this.data.has(platform))
        this.data.set(platform, new Map());
      const bucket = this.data.get(platform)!;
      const prev = bucket.get(id);
      const nextOdds = entry.odds;

      if (
        prev
        && !entry.isLock
        && !prev.isLock
        && prev.odds > 0
        && nextOdds > 0
        && prev.odds !== nextOdds
      ) {
        this.flash.set(`${platform}:${id}`, {
          dir: nextOdds > prev.odds ? "up" : "down",
          until: Date.now() + ODDS_FLASH_MS,
          source,
        });
      }
      const next: OddsEntry = { ...entry, id, source };
      if (next.marketId != null)
        next.marketId = String(next.marketId).trim() || undefined;
      // PredictFun：增量/writeVenueOdds 若漏传 marketId，保留已有值，避免 checkBet 丢 fo 缓存
      if (!next.marketId && prev?.marketId)
        next.marketId = prev.marketId;
      bucket.set(id, next);

      if (entry.betId) {
        const betId = String(entry.betId);
        if (!this.betIndex.has(platform))
          this.betIndex.set(platform, new Map());
        const idx = this.betIndex.get(platform)!;
        const list = idx.get(betId) ?? [];
        if (!list.includes(id)) {
          list.push(id);
          idx.set(betId, list);
        }
      }
    },

    /** 取某 oddId 的涨跌方向及来源；已过期则返回 undefined 并删 flash 条目 */
    getFlash(platform: PlatformId, oddsId: string): { dir: OddsFlashDir; source: OddsSaveSource } | undefined {
      const key = `${platform}:${String(oddsId)}`;
      const row = this.flash.get(key);
      if (!row)
        return undefined;
      if (row.until < Date.now()) {
        this.flash.delete(key);
        return undefined;
      }
      return { dir: row.dir, source: row.source };
    },

    /** 赔率缓存中是否已有该 oddId（MQTT 增量门闩：未灌盘过的 id 通常不处理推送） */
    isOdds(platform: PlatformId, oddsId: string): boolean {
      return Boolean(this.data.get(platform)?.has(String(oddsId)));
    },

    /** 原始条目；未命中返回 undefined（不格式化、不处理锁盘显示逻辑） */
    getEntry(platform: PlatformId, oddsId: string): OddsEntry | undefined {
      return this.data.get(platform)?.get(String(oddsId));
    },

    /**
     * 按 oddId 取展示赔率（对齐 A8 `Qn().getOdds` / `p.getOdds`）。
     * - 无缓存：返回 fallback（经平台格式化）
     * - 有缓存且 isLock：返回 0（**不用** fallback 顶替锁盘）
     * - 有缓存且未锁：返回格式化后的 row.odds
     * - Polymarket / PredictFun：truncateOddsTo3（1/price 截断）；其它馆 formatDisplayOdds（四舍五入）
     * - [changmen 扩展] 仅 PM/PF + 有 fo + 各自开关开：读打折档；**写入仍是真价**。无 fo 不打折
     */
    getOdds(platform: PlatformId, oddsId: string, fallback = 0): number {
      const row = this.data.get(platform)?.get(String(oddsId));
      if (platform === PLATFORMS.Polymarket && (this.pmTickBufferEnabled || isPmTickBufferActive())) {
        void this.pmTickBufferVersion;
        return row && !row.isLock ? createPmTickBufferQuote(String(oddsId), Number(row.clobPrice))?.displayOdds ?? 0 : 0;
      }
      const useTrunc = platform === PLATFORMS.Polymarket || platform === PLATFORMS.PredictFun;
      if (row === undefined)
        return useTrunc ? truncateOddsTo3(fallback) : formatDisplayOdds(fallback);
      if (row.isLock)
        return 0;
      if (platform === PLATFORMS.Polymarket && isPmArbPriceBufferActive())
        return pmEffectiveOddsFromFoEntry(row);
      if (platform === PLATFORMS.PredictFun && isPfArbPriceBufferActive())
        return pfEffectiveOddsFromFoEntry(row);
      return useTrunc ? truncateOddsTo3(row.odds) : formatDisplayOdds(row.odds);
    },

    /** 更新单条 odd 锁盘（对齐 A8 `updateOddsLock`：仅改已有行） */
    updateOddsLock(platform: PlatformId, oddsId: string, locked: boolean) {
      const key = String(oddsId);
      const row = this.data.get(platform)?.get(key);
      if (row && row.isLock !== locked) {
        row.isLock = locked;
      }
    },

    /** 更新整盘锁盘（对齐 A8 `updateBetLock`：betIndex 下所有 odd） */
    updateBetLock(platform: PlatformId, betId: string, locked: boolean) {
      const key = String(betId);

      const indexed = this.betIndex.get(platform)?.get(key);
      if (indexed?.length) {
        for (const id of indexed) this.updateOddsLock(platform, id, locked);
        return;
      }
      const bucket = this.data.get(platform);
      if (!bucket)
        return;
      for (const [id, row] of bucket.entries()) {
        if (row.betId === key)
          this.updateOddsLock(platform, id, locked);
      }
    },

    /**
     * OB `/odd/*` MQTT 锁盘解析（**当前未接线**：A8 UMe 亦只处理 market 三 topic）。
     * 保留供将来对齐 odd 级推送；盘级锁盘走 `updateBetLock`（market/statusUpdate|suspended）。
     */
    applyObOddLock(
      platform: PlatformId,
      row: { id?: unknown; status?: unknown; visible?: unknown; suspended?: unknown },
      topic: string,
    ) {
      const oddsId = String(row.id ?? "");
      if (!oddsId)
        return;
      let locked = false;
      if (topic === "/odd/suspended/") {
        locked = Number(row.suspended) === 1;
      }
      else if (topic === "/odd/visible/") {
        locked = Number(row.visible) !== 1;
      }
      else if (topic === "/odd/statusUpdate/") {
        if (row.status !== undefined)
          locked = Number(row.status) !== OB_MARKET_OPEN;
      }
      this.updateOddsLock(platform, oddsId, locked);
    },

    /** 记录平台最近 WS/MQTT 消息（调试） */
    updateMessage(platform: PlatformId, payload: string) {
      this.messages.set(platform, payload);
    },

    /**
     * 清理赔率缓存条目（对齐 A8 `p.clean()`，主循环拉列表成功时调用）。
     * - 传入 platform：清空该平台 data / betIndex（采集轮次切换时用）
     * - 不传：全局扫描，删除 time 超过 1 小时的 stale odd（不碰 betIndex 孤儿索引，靠 save 重建）
     */
    clean(platform?: PlatformId) {
      if (platform) {
        this.data.set(platform, new Map());
        this.betIndex.set(platform, new Map());
        return;
      }
      const cutoff = Date.now() - 3_600_000;
      for (const bucket of this.data.values()) {
        for (const [id, row] of [...bucket.entries()]) {
          if (row.time < cutoff) {
            bucket.delete(id);
          }
        }
      }
    },

    maybeCleanExpiredLimits(platform?: PlatformId) {
      const now = Date.now();
      if (now - this._limitsCleanedAt < 1000)
        return;
      this._limitsCleanedAt = now;
      this.cleanExpiredLimits(platform);
    },

    /** 给定 oddId 列表中是否任一条存在未过期的限红 */
    hasLimit(platform: PlatformId, ids: string[]): boolean {
      this.maybeCleanExpiredLimits(platform);
      const bucket = this.limits.get(platform);
      if (!bucket)
        return false;
      const now = Date.now();
      return ids.some((id) => {
        const row = bucket.get(id);
        return Boolean(row && (!row.expireTime || row.expireTime >= now));
      });
    },

    /** 取单条限红；过期返回 undefined */
    getLimit(platform: PlatformId, oddsId: string): LimitEntry | undefined {
      const row = this.limits.get(platform)?.get(oddsId);
      if (!row)
        return undefined;
      if (row.expireTime && row.expireTime < Date.now())
        return undefined;
      return row;
    },

    /**
     * 写入限红（对齐 A8 `QIe`）。
     * @param value 限红金额
     * @param payout 可选派彩上限
     * @param ttlSec 可选 TTL（秒），到期后 getLimit 视为无
     */
    setLimit(
      platform: PlatformId,
      oddsId: string,
      value: number,
      payout?: number,
      ttlSec?: number,
    ) {
      if (!this.limits.has(platform))
        this.limits.set(platform, new Map());
      const expireTime = ttlSec ? Date.now() + ttlSec * 1000 : undefined;
      const entry: LimitEntry = { value, expireTime };
      if (payout)
        entry.payout = payout;
      this.limits.get(platform)!.set(oddsId, entry);
    },

    /** 删除单条限红 */
    deleteLimit(platform: PlatformId, oddsId: string) {
      this.limits.get(platform)?.delete(oddsId);
    },

    /** 删除已过期的 limits 条目；可只清某平台 */
    cleanExpiredLimits(platform?: PlatformId) {
      const now = Date.now();
      const buckets = platform
        ? [[platform, this.limits.get(platform)] as const]
        : [...this.limits.entries()];
      for (const [, bucket] of buckets) {
        if (!bucket)
          continue;
        for (const [id, row] of [...bucket.entries()]) {
          if (row.expireTime && row.expireTime < now)
            bucket.delete(id);
        }
      }
    },
  },
});
