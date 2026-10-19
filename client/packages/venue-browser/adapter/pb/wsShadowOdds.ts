/**
 * [changmen 扩展] PB 影子旁显：镜像官网观测板；主价 / fo **坚决不动**。
 *
 * 官网源（主路径，UI 只显示 M）：
 * - sports-websocket UPDATE_ODDS（与 updateOdds 同门控：truthy oddFm 才写；空不擦 → 板卡仍带旧字）
 * - 官网同源 euro/odds moneyLine（HTTP 全量：按 event 对齐 period 卡）
 *
 * 影子表两层（get 时板优先，**不写 fo**）：
 * - byOddId：观测板镜像（非空板只重建这一层）
 * - fromCollect：采集 euro/odds 打底（板上没有的 period/event）
 * 同 rotNum 且该 period 板上只有一个 event 时，把价拷到采集登记过的 sibling HomeID。
 * 两 event 同 period 不拷。不做 fo 种子。
 */
import { selectionId, type PbParsedMatch } from "./parse";

export type PbWsShadowSource = "H" | "M";

export type PbWsShadowEntry = {
  odds: number;
  /** 官网原始展示串（优先原样旁显，避免 toFixed 扭曲） */
  text?: string;
  isLock: boolean;
  time: number;
  /** M=官网源；H 仅兼容旧数据，UI 不展示 H */
  source: PbWsShadowSource;
};

type ShadowState = {
  /** 观测板（SPA euro / WS）；get 时优先 */
  byOddId: Map<string, PbWsShadowEntry>;
  /** 采集 euro/odds 打底（官网 HTTP，不写 fo）；板没有的 period/event 用这个 */
  fromCollect: Map<string, PbWsShadowEntry>;
  collectKeysByMatch: Map<string, Set<string>>;
  /** rotNum → eventId；采集 + 板卡登记。仅用于影子别名，不写 fo */
  rotToEvents: Map<string, Set<string>>;
  /** eventId → rotNum；板上 rot 为空时用采集登记补 */
  eventToRot: Map<string, string>;
  listeners: Set<() => void>;
  revision: number;
};

const STATE_KEY = "__CM_PB_WS_SHADOW_STATE__";

function state(): ShadowState {
  const g = globalThis as typeof globalThis & { [STATE_KEY]?: ShadowState };
  if (!g[STATE_KEY]) {
    g[STATE_KEY] = {
      byOddId: new Map(),
      fromCollect: new Map(),
      collectKeysByMatch: new Map(),
      rotToEvents: new Map(),
      eventToRot: new Map(),
      listeners: new Set(),
      revision: 0,
    };
  }
  else {
    if (!g[STATE_KEY].fromCollect)
      g[STATE_KEY].fromCollect = new Map();
    if (!g[STATE_KEY].collectKeysByMatch)
      g[STATE_KEY].collectKeysByMatch = new Map();
    if (!g[STATE_KEY].rotToEvents)
      g[STATE_KEY].rotToEvents = new Map();
    if (!g[STATE_KEY].eventToRot)
      g[STATE_KEY].eventToRot = new Map();
  }
  return g[STATE_KEY]!;
}

function notify(): void {
  const s = state();
  s.revision += 1;
  for (const listener of s.listeners) listener();
}

function sameEntry(a: PbWsShadowEntry, b: PbWsShadowEntry): boolean {
  return (
    a.odds === b.odds
    && a.isLock === b.isLock
    && a.source === b.source
    && (a.text || "") === (b.text || "")
  );
}

export function getPbWsShadowRevision(): number {
  return state().revision;
}

export function subscribePbWsShadow(listener: () => void): () => void {
  const s = state();
  s.listeners.add(listener);
  return () => s.listeners.delete(listener);
}

export function getPbWsShadow(oddId: string): PbWsShadowEntry | undefined {
  const s = state();
  const id = String(oddId);
  return s.byOddId.get(id) || s.fromCollect.get(id);
}

export function parsePbSelectionId(
  oddId: string,
): { eventId: string; map: number; side: "HOME" | "AWAY" } | null {
  const parts = String(oddId || "").split("|");
  if (parts.length < 4) return null;
  const map = Number(parts[1]);
  const homeBit = Number(parts[3]);
  if (!Number.isFinite(map) || (homeBit !== 0 && homeBit !== 1)) return null;
  return {
    eventId: parts[0]!,
    map,
    side: homeBit === 0 ? "HOME" : "AWAY",
  };
}

