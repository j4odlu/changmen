import type { PmSportSnapshot } from "@/types/esport";
import type { PmMapIdentity } from "@changmen/venue-adapter/polymarket";
import { formatPmMatchStatus, isPmMapFinished } from "./pmSportDisplay";

export interface PmScoreMapOutcome {
  identity: string;
  side: "home" | "away";
  homeWins: number;
  awayWins: number;
}

/** [changmen 扩展] 仅供比赛卡展示的比分证据，不写官方赛果或订单结算。 */
export function readPmScoreMapOutcome(input: {
  snapshot: PmSportSnapshot | undefined;
  eventKey: string;
  map: number;
  homeName: string;
  awayName: string;
  homeTokenId: string;
  awayTokenId: string;
  market?: PmMapIdentity | null;
}, previous?: PmScoreMapOutcome | null): PmScoreMapOutcome | null {
  const { snapshot, map, eventKey, homeTokenId, awayTokenId } = input;
  if (!snapshot || !eventKey || !homeTokenId || !awayTokenId || homeTokenId === awayTokenId
    || map <= 0 || !isPmMapFinished(snapshot, map))
    return null;
  const name = (value: string | undefined) => String(value ?? "").normalize("NFKC").trim().toLowerCase();
  const home = name(input.homeName), away = name(input.awayName);
  const scoreHome = name(snapshot.homeTeam), scoreAway = name(snapshot.awayTeam);
  if (!home || !away || home === away || !scoreHome || !scoreAway || scoreHome === scoreAway)
    return null;
  const market = input.market;
  // 合场队名可能是别名（如 Procyon Team / Procyon Gaming），以 PM 原生队名和 token 双向对齐。
  let nativeHome = home, nativeAway = away, tokensReversed = false;
  if (market) {
    const eventIds = [String(market.sourceMatchId), market.eventSlug].filter(Boolean);
    if (market.map !== map || !eventIds.includes(eventKey)
      || (snapshot.slug && market.eventSlug && snapshot.slug !== market.eventSlug))
      return null;
    const tokensAligned = homeTokenId === market.homeTokenId && awayTokenId === market.awayTokenId;
    tokensReversed = homeTokenId === market.awayTokenId && awayTokenId === market.homeTokenId;
    if (!tokensAligned && !tokensReversed)
      return null;
    nativeHome = name(market.homeName);
    nativeAway = name(market.awayName);
    if (!nativeHome || !nativeAway || nativeHome === nativeAway)
      return null;
  }
  const aligned = scoreHome === nativeHome && scoreAway === nativeAway;
  const swapped = scoreHome === nativeAway && scoreAway === nativeHome;
  const reversed = swapped !== tokensReversed;
  if (!aligned && !swapped)
    return null;
  const score = snapshot.mapScore;
  if (!score || !Number.isSafeInteger(score.home) || !Number.isSafeInteger(score.away) || score.home < 0 || score.away < 0)
    return null;
  // 原始比分证明它不是缺值时生成的 0–0；推送可能已换位，故核对两边计数而不再按 Reverse 翻转。
  const raw = /^(\d+)\s*-\s*(\d+)$/.exec(String(snapshot.scoreRaw ?? "").split("|")[1]?.trim() ?? "");
  if (!raw || !((Number(raw[1]) === score.home && Number(raw[2]) === score.away)
    || (Number(raw[1]) === score.away && Number(raw[2]) === score.home)))
    return null;
  const played = score.home + score.away;
  if (!Number.isSafeInteger(played) || played < map)
    return null;
  const period = /^(\d+)\/(\d+)$/.exec(String(snapshot.period ?? "").trim());
  const currentMap = snapshot.currentMap ?? (period ? Number(period[1]) : null);
  const bo = snapshot.bo ?? (period ? Number(period[2]) : null);
  if (bo != null && (!Number.isSafeInteger(bo) || bo <= 0 || played > bo
    || (currentMap != null && currentMap > bo)))
    return null;
  const homeWins = reversed ? score.away : score.home;
  const awayWins = reversed ? score.home : score.away;
  const identity = JSON.stringify([eventKey, snapshot.gameId, snapshot.slug, map, homeTokenId, awayTokenId, home, away,
    market?.marketId, nativeHome, nativeAway]);
  const retained = previous?.identity === identity && homeWins >= previous.homeWins && awayWins >= previous.awayWins
    ? previous : null;
  // 比分可能先于 period 更新；该帧不产生新结论，也不抹掉仍与比分相容的旧证据。
  if (formatPmMatchStatus(snapshot).kind === "live" && currentMap !== played + 1)
    return retained;
  // 零封累计比分可唯一确定每张已打地图；1–1 / 2–1 本身不能还原地图顺序。
  if (homeWins === 0 || awayWins === 0)
    return { identity, side: homeWins > 0 ? "home" : "away", homeWins, awayWins };
  // 页面已观察到的明确结果可以保留；比分回滚、队伍/盘口变化时撤回，不能串到另一场。
  return retained;
}
