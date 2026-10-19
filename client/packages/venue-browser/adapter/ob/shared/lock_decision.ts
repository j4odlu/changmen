/**
 * OB 锁盘判定 — 对照 A8 / changmen / 官网 HTTP 语义（观察与单测用，非运行时唯一真源）。
 *
 * HTTP 灌盘真源：`obBlockLocked`（本文件 `httpBlockLocked` 直接复用）。
 * 官网 MQTT 全量回放见 `devtools/platform-probes/ob/core.js`（可选探针，日常可不装）。
 */

import {
  MARKET_STATUS_OPEN,
  MARKET_VISIBLE_SHOW,
  MARKET_SUSPENDED_OFF,
  obBlockLocked,
} from "./market_lock";

export const PROFILES = Object.freeze({
  OFFICIAL: "official",
  A8: "a8",
  CHANGMEN: "changmen",
});

export type LockProfile = (typeof PROFILES)[keyof typeof PROFILES];

export {
  MARKET_STATUS_OPEN,
  MARKET_VISIBLE_SHOW,
  MARKET_SUSPENDED_OFF,
  obBlockLocked,
} from "./market_lock";

export type HttpBlockFields = {
  status?: unknown;
  visible?: unknown;
  suspended?: unknown;
  settle_count?: unknown;
  settleCount?: unknown;
  suspended_type?: unknown;
  suspendedType?: unknown;
  id?: unknown;
  market_id?: unknown;
  cn_name?: unknown;
  name?: unknown;
  round?: unknown;
};

export type CompareHttpOpts = {
  /** @deprecated A8 parity：fo 与展示不再使用 pending / sourceStatus 挡板 */
  pendingBetLocks?: Record<string, boolean>;
  /** @deprecated 见 pendingBetLocks */
  sourceStatus?: string;
};

/** HTTP game/view block — 与 `obBlockLocked` 一致 */
export function httpBlockLocked(block: HttpBlockFields): boolean {
  return obBlockLocked(block as Record<string, unknown>);
}

export function explainHttpBlock(block: HttpBlockFields = {}) {
  const status = Number(block.status ?? 0);
  const visible = Number(block.visible ?? 0);
  const suspended = Number(block.suspended ?? 0);
  const settleCount = Number(block.settle_count ?? block.settleCount ?? 0);
  const locked = httpBlockLocked(block);
  const reasons: string[] = [];

  if (status !== MARKET_STATUS_OPEN) {
    if (status === 9 || status === 12 || settleCount > 0) {
      reasons.push(`status=${status}（盘已结算，settle_count=${settleCount}）`);
    } else if (status === 7) {
      reasons.push("status=7（滚球/停投，常见于滚球盘）");
    } else {
      reasons.push(`status=${status}（非开盘值 ${MARKET_STATUS_OPEN}）`);
    }
  }
  if (visible !== MARKET_VISIBLE_SHOW) reasons.push(`visible=${visible}（不展示）`);
  if (suspended !== MARKET_SUSPENDED_OFF) {
    const st = block.suspended_type ?? block.suspendedType;
    reasons.push(
      st != null && st !== 0
        ? `suspended=${suspended}（暂停，suspended_type=${st}）`
        : `suspended=${suspended}（暂停）`,
    );
  }

  let code = "open";
  let label = "可买入";
  if (locked) {
    if (status === 9 || status === 12 || settleCount > 0) {
      code = "settled";
      label = "已结算";
    } else if (suspended !== MARKET_SUSPENDED_OFF) {
      code = "suspended";
      label = "暂停";
    } else if (visible !== MARKET_VISIBLE_SHOW) {
      code = "hidden";
      label = "不可见";
    } else {
      code = "locked";
      label = "锁盘";
    }
  }

  return { locked, code, label, reasons };
}

/** A8 UMe：market.statusUpdate 一律锁；market.suspended 按 suspended===1 */
export function a8MqttLockFromPayload(
  topicType: string,
  item: Record<string, unknown> = {},
): { locked: boolean | null; reason: string } {
  if (topicType === "market.statusUpdate") {
    return { locked: true, reason: "A8: statusUpdate 一律 updateBetLock(true)" };
  }
  if (topicType === "market.suspended") {
    const locked = Number(item.suspended) === 1;
    return { locked, reason: `A8: suspended===1 → lock=${locked}` };
  }
  if (topicType === "market.oddsUpdate") {
    return { locked: null, reason: "A8: oddsUpdate 只改价并 isLock=false（单条 odd）" };
  }
  return { locked: null, reason: `A8: 未处理 topic ${topicType}` };
}

