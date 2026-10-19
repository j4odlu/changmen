/** 与 gamebet_backend/shared/market_catalog.json → TF.match_winner 一致 */
export const TF_DEFAULT_BET_NAME = "(独赢|获胜者)";

export function compileTfBetNameRegex(platformBetName?: string): RegExp {
  const pat = platformBetName?.trim() || TF_DEFAULT_BET_NAME;
  return new RegExp(pat);
}

export interface TfStageMeta {
  stageId: number;
  mapOption: string;
  marketOption: "MATCH" | "MAP";
}

export interface TfFoOddEntry {
  id: string;
  odds: number;
  isLock: boolean;
  betId: string;
}

export interface TfSaveBetRow {
  Type: string;
  SourceMatchID: string;
  SourceBetID: string;
  Map: number;
  BetName: string;
  SourceHomeID: string;
  HomeName: string;
  HomeOdds: number;
  SourceAwayID: string;
  AwayName: string;
  AwayOdds: number;
  Status: string;
}

export function selectionOddsId(marketId: string, selectionName: string): string {
  return `${marketId}:${selectionName}`;
}

export function stageFromTabName(tabName: string): TfStageMeta | null {
  const name = tabName.trim();
  if (!name || name === "MATCH") return { stageId: 0, mapOption: "", marketOption: "MATCH" };
  const mapMatch = /^MAP\s*(\d+)$/i.exec(name);
  if (mapMatch) {
    const n = Number(mapMatch[1]);
    return { stageId: n, mapOption: name, marketOption: "MAP" };
  }
  // A8：非 MATCH 的 tab 一律按 MAP + map_option=tab 名请求
  return { stageId: 0, mapOption: name, marketOption: "MAP" };
}

/** A8 在 MATCH 详情响应的 market_tabs 中发现地图 tab（不用列表行上的 tabs） */
export function extractMapTabsFromResults(results: Array<Record<string, unknown>>): string[] {
  const tabs: string[] = [];
  for (const block of results) {
    const marketTabs = (block.market_tabs ?? []) as Array<{ tab_name?: string }>;
    for (const t of marketTabs) {
      const name = String(t.tab_name ?? "").trim();
      if (name && name !== "MATCH" && !tabs.includes(name)) tabs.push(name);
    }
  }
  return tabs;
}

export function pickSelection(
  market: Record<string, unknown>,
  side: string,
): Record<string, unknown> | undefined {
  const rows = (market.selection ?? []) as Array<Record<string, unknown>>;
  return rows.find((s) => s.name === side);
}

export function marketLocked(
  market: Record<string, unknown>,
  home: Record<string, unknown>,
  away: Record<string, unknown>,
): boolean {
  if (home.status !== "open" || away.status !== "open") return true;
  if (market.settlement_status === "settled") return true;
  return false;
}

export function isTfMarketCollectable(market: Record<string, unknown>, betRe: RegExp): boolean {
  const marketName = String(market.market_name ?? "");
  return betRe.test(marketName);
}

export function resolveTfMarketStageId(
  market: Record<string, unknown>,
  stageMeta: TfStageMeta,
): number {
  const mapNum = Number(market.map_num);
  return Number.isFinite(mapNum) && mapNum > 0 ? mapNum : stageMeta.stageId;
}

/** Ingest：单 market 下全部 selection → fo 条目 */
export function listTfMarketFoEntries(market: Record<string, unknown>): TfFoOddEntry[] {
  const marketId = String(market.market_id ?? "");
  const entries: TfFoOddEntry[] = [];
  for (const sel of (market.selection ?? []) as Array<Record<string, unknown>>) {
    const selName = String(sel.name ?? "");
    if (!selName) continue;
    entries.push({
      id: selectionOddsId(marketId, selName),
      odds: Number(sel.euro_odds) || 0,
      isLock: sel.status !== "open",
      betId: marketId,
    });
  }
  return entries;
}

/** Report：单 market → SaveBet 行（需 home/away selection） */
export function tfMarketToSaveBetRow(
  matchId: string,
  teamNames: [string, string],
  market: Record<string, unknown>,
  stageId: number,
  platform = "TF",
): TfSaveBetRow | null {
  const home = pickSelection(market, "home");
  const away = pickSelection(market, "away");
  if (!home || !away) return null;

  const marketId = String(market.market_id ?? "");
  const marketName = String(market.market_name ?? "");
  const locked = marketLocked(market, home, away);
  const label = stageId === 0 ? "全场" : `地图${stageId}`;

  return {
    Type: platform,
    SourceMatchID: matchId,
    SourceBetID: marketId,
    Map: stageId,
    BetName: `[${label}]-${marketName}`,
    SourceHomeID: selectionOddsId(marketId, "home"),
    HomeName: teamNames[0] ?? "",
    HomeOdds: Number(home.euro_odds) || 0,
    SourceAwayID: selectionOddsId(marketId, "away"),
    AwayName: teamNames[1] ?? "",
    AwayOdds: Number(away.euro_odds) || 0,
    Status: locked ? "Locked" : "Normal",
  };
}

/** Report：HTTP results 块 → 按 stage 去重的 SaveBet 行 */
export function buildTfSaveBetRowsFromResults(
  results: Array<Record<string, unknown>>,
  matchId: string,
  teamNames: [string, string],
  betRe: RegExp,
  stageMeta: TfStageMeta,
  platform = "TF",
): TfSaveBetRow[] {
  const byStage = new Map<number, TfSaveBetRow>();

  for (const block of results) {
    for (const market of (block.markets ?? []) as Array<Record<string, unknown>>) {
      if (!isTfMarketCollectable(market, betRe)) continue;
      const stageId = resolveTfMarketStageId(market, stageMeta);
      const row = tfMarketToSaveBetRow(matchId, teamNames, market, stageId, platform);
      if (row) byStage.set(stageId, row);
    }
  }

  return [...byStage.values()].sort((a, b) => a.Map - b.Map);
}
