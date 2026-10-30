import { shallowReactive } from "vue";
import { resolveGameCode } from "@changmen/shared/catalog/game_catalog.browser";
import { describeRayOdd, RAY_MARKET_CATALOG } from "@changmen/shared/catalog/venues/ray";
import { getVenueOddsEntry, saveVenueOdds } from "@changmen/client-core/bridge/oddsAccess";
import type { RayOddsPayload } from "./shared/save_bets";

export interface RayBasketballSpreadOption {
  id: string;
  line: string;
  status: number;
}

export interface RayBasketballSpreadRow {
  key: string;
  home: RayBasketballSpreadOption | null;
  away: RayBasketballSpreadOption | null;
}

interface SpreadSnapshot {
  requestedAt: number;
  rows: RayBasketballSpreadRow[];
}

/** [changmen 扩展] 单馆展示目录，不生成 ViewBet，不参与 SaveBet、策略或订单。 */
const snapshots = shallowReactive(new Map<string, SpreadSnapshot>());
const MAX_CACHED_MATCHES = 128;
const signed = (value: number) => value > 0 ? `+${value}` : String(Object.is(value, -0) ? 0 : value);

function buildRows(payload: RayOddsPayload, matchId: string): RayBasketballSpreadRow[] {
  const home = payload.team?.find(team => Number(team.pos) === 1);
  const away = payload.team?.find(team => Number(team.pos) === 2);
  if (!home || !away || String(home.team_id) === String(away.team_id))
    return [];
  const groups = new Map<string, { home: RayBasketballSpreadOption[]; away: RayBasketballSpreadOption[]; order: number }>();
  for (const raw of payload.odds ?? []) {
    if (!raw || (raw.match_id != null && String(raw.match_id) !== matchId))
      continue;
    const odd = describeRayOdd(raw, { eventId: matchId, gameId: "1072082", gameCode: "basketball" });
    if (odd.marketCode !== "handicap" || odd.stage !== "final" || !odd.optionId
      || !RAY_MARKET_CATALOG.protocol.visibleStatuses.some(status => status === Number(raw.status)))
      continue;
    const side = String(raw.team_id) === String(home.team_id) ? "home"
      : String(raw.team_id) === String(away.team_id) ? "away" : null;
    if (!side)
      continue;
    const components = odd.value.components;
    // 未识别的线仍按原样旁显，但不猜测另一侧；不能把全部备用线合为一盘。
    const canonical = components?.map(value => side === "home" ? value : -value);
    const key = JSON.stringify([odd.groupId, canonical ?? odd.optionId]);
    const group = groups.get(key) ?? { home: [], away: [], order: canonical?.[0] ?? Infinity };
    if (!group[side].some(option => option.id === odd.optionId)) {
      group[side].push({ id: odd.optionId, line: components?.map(signed).join(",") ?? String(raw.value ?? ""), status: Number(raw.status) });
    }
    groups.set(key, group);
  }
  return [...groups.entries()].sort((a, b) => a[1].order - b[1].order).flatMap(([key, group]) => {
    if (group.home.length <= 1 && group.away.length <= 1)
      return [{ key, home: group.home[0] ?? null, away: group.away[0] ?? null }];
    // 同线同侧存在多个不同原生 ID 时逐项显示，不随意拼成一组绑定。
    return ["home", "away"].flatMap(side => group[side as "home" | "away"].map(option => ({
      key: `${key}:${option.id}`, home: side === "home" ? option : null, away: side === "away" ? option : null,
    })));
  });
}

/** 原响应旁路读取；任何展示异常都不能改变原胜负采集的返回及上报。 */
export function ingestRayBasketballSpreads(
  matchId: string, payload: RayOddsPayload, gameCode?: string | null, requestedAt = Date.now(),
): void {
  try {
    if (resolveGameCode(gameCode ?? "") !== "basketball" || String(payload.id ?? "") !== matchId
      || !Array.isArray(payload.odds) || !Array.isArray(payload.team))
      return;
    const gameId = (payload as RayOddsPayload & { game_id?: unknown }).game_id;
    if (gameId != null && String(gameId) !== "1072082")
      return;
    if ((snapshots.get(matchId)?.requestedAt ?? -Infinity) > requestedAt)
      return;
    const rows = buildRows(payload, matchId);
    const options = new Map(rows.flatMap(row => [row.home, row.away]).filter(option => option !== null).map(option => [option.id, option]));
    const now = Date.now();
    for (const raw of payload.odds) {
      const option = options.get(String(raw.odds_id ?? ""));
      if (!option)
        continue;
      const existing = getVenueOddsEntry("RAY", option.id);
      if (existing?.source === "mqtt" && existing.time >= requestedAt)
        continue;
      // 只登记新增选项，原 WS 的已知 oddId 更新门闩即可继续工作；不改旧过滤器。
      const odds = Number(raw.odds);
      saveVenueOdds("RAY", { id: option.id, odds: Number.isFinite(odds) ? odds : 0,
        isLock: option.status !== 1, time: now });
    }
    snapshots.delete(matchId);
    snapshots.set(matchId, { requestedAt, rows });
    while (snapshots.size > MAX_CACHED_MATCHES)
      snapshots.delete(snapshots.keys().next().value!);
  }
  catch (error) {
    console.warn("[RAY basketball spreads] display snapshot", error);
  }
}

/** 只消费服务器 Reverse；交换已带原生正负线的选项，不再次翻号。 */
export function getRayBasketballSpreads(matchId: string, reversed = false): Readonly<SpreadSnapshot> | null {
  const snapshot = snapshots.get(matchId);
  if (!snapshot || !reversed)
    return snapshot ?? null;
  return { ...snapshot, rows: snapshot.rows.map(row => ({ ...row, home: row.away, away: row.home })) };
}

export function clearRayBasketballSpreads(): void {
  snapshots.clear();
}

if (import.meta.hot)
  import.meta.hot.dispose(clearRayBasketballSpreads);