export type PbWsShadowResolveHit = {
  oddId: string;
  wantMap: number | null;
  oddIdMap: number | null;
  side: "HOME" | "AWAY" | null;
  skippedOddIdPeriodMismatch: boolean;
  odds?: number;
  isLock?: boolean;
  source?: PbWsShadowSource;
  via: "none" | "oddId" | "matchId";
  key?: string;
};

function noteResolveHit(hit: PbWsShadowResolveHit): void {
  try {
    const g = globalThis as {
      __CM_PB_SHADOW_LAST_RESOLVE__?: PbWsShadowResolveHit;
      __CM_PB_SHADOW_RESOLVE_LOG__?: PbWsShadowResolveHit[];
    };
    g.__CM_PB_SHADOW_LAST_RESOLVE__ = hit;
    const log = g.__CM_PB_SHADOW_RESOLVE_LOG__ || (g.__CM_PB_SHADOW_RESOLVE_LOG__ = []);
    log.push(hit);
    while (log.length > 40) log.shift();
  } catch {
    /* ignore */
  }
}

/**
 * S1：先认 oddId（HomeID/AwayID）。
 * 未命中时：同 period+side 用 Matchs.PB（item.matchId）回退；period 不一致仍空。
 */
export function resolvePbWsShadow(opts: {
  oddId: string;
  /** @deprecated S1 起忽略；勿用 Matchs.PB 回退 */
  matchId?: string;
  map?: number;
}): PbWsShadowEntry | undefined {
  const parsed = parsePbSelectionId(opts.oddId);
  const side = parsed?.side ?? null;
  const wantMap = opts.map ?? parsed?.map ?? null;
  const hit: PbWsShadowResolveHit = {
    oddId: String(opts.oddId || ""),
    wantMap,
    oddIdMap: parsed?.map ?? null,
    side,
    skippedOddIdPeriodMismatch: false,
    via: "none",
  };

  if (!parsed || !side) {
    noteResolveHit(hit);
    return undefined;
  }

  if (wantMap != null && parsed.map !== Number(wantMap)) {
    hit.skippedOddIdPeriodMismatch = true;
    noteResolveHit(hit);
    return undefined;
  }

  const entry = getPbWsShadow(opts.oddId);
  if (entry) {
    hit.via = "oddId";
    hit.key = String(opts.oddId);
    hit.odds = entry.odds;
    hit.isLock = entry.isLock;
    hit.source = entry.source;
    noteResolveHit(hit);
    return entry;
  }

  // Matchs.PB 主 event 在板上、Sources.HomeID 是 sibling 时：同 period+side 才回退
  const mid = String(opts.matchId ?? "").trim();
  if (mid && /^\d+$/.test(mid) && Number(mid) > 0 && mid !== parsed.eventId) {
    const alt = selectionId(mid, parsed.map, side);
    const viaMatch = getPbWsShadow(alt);
    if (viaMatch) {
      hit.via = "matchId";
      hit.key = alt;
      hit.odds = viaMatch.odds;
      hit.isLock = viaMatch.isLock;
      hit.source = viaMatch.source;
      noteResolveHit(hit);
      return viaMatch;
    }
  }

  noteResolveHit(hit);
  return undefined;
}

export function savePbWsShadow(
  oddId: string,
  entry: { odds: number; isLock: boolean; time?: number; source?: PbWsShadowSource; text?: string },
): void {
  const s = state();
  const id = String(oddId);
  const prev = s.byOddId.get(id);
  const next: PbWsShadowEntry = {
    odds: entry.odds,
    text: entry.text,
    isLock: entry.isLock,
    time: entry.time ?? Date.now(),
    source: entry.source ?? "M",
  };
  if (prev && sameEntry(prev, next)) return;
  s.byOddId.set(id, next);
  notify();
}

/**
 * @deprecated 勿再用 changmen fo 灌影子；保留空操作以免旧调用方炸。
 * 影子只认官网板（WS / 官网 euro/odds）。
 */
export function seedPbWsShadowFromHttp(_oddId: string, _odds: number): void {
  /* no-op：禁止 fo 冒充官网价 */
}

export function clearPbWsShadow(): void {
  const s = state();
  if (!s.byOddId.size && !s.fromCollect.size)
    return;
  s.byOddId.clear();
  s.fromCollect.clear();
  s.collectKeysByMatch.clear();
  notify();
}

export function listPbWsShadowIds(): string[] {
  const s = state();
  return [...new Set([...s.byOddId.keys(), ...s.fromCollect.keys()])];
}

