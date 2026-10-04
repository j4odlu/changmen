/**
 * OB 体育盘口解码（港水→欧赔、hpid 主盘）。仅足球采集用，不写电竞 fo。
 */

export const OB_FOOTBALL_ID_BASE = 820_000_000;

/**
 * OB 足球玩法 ID（hpid）。名称来自详情 `hpsPns`（hpid→hpn），不是赔率形状、也不是有没有 hv。
 * 同一 hpid 下多条 `hl` 用 `hv` 区分盘口线（独赢平手 hv 空/0，其它 1X2 线 hv 为 ±N 或 1-0）。
 * 九游 `getCategoryList`：hpid 1/17 在「所有投注」= 独赢；「让球&大小」才是 4/2/19/18。
 */
export const OB_HPID_MARKET: Record<string, { marketCode: string; period: string }> = {
  1: { marketCode: "moneyline", period: "ft" },
  17: { marketCode: "moneyline", period: "ht" },
  25: { marketCode: "moneyline", period: "q" },
  4: { marketCode: "spreads", period: "ft" },
  19: { marketCode: "spreads", period: "ht" },
  143: { marketCode: "spreads", period: "q" },
  2: { marketCode: "totals", period: "ft" },
  18: { marketCode: "totals", period: "ht" },
  26: { marketCode: "totals", period: "q" },
};

/** 足球页让球 / 大小（含半场、节次）。独赢、波胆等不算。 */
export function isObAhOuMarket(hpid?: string, marketCode?: string): boolean {
  const spec = OB_HPID_MARKET[String(hpid || "")];
  if (spec)
    return spec.marketCode === "spreads" || spec.marketCode === "totals";
  const c = String(marketCode || "").toLowerCase();
  return c === "spreads" || c === "totals" || c.endsWith("_spreads") || c.endsWith("_totals");
}

function isFtHtBoardSpec(spec: { marketCode: string; period: string } | undefined): boolean {
  return Boolean(spec && (spec.period === "ft" || spec.period === "ht")
    && (spec.marketCode === "moneyline" || spec.marketCode === "spreads" || spec.marketCode === "totals"));
}

/** 列表/详情主盘：全场/半场 独赢+让球+大小。不含节次独赢、波胆、角球。 */
export function isObBoardMarket(hpid?: string, marketCode?: string): boolean {
  const spec = OB_HPID_MARKET[String(hpid || "")];
  if (spec)
    return isFtHtBoardSpec(spec);
  const c = String(marketCode || "").toLowerCase();
  return c === "moneyline" || c === "spreads" || c === "totals"
    || c.endsWith("_moneyline") || c.endsWith("_spreads") || c.endsWith("_totals");
}

export const OB_AHOU_HPIDS = Object.keys(OB_HPID_MARKET).filter((id) => {
  const spec = OB_HPID_MARKET[id];
  return spec?.marketCode === "spreads" || spec?.marketCode === "totals";
});

export const OB_BOARD_HPIDS = Object.keys(OB_HPID_MARKET).filter((id) => isFtHtBoardSpec(OB_HPID_MARKET[id]));

export function round3(n: number): number {
  const v = Number(n);
  if (!Number.isFinite(v))
    return 0;
  return Math.round(v * 1000) / 1000;
}

export function hkToDecimal(hk: unknown): number {
  const n = Number(hk);
  if (!Number.isFinite(n) || n === 0)
    return 0;
  if (n > 0)
    return round3(1 + n);
  return round3(1 + 1 / Math.abs(n));
}

export function parseObHandicapLine(hv: unknown): number | null {
  const s = String(hv ?? "").trim();
  if (!s)
    return null;
  const score = s.match(/^(-?\d+(?:\.\d+)?)\s*[-:]\s*(-?\d+(?:\.\d+)?)$/);
  if (score) {
    const home = Number(score[1]);
    const away = Number(score[2]);
    if (Number.isFinite(home) && Number.isFinite(away))
      return round3(away - home);
  }
  const parts = s.split("/").map(x => x.trim());
  if (parts.some(part => !/^[+-]?\d+(?:\.\d+)?$/.test(part)))
    return null;
  if (parts.length === 2) {
    const first = Number(parts[0]);
    // [changmen 扩展] OB 实际 hv=-0.5/1：首项负号作用于整档（-0.75），含 -0/0.5。
    const second = parts[0].startsWith("-") && !/^[+-]/.test(parts[1])
      ? -Number(parts[1]) : Number(parts[1]);
    return round3((first + second) / 2);
  }
  if (parts.length === 1)
    return Number(parts[0]);
  return null;
}