export function changmenMqttLockFromPayload(
  topicType: string,
  item: Record<string, unknown> = {},
) {
  return a8MqttLockFromPayload(topicType, item);
}

/** [A8 可证实] fo.save：HTTP 灌盘直接覆盖 isLock，无 pending 合并 */
export function changmenHttpSaveIsLock(httpLocked: boolean, _pendingBetLocked?: boolean) {
  return httpLocked;
}

/** [A8 可证实] FQ 展示只信 fo.isLock */
export function changmenDisplayLocked(opts: { sourceStatus?: string; foLocked: boolean }) {
  if (opts.foLocked) {
    return { locked: true, layer: "fo" as const, reason: "fo.isLock" };
  }
  return { locked: false, layer: "open" as const, reason: "可展示赔率" };
}

export function compareHttpBlock(block: HttpBlockFields = {}, opts: CompareHttpOpts = {}) {
  const http = explainHttpBlock(block);
  const marketId = String(block.id ?? block.market_id ?? "");
  const pendingBet = opts.pendingBetLocks?.[marketId] === true;
  const foLocked = changmenHttpSaveIsLock(http.locked, pendingBet);
  const display = changmenDisplayLocked({
    sourceStatus: opts.sourceStatus ?? "Normal",
    foLocked,
  });

  return {
    marketId,
    name: String(block.cn_name ?? block.name ?? ""),
    round: block.round,
    status: Number(block.status),
    visible: Number(block.visible),
    suspended: Number(block.suspended),
    settleCount: Number(block.settle_count ?? block.settleCount ?? 0),
    http: {
      official: http.locked,
      a8: http.locked,
      changmenFoAfterHttp: foLocked,
      reasons: http.reasons,
      label: http.label,
      code: http.code,
    },
    changmenDisplay: display,
    pendingBetLocked: pendingBet,
    sourceStatus: opts.sourceStatus ?? "Normal",
    allHttpSame: true,
    changmenDiffersFromOfficial: display.locked !== http.locked || foLocked !== http.locked,
  };
}

export type NormalizedMarketLike = {
  marketId?: string;
  marketName?: string;
  round?: unknown;
  status?: unknown;
  visible?: unknown;
  suspended?: unknown;
  settleCount?: unknown;
};

export function compareNormalizedMarket(mk: NormalizedMarketLike = {}, opts: CompareHttpOpts = {}) {
  return compareHttpBlock(
    {
      id: mk.marketId,
      cn_name: mk.marketName,
      round: mk.round,
      status: mk.status,
      visible: mk.visible,
      suspended: mk.suspended,
      settle_count: mk.settleCount,
    },
    opts,
  );
}

export function summarizeMarkets(markets: NormalizedMarketLike[] = [], opts: CompareHttpOpts = {}) {
  const rows = markets.map((mk) => compareNormalizedMarket(mk, opts));
  const locked = rows.filter((r) => r.http.official);
  const changmenExtra = rows.filter((r) => r.changmenDiffersFromOfficial);
  return {
    total: rows.length,
    lockedOfficial: locked.length,
    openOfficial: rows.length - locked.length,
    changmenDisplayDiffCount: changmenExtra.length,
    rows,
    changmenExtra,
  };
}

/** 从 game/view 原始 JSON 提取可对照的 block 列表 */
export function blocksFromGameViewJson(json: { data?: unknown } | unknown[]): HttpBlockFields[] {
  const data = Array.isArray(json) ? json : (json as { data?: unknown }).data;
  if (!Array.isArray(data)) return [];
  return data.map((market) => ({
    id: (market as Record<string, unknown>).id,
    cn_name: (market as Record<string, unknown>).cn_name,
    round: (market as Record<string, unknown>).round,
    status: (market as Record<string, unknown>).status,
    visible: (market as Record<string, unknown>).visible,
    suspended: (market as Record<string, unknown>).suspended,
    settle_count: (market as Record<string, unknown>).settle_count,
  }));
}

export function summarizeGameViewJson(
  json: { data?: unknown } | unknown[],
  opts: CompareHttpOpts = {},
) {
  const blocks = blocksFromGameViewJson(json);
  const rows = blocks.map((b) => compareHttpBlock(b, opts));
  const locked = rows.filter((r) => r.http.official);
  const changmenExtra = rows.filter((r) => r.changmenDiffersFromOfficial);
  return {
    total: rows.length,
    lockedOfficial: locked.length,
    openOfficial: rows.length - locked.length,
    changmenDisplayDiffCount: changmenExtra.length,
    rows,
    changmenExtra,
  };
}