/** 调试：指定来源的 oddId 列表 */
export function listPbWsShadowIdsBySource(source: PbWsShadowSource): string[] {
  const out: string[] = [];
  for (const id of listPbWsShadowIds()) {
    if (getPbWsShadow(id)?.source === source)
      out.push(id);
  }
  return out;
}

/** 调试：旁显表里 H/M 各多少（如实统计，不筛） */
export function countPbWsShadowBySource(): { H: number; M: number; other: number; total: number } {
  let H = 0;
  let M = 0;
  let other = 0;
  for (const id of listPbWsShadowIds()) {
    const e = getPbWsShadow(id);
    if (!e)
      continue;
    if (e.source === "H")
      H += 1;
    else if (e.source === "M")
      M += 1;
    else
      other += 1;
  }
  return { H, M, other, total: H + M + other };
}

/**
 * 登记 eventId↔rotNum（采集 euro/odds）。
 * 影子在「同 rot、同 period 板上只有一个 event」时，把价拷到 sibling 的 HomeID 键。
 * 不写 fo；两 event 同 period 则不拷（避免串盘）。
 */
export function rememberPbRotEvent(
  eventId: string | number,
  rotNum: string | undefined | null,
): void {
  const eid = String(eventId ?? "").trim();
  const rot = String(rotNum ?? "").trim();
  if (!eid || !rot)
    return;
  const s = state();
  let set = s.rotToEvents.get(rot);
  if (!set) {
    set = new Set();
    s.rotToEvents.set(rot, set);
  }
  set.add(eid);
  s.eventToRot.set(eid, rot);
}

/**
 * 采集 euro/odds 打底影子（官网 HTTP，**不写 fo**）。
 * 观测板 replace 只改 byOddId；get 时板优先，缺的 period/event 用本层。
 */
export function upsertPbWsShadowFromParsedMatch(row: PbParsedMatch): void {
  const s = state();
  const matchId = String(row.matchId || "").trim();
  if (!matchId)
    return;
  const next = new Map<string, PbWsShadowEntry>();
  const now = Date.now();
  for (const stage of row.stages || []) {
    if (stage.winLocked)
      continue;
    const period = Number(stage.stageId);
    if (!Number.isFinite(period))
      continue;
    const put = (oddId: string, price: number) => {
      if (!(price > 0) || !oddId)
        return;
      next.set(String(oddId), {
        odds: price,
        text: String(price),
        isLock: false,
        time: now,
        source: "M",
      });
    };
    put(stage.winHomeId, Number(stage.winHome));
    put(stage.winAwayId, Number(stage.winAway));
  }
  const prev = s.collectKeysByMatch.get(matchId) ?? new Set<string>();
  let changed = false;
  for (const id of prev) {
    if (!next.has(id)) {
      s.fromCollect.delete(id);
      changed = true;
    }
  }
  for (const [id, entry] of next) {
    const old = s.fromCollect.get(id);
    if (!old || !sameEntry(old, entry)) {
      s.fromCollect.set(id, entry);
      changed = true;
    }
  }
  s.collectKeysByMatch.set(matchId, new Set(next.keys()));
  if (row.rotNum)
    rememberPbRotEvent(matchId, row.rotNum);
  if (changed)
    notify();
}

/** 调试：板层 vs 采集层 oddId（FIND_M 用） */
export function debugPbWsShadowLayers(): { board: string[]; collect: string[] } {
  const s = state();
  return {
    board: [...s.byOddId.keys()],
    collect: [...s.fromCollect.keys()],
  };
}

export type PbWsBoardCard = {
  eventId?: string | number;
  period?: number;
  betType?: number;
  rotNum?: string;
  home?: string | null;
  away?: string | null;
  homeLocked?: boolean;
  awayLocked?: boolean;
  homeAlt?: unknown;
  awayAlt?: unknown;
  /** 该侧价格上次因板写入变化的时间；缺省则本轮 now */
  homePriceAt?: number;
  awayPriceAt?: number;
  /** ws=sports-websocket 增量；http=拦截的 euro/odds */
  via?: "ws" | "http";
};

/**
 * [A8/官网可证实] updateOdds：仅 truthy oddFm 写入；空价不擦格。
 * 板卡上仍带旧展示字时，镜像进影子。
 */