export function olOdds(ol: Record<string, unknown> | null | undefined): number {
  if (!ol)
    return 0;
  if (ol.ov2 != null && ol.ov2 !== "")
    return hkToDecimal(ol.ov2);
  const ov = Number(ol.ov);
  if (!Number.isFinite(ov) || ov === 0)
    return 0;
  if (Math.abs(ov) >= 10_000)
    return round3(ov / 100_000);
  if (ov > 1)
    return round3(ov);
  return hkToDecimal(ov);
}

function olText(ol: Record<string, unknown>): string {
  return [ol.ot, ol.ots, ol.otn, ol.on, ol.onb, ol.osn, ol.na, ol.otd, ol.type]
    .map(x => String(x ?? "")).join(" ");
}

export type ObOutcomeSide = "home" | "away" | "draw" | "over" | "under" | "other";

export function classifyObOutcome(ol: Record<string, unknown>, index: number, total: number): ObOutcomeSide {
  const raw = olText(ol).toLowerCase();
  if (/和局|平局|平|draw|\bx\b|tie/.test(raw) || String(ol.ot ?? "").toUpperCase() === "X")
    return "draw";
  if (/大|over|\bo\b/.test(raw) && !/主|客|home|away/.test(raw))
    return "over";
  if (/小|under|\bu\b/.test(raw) && !/主|客|home|away/.test(raw))
    return "under";
  if (/主胜|主|home|^h$|(^|\s)1(\s|$)/.test(raw))
    return "home";
  if (/客胜|客|away|^a$|(^|\s)2(\s|$)/.test(raw))
    return "away";
  if (total === 3)
    return index === 0 ? "home" : index === 1 ? "draw" : "away";
  if (total === 2)
    return index === 0 ? "home" : "away";
  return "other";
}

function asHlList(hl: unknown): object[] {
  if (Array.isArray(hl))
    return hl.filter(Boolean);
  if (hl && typeof hl === "object" && (Array.isArray((hl as { ol?: unknown }).ol) || "hv" in hl || "hid" in hl))
    return [hl];
  return [];
}

function playLines(play: Record<string, unknown>): Record<string, unknown>[] {
  const nested = Array.isArray(play.hps) ? play.hps : play.hps ? [play.hps] : [];
  const bags = nested.length ? nested : [play];
  const lines: Record<string, unknown>[] = [];
  for (const hp of bags as Record<string, unknown>[]) {
    const hls = asHlList(hp?.hl);
    if (hls.length) {
      for (const row of hls)
        lines.push(row as Record<string, unknown>);
      continue;
    }
    if (Array.isArray(hp?.ol) && hp.ol.length)
      lines.push({ hv: hp.hv, ol: hp.ol });
  }
  if (!lines.length) {
    for (const hl of asHlList(play.hl))
      lines.push(hl as Record<string, unknown>);
  }
  return lines;
}

const EXTRA_HPS_BAG_KEYS = [
  "hpsCorner", "hpsPunish", "hpsTCorner", "hpsTPunish",
  "hpsBold", "hpsTBold", "hpsCompose", "hpsPromotion", "hpsPenalty",
  "hpsOvertime", "hps5Minutes", "hps15Minutes",
];

function pushPlayList(plays: Record<string, unknown>[], list: unknown) {
  if (!Array.isArray(list))
    return;
  for (const p of list) {
    if (p && typeof p === "object")
      plays.push(p as Record<string, unknown>);
  }
}

export function playsFromObMatchRow(row: unknown): Record<string, unknown>[] {
  if (!row || typeof row !== "object" || Array.isArray(row))
    return [];
  const src = row as Record<string, unknown>;
  const plays: Record<string, unknown>[] = [];
  if (Array.isArray(src.playData) && src.playData.length)
    pushPlayList(plays, src.playData);
  // 详情 getMatchBaseInfoByOddsPB 常直接挂 hps / hpsAdd
  pushPlayList(plays, src.hps);
  pushPlayList(plays, src.hpsAdd);
  const bags = Array.isArray(src.hpsData) ? src.hpsData : src.hpsData ? [src.hpsData] : [];
  for (const bag of bags as Record<string, unknown>[]) {
    pushPlayList(plays, bag?.hps);
    pushPlayList(plays, bag?.hpsAdd);
  }
  for (const key of EXTRA_HPS_BAG_KEYS)
    pushPlayList(plays, src[key]);
  return plays;
}

export function resolveObPlayMarketCode(
  hpid: string,
  spec: { marketCode: string; period: string } | undefined,
): string {
  if (!spec)
    return `ob:${hpid || "x"}`;
  if (spec.period === "q")
    return `ob:${hpid || "x"}`;
  if (spec.period === "ht")
    return `ht_${spec.marketCode}`;
  return spec.marketCode;
}

