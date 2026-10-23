// [changmen 扩展] 只处理传入的内存数据；保留赔率 Map 合并及详情 playData 的原引用语义。
import { isObSportC8Mid } from "@/runtime/obSportWs";

export type ClientMarketRow = {
  hpid?: string;
  Name?: string;
  MarketCode?: string;
  Line?: number | null;
  Period?: string;
  Selections?: Array<{ Name?: string; Odds?: number; Side?: string; OddID?: string }>;
};

export type ScheduleMeta = {
  mid: string;
  tid: string;
  tn: string;
  tnjc: string;
  startTime: number;
  home?: string;
  away?: string;
  isLive?: boolean;
};

const CSID_FOOTBALL = "1";

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asObjectList(value: unknown): Record<string, unknown>[] {
  const rows = Array.isArray(value) ? value : [];
  return rows.filter((row): row is Record<string, unknown> => Boolean(row && typeof row === "object" && !Array.isArray(row)));
}

/** 赛程可能是联赛袋（mids）也可能是比赛行（mhn/man）。`ms` 在比赛行上是状态数字。 */
function nestedMatchRows(t: Record<string, unknown>): Record<string, unknown>[] {
  const out = [
    ...asObjectList(t.mls),
    ...asObjectList(t.matches),
    ...asObjectList(t.matchList),
    ...asObjectList(t.mhl),
    ...asObjectList(t.ml),
    ...asObjectList(t.mbm),
    ...asObjectList(t.mbms),
  ];
  if (Array.isArray(t.ms))
    out.push(...asObjectList(t.ms));
  return out;
}

export function teamNames(row: Record<string, unknown>): { home: string; away: string } {
  return {
    home: String(row.mhn ?? row.home ?? row.homeName ?? "").trim(),
    away: String(row.man ?? row.away ?? row.awayName ?? "").trim(),
  };
}

/** livedata 可能是数组，也可能是 tid→联赛 的对象。 */
function bagRows(value: unknown): unknown[] {
  if (Array.isArray(value))
    return value;
  if (value && typeof value === "object") {
    const vals = Object.values(value as Record<string, unknown>);
    if (vals.some(v => v && typeof v === "object" && (
      "mids" in (v as object)
      || "mid" in (v as object)
      || "tid" in (v as object)
      || "csid" in (v as object)
    )))
      return vals;
  }
  return [];
}

function unwrapData(decoded: unknown): Record<string, unknown> {
  if (Array.isArray(decoded))
    return decoded as unknown as Record<string, unknown>;
  if (!decoded || typeof decoded !== "object")
    return {};
  const row = decoded as Record<string, unknown>;
  if (row.data && typeof row.data === "object")
    return row.data as Record<string, unknown>;
  return row;
}

export function envelopeCodeOk(code: unknown): boolean {
  if (code == null || code === "")
    return true;
  const s = String(code);
  // yewu11 列表用 0 / 0000000；queryOrderStatus / yewurecord [官网可证实] 用 200
  return s === "0" || s === "0000000" || s === "200";
}

function obFlagOne(row: Record<string, unknown> | null | undefined, key: string): boolean {
  const v = row?.[key];
  if (v === true)
    return true;
  const n = Number(v);
  return Number.isFinite(n) && n === 1;
}

/** 联赛文案：试玩「电子赛事」角标对应 VS- / EAFC / PANDA独家。不碰队名里的 vs。 */
function obLeagueLooksElectronic(...parts: unknown[]): boolean {
  const text = parts.map(p => String(p || "").trim()).filter(Boolean).join(" ");
  if (!text)
    return false;
  if (/(?:^|[\s])VS\s*[-－]/.test(text))
    return true;
  return /EAFC|电子赛事|电子足球|电竞足球|PANDA独家/i.test(text);
}

/**
 * 试玩足球菜单里的 EAFC / 电子赛事，不进 changmen 足球页。
 * `me`/`tme`=1 是电子类型位；没有位时用联赛名兜底。
 * 不要用 `mvs`（滚球场次常表示有视频，不是电子赛），也不要用 `mfo`（赛程阶段）。
 */
export function isObElectronicFootball(
  tour?: Record<string, unknown> | null,
  match?: Record<string, unknown> | null,
): boolean {
  const rows = [tour, match].filter((row): row is Record<string, unknown> => Boolean(row && typeof row === "object"));
  for (const row of rows) {
    if (obFlagOne(row, "me") || obFlagOne(row, "tme"))
      return true;
  }
  return rows.some(row => obLeagueLooksElectronic(row.tnjc, row.tn, row.nameText, row.shortName, row.n));
}