function putSide(
  next: Map<string, PbWsShadowEntry>,
  eventId: string | number,
  period: number,
  side: "HOME" | "AWAY",
  price: string | null | undefined,
  priceAt: number | undefined,
  now: number,
): void {
  if (price == null || price === "") return;
  const odds = Number(price);
  if (!Number.isFinite(odds) || !(odds > 0)) return;
  const at =
    priceAt != null && Number.isFinite(priceAt) && priceAt > 0 ? Number(priceAt) : now;
  next.set(selectionId(eventId, period, side), {
    odds,
    text: String(price),
    isLock: false,
    time: at,
    source: "M",
  });
}

/**
 * 只重建观测板层 byOddId（不碰 fromCollect）。
 * - 空 cards：保持原表（poll 空板不闪断）
 * - 非空：整表重建为板上有展示价的格
 */
export function replacePbWsShadowFromBoard(cards: PbWsBoardCard[] | null | undefined): void {
  if (!Array.isArray(cards) || !cards.length) return;

  const s = state();
  const next = new Map<string, PbWsShadowEntry>();
  const now = Date.now();

  for (const card of cards) {
    const eventId = card.eventId;
    const period = Number(card.period);
    if (eventId == null || eventId === "" || !Number.isFinite(period)) continue;
    if (card.betType != null && Number(card.betType) !== 1) continue;

    const eid = String(eventId);
    const takeHome = Number(card.homeAlt) !== 1;
    const takeAway = Number(card.awayAlt) !== 1;
    if (!takeHome && !takeAway) continue;

    if (takeHome) {
      putSide(next, eid, period, "HOME", card.home, card.homePriceAt, now);
    }
    if (takeAway) {
      putSide(next, eid, period, "AWAY", card.away, card.awayPriceAt, now);
    }

    const rot = String(card.rotNum || "").trim() || s.eventToRot.get(eid) || "";
    if (rot)
      rememberPbRotEvent(eid, rot);
  }

  // 同 rot 且该 period 板上只有一个 event：把价写到其它 sibling 的 selectionId（GetMatchs 常钉 pre event）
  const rotPeriodOwners = new Map<string, Set<string>>();
  for (const card of cards) {
    const eid = String(card.eventId ?? "");
    const period = Number(card.period);
    const rot = String(card.rotNum || "").trim() || s.eventToRot.get(eid) || "";
    if (!rot || !eid || !Number.isFinite(period))
      continue;
    if (!next.has(selectionId(eid, period, "HOME")) && !next.has(selectionId(eid, period, "AWAY")))
      continue;
    const pk = `${rot}|${period}`;
    let owners = rotPeriodOwners.get(pk);
    if (!owners) {
      owners = new Set();
      rotPeriodOwners.set(pk, owners);
    }
    owners.add(eid);
  }
  for (const card of cards) {
    const srcEid = String(card.eventId ?? "");
    const period = Number(card.period);
    const rot = String(card.rotNum || "").trim() || s.eventToRot.get(srcEid) || "";
    if (!rot || !Number.isFinite(period))
      continue;
    const owners = rotPeriodOwners.get(`${rot}|${period}`);
    if (!owners || owners.size !== 1)
      continue;
    const siblings = s.rotToEvents.get(rot);
    if (!siblings)
      continue;
    for (const sib of siblings) {
      if (sib === srcEid)
        continue;
      const homeSrc = next.get(selectionId(srcEid, period, "HOME"));
      const awaySrc = next.get(selectionId(srcEid, period, "AWAY"));
      const homeAlias = selectionId(sib, period, "HOME");
      const awayAlias = selectionId(sib, period, "AWAY");
      if (homeSrc && !next.has(homeAlias))
        next.set(homeAlias, { ...homeSrc });
      if (awaySrc && !next.has(awayAlias))
        next.set(awayAlias, { ...awaySrc });
    }
  }

  let changed = next.size !== s.byOddId.size;
  if (!changed) {
    for (const [id, entry] of next) {
      const prev = s.byOddId.get(id);
      if (!prev || !sameEntry(prev, entry)) {
        changed = true;
        break;
      }
    }
    if (!changed) {
      for (const id of s.byOddId.keys()) {
        if (!next.has(id)) {
          changed = true;
          break;
        }
      }
    }
  }
  if (!changed) return;

  s.byOddId.clear();
  for (const [id, entry] of next) s.byOddId.set(id, entry);
  notify();
}

export function resetPbWsShadowForTests(): void {
  const s = state();
  s.byOddId.clear();
  s.fromCollect.clear();
  s.collectKeysByMatch.clear();
  s.rotToEvents.clear();
  s.eventToRot.clear();
  s.revision = 0;
  s.listeners.clear();
}