export function isCompleteOb1x2(
  selections: Array<{ side?: string; odds?: number }>,
): boolean {
  const home = selections.some(s => s.side === "home" && Number(s.odds) > 0);
  const away = selections.some(s => s.side === "away" && Number(s.odds) > 0);
  return home && away;
}

export type ObPlaySelectionRow = {
  hpid: string;
  hid?: string;
  marketCode: string;
  period: string;
  name: string;
  line: number | null;
  selections: Array<{ side: ObOutcomeSide; oid: string; odds: number; name: string }>;
};

export function extractObPlaySelections(play: Record<string, unknown>): ObPlaySelectionRow[] {
  const hpid = String(play.hpid ?? play.hpId ?? "");
  const spec = OB_HPID_MARKET[hpid];
  const marketCode = resolveObPlayMarketCode(hpid, spec);
  const period = spec?.period || "";
  const name = String(play.hpn || play.title || play.n || marketCode);
  const rows: ObPlaySelectionRow[] = [];
  for (const hl of playLines(play)) {
    const ols = Array.isArray(hl.ol) ? hl.ol as Record<string, unknown>[] : [];
    const line = parseObHandicapLine(hl.hv ?? hl.hsw ?? hl.hs ?? play.hv);
    const selections = ols.map((ol, i) => {
      const side = classifyObOutcome(ol, i, ols.length);
      return {
        side,
        oid: String(ol.oid ?? ol.id ?? ""),
        odds: olOdds(ol),
        name: String(ol.on || ol.otn || ol.na || side),
      };
    });
    if (spec?.marketCode === "moneyline" && !isCompleteOb1x2(selections))
      continue;
    rows.push({
      hpid,
      hid: String(hl.hid ?? ""),
      marketCode,
      period,
      name,
      line,
      selections,
    });
  }
  if (!rows.length && spec?.marketCode !== "moneyline") {
    rows.push({
      hpid,
      marketCode,
      period,
      name,
      line: parseObHandicapLine(play.hv),
      selections: [],
    });
  }
  return rows;
}

export function obPlayRowKey(row: ObPlaySelectionRow): string {
  const hid = String(row.hid || "");
  if (hid)
    return `${row.hpid}|${hid}`;
  const oids = (row.selections || []).map(s => s.oid).filter(Boolean).join(",");
  return `${row.hpid}|${row.line ?? ""}|${oids}`;
}

/** hps 主盘 + hpsAdd 加线会各给一条同 hpid；用 hid/hv 去重，不要靠赔率猜玩法。 */
export function dedupeObPlaySelectionRows(rows: ObPlaySelectionRow[]): ObPlaySelectionRow[] {
  const out: ObPlaySelectionRow[] = [];
  const seen = new Set<string>();
  for (const row of rows || []) {
    const key = obPlayRowKey(row);
    if (seen.has(key))
      continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

function pickSide(selections: ObPlaySelectionRow["selections"], side: string) {
  return selections.find(s => s.side === side) || null;
}

export function listBetsFromObPlayData(playData: unknown[]): Array<{
  marketCode: string;
  line: number | null;
  name: string;
  period: string;
  hpid: string;
  homeOid: string;
  awayOid: string;
  drawOid: string;
  homeOdds: number;
  awayOdds: number;
  drawOdds: number;
}> {
  const plays = Array.isArray(playData) ? playData : [];
  const extracted: ObPlaySelectionRow[] = [];
  for (const play of plays) {
    if (!play || typeof play !== "object")
      continue;
    extracted.push(...extractObPlaySelections(play as Record<string, unknown>));
  }
  const bets = [];
  for (const row of dedupeObPlaySelectionRows(extracted)) {
    const hpid = row.hpid;
    const spec = OB_HPID_MARKET[hpid];
    const live = row.selections.filter(s => s.oid || s.odds > 0);
    if (live.length < 2)
      continue;
    if (!spec && live.length > 3)
      continue;
    const totalsLike = spec?.marketCode === "totals"
      || live.some(s => s.side === "over" || s.side === "under");
    const home = pickSide(row.selections, totalsLike ? "over" : "home")
      || row.selections[0]
      || { oid: "", odds: 0, side: "home" as const, name: "" };
    const away = pickSide(row.selections, totalsLike ? "under" : "away")
      || row.selections[1]
      || { oid: "", odds: 0, side: "away" as const, name: "" };
    const draw = pickSide(row.selections, "draw");
    const marketCode = resolveObPlayMarketCode(hpid, spec);
    bets.push({
      marketCode,
      line: row.line,
      name: row.name,
      period: spec?.period || "",
      hpid,
      homeOid: home.oid,
      awayOid: away.oid,
      drawOid: draw?.oid || "",
      homeOdds: home.odds,
      awayOdds: away.odds,
      drawOdds: draw?.odds || 0,
    });
  }
  return bets;
}