export function collectFootballMatches(decoded: unknown, forceLive = false): ScheduleMeta[] {
  const root = unwrapData(decoded);
  const bags: Array<{ rows: unknown[]; live: boolean }> = [
    { rows: bagRows(root.livedata), live: true },
    { rows: bagRows(root.nolivedata), live: false },
    { rows: bagRows(root.data), live: forceLive },
    { rows: bagRows(root.list), live: forceLive },
    { rows: asArray(root), live: forceLive },
  ];
  const byMid = new Map<string, ScheduleMeta>();
  const put = (row: ScheduleMeta) => {
    const prev = byMid.get(row.mid);
    if (!prev) {
      byMid.set(row.mid, row);
      return;
    }
    byMid.set(row.mid, {
      ...prev,
      ...row,
      home: row.home || prev.home,
      away: row.away || prev.away,
      tn: row.tn || prev.tn,
      tnjc: row.tnjc || prev.tnjc,
      startTime: row.startTime || prev.startTime,
      isLive: Boolean(prev.isLive || row.isLive),
    });
  };
  for (const bag of bags) {
    for (const tour of bag.rows) {
      if (!tour || typeof tour !== "object")
        continue;
      const t = tour as Record<string, unknown>;
      const csid = String(t.csid ?? t.sportId ?? t.sid ?? "");
      const midsRaw = t.mids ?? t.mid;
      const tid = String(t.tid ?? t.tournamentId ?? t.id ?? "");
      const tn = String(t.tn ?? t.nameText ?? t.n ?? "");
      const tnjc = String(t.tnjc ?? t.shortName ?? "");
      const mgt = t.mgt ?? t.startTime ?? t.mgtStr;
      const midList = Array.isArray(midsRaw)
        ? midsRaw.map(String)
        : String(midsRaw || "").split(",").map(s => s.trim()).filter(Boolean);
      if (csid && csid !== CSID_FOOTBALL)
        continue;
      if (isObElectronicFootball(t))
        continue;
      const skipMids = new Set<string>();
      const nested = nestedMatchRows(t);
      for (const row of nested) {
        const mid = String(row.mid ?? row.id ?? "");
        if (!isObSportC8Mid(mid))
          continue;
        const mCsid = String(row.csid ?? csid);
        if (mCsid && mCsid !== CSID_FOOTBALL)
          continue;
        if (isObElectronicFootball(t, row)) {
          skipMids.add(mid);
          continue;
        }
        const names = teamNames(row);
        put({
          mid,
          tid: String(row.tid ?? tid),
          tn: String(row.tn ?? tn),
          tnjc: String(row.tnjc ?? tnjc),
          startTime: Number(row.mgt ?? row.mgtStr ?? row.startTime ?? mgt) || 0,
          home: names.home,
          away: names.away,
          isLive: bag.live,
        });
      }
      const selfMid = String(t.mid ?? "");
      const selfNames = teamNames(t);
      const midsCsv = String(t.mids || "");
      for (const mid of midList) {
        if (!isObSportC8Mid(mid) || skipMids.has(mid))
          continue;
        const named = Boolean(selfNames.home && selfNames.away
          && (mid === selfMid || (!midsCsv.includes(",") && midList.length === 1)));
        put({
          mid,
          tid,
          tn,
          tnjc,
          startTime: Number(mgt) || 0,
          isLive: bag.live,
          ...(named ? selfNames : {}),
        });
      }
    }
  }
  return [...byMid.values()];
}

function ingestOddsRow(row: unknown, byMid: Map<string, Record<string, unknown>>) {
  if (!row || typeof row !== "object" || Array.isArray(row))
    return;
  const rec = row as Record<string, unknown>;
  const names = teamNames(rec);
  const mid = String(rec.mid ?? (names.home && names.away ? rec.id : "") ?? "");
  if (!mid || !isObSportC8Mid(mid))
    return;
  const prev = byMid.get(mid);
  if (!prev) {
    byMid.set(mid, rec);
    return;
  }
  // 玩法子行也带 mid、无 mhn/man；后写空串会冲掉已有队名。
  const next = { ...prev, ...rec };
  if (!names.home && prev.mhn)
    next.mhn = prev.mhn;
  if (!names.away && prev.man)
    next.man = prev.man;
  if (!String(next.tnjc || "").trim() && prev.tnjc)
    next.tnjc = prev.tnjc;
  if (!String(next.tn || "").trim() && prev.tn)
    next.tn = prev.tn;
  byMid.set(mid, next);
}

export function ingestOddsRows(decoded: unknown, byMid: Map<string, Record<string, unknown>>) {
  const root = unwrapData(decoded);
  const rows = asArray(root.data).length ? asArray(root.data) : asArray(root);
  for (const row of rows) {
    ingestOddsRow(row, byMid);
    if (row && typeof row === "object" && !Array.isArray(row))
      for (const nested of nestedMatchRows(row as Record<string, unknown>))
        ingestOddsRow(nested, byMid);
  }
  for (const bag of [root.livedata, root.nolivedata, root.list]) {
    for (const tour of bagRows(bag)) {
      ingestOddsRow(tour, byMid);
      if (tour && typeof tour === "object" && !Array.isArray(tour))
        for (const nested of nestedMatchRows(tour as Record<string, unknown>))
          ingestOddsRow(nested, byMid);
    }
  }
}

export function matchRowFromDecoded(decoded: unknown): Record<string, unknown> | null {
  const envelope = decoded && typeof decoded === "object" && !Array.isArray(decoded)
    ? decoded as Record<string, unknown>
    : {};
  const row = (asArray(envelope.data)[0] as Record<string, unknown> | undefined)
    || (envelope.mid ? envelope : null)
    || (Array.isArray(decoded) ? decoded[0] as Record<string, unknown> : null);
  if (row && Array.isArray(envelope.playData) && envelope.playData.length)
    row.playData = envelope.playData;
  return row || null;
}

export function metaOrOddsNamed(meta: ScheduleMeta, oddsRow: Record<string, unknown> | undefined): boolean {
  if (meta.home && meta.away)
    return true;
  if (!oddsRow)
    return false;
  const names = teamNames(oddsRow);
  return Boolean(names.home && names.away);
}

export function mergeSchedule(parts: ScheduleMeta[][]): ScheduleMeta[] {
  const byMid = new Map<string, ScheduleMeta>();
  for (const rows of parts) {
    for (const row of rows) {
      const prev = byMid.get(row.mid);
      if (!prev) {
        byMid.set(row.mid, row);
        continue;
      }
      byMid.set(row.mid, {
        ...prev,
        ...row,
        home: row.home || prev.home,
        away: row.away || prev.away,
        tn: row.tn || prev.tn,
        tnjc: row.tnjc || prev.tnjc,
        startTime: row.startTime || prev.startTime,
        isLive: Boolean(prev.isLive || row.isLive),
      });
    }
  }
  return [...byMid.values()];
}
