/**
 * SXBet 报价/下单工具（非 discovery）。
 * Discovery `buildSxMappedMarket` 权威在 `server/collectors/sxbet-collector/parse.js`。
 */
import { truncateOddsTo3 } from "@changmen/shared/odds_format";
import type { SxBestOddsRow, SxBestOddsWsUpdate, SxOrder } from "./api";

export const SX_ODDS_PRECISION = 1e20;
const ODDS_PRECISION = SX_ODDS_PRECISION;

const LEAGUE_GAME_PATTERNS: Array<[RegExp, string]> = [
  [/\b(lol|league of legends)\b/i, "lol"],
  [/\b(cs2|cs:?go|counter[- ]?strike)\b/i, "cs2"],
  [/\b(dota\s*2?|dota-2)\b/i, "dota2"],
  [/\bvalorant\b/i, "valorant"],
  [/\b(kog|honor of kings|king of glory)\b/i, "kog"],
];

export function mapSxLeagueToGameCode(leagueLabel: string | undefined): string | null {
  const label = String(leagueLabel ?? "").trim();
  if (!label)
    return null;
  for (const [pattern, code] of LEAGUE_GAME_PATTERNS) {
    if (pattern.test(label))
      return code;
  }
  return null;
}

export function sxRawOddsToImplied(raw: string | number | undefined): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0)
    return 0;
  return value / ODDS_PRECISION;
}

export function sxImpliedToDecimal(implied: number): number {
  if (!Number.isFinite(implied) || implied <= 0 || implied >= 1)
    return 0;
  return truncateOddsTo3(1 / implied);
}

export function sxOrderIsActive(order: SxOrder): boolean {
  const status = String(order.orderStatus ?? order.status ?? "").toUpperCase();
  return !status || status === "ACTIVE";
}

/** Best taker decimal odds for outcome one (home) or two (away). */
export function bestSxDecimalOdds(orders: SxOrder[] | undefined, forOutcomeOne: boolean): number {
  let bestImplied = 0;
  for (const order of orders ?? []) {
    if (!sxOrderIsActive(order))
      continue;
    const makerImplied = sxRawOddsToImplied(order.percentageOdds);
    if (!makerImplied || makerImplied >= 1)
      continue;
    const makerOnOutcomeOne = order.isMakerBettingOutcomeOne === true;
    const takerOnOutcomeOne = !makerOnOutcomeOne;
    if (forOutcomeOne !== takerOnOutcomeOne)
      continue;
    const takerImplied = 1 - makerImplied;
    if (takerImplied > bestImplied)
      bestImplied = takerImplied;
  }
  return sxImpliedToDecimal(bestImplied);
}

/**
 * REST `/orders/odds/best`：outcomeX.percentageOdds 是 **maker** 视角。
 * 吃 outcomeOne 的 taker 面对 maker-on-two → takerImplied = 1 - makerTwo。
 */
export function bestSxDecimalOddsFromBestRow(
  row: SxBestOddsRow | undefined,
  forOutcomeOne: boolean,
): number {
  if (!row)
    return 0;
  const makerOpposite = forOutcomeOne ? row.outcomeTwo : row.outcomeOne;
  const makerImplied = sxRawOddsToImplied(makerOpposite?.percentageOdds ?? undefined);
  if (!makerImplied || makerImplied >= 1)
    return 0;
  return sxImpliedToDecimal(1 - makerImplied);
}

/**
 * 下单用 desiredOdds：直接用协议整数，避免 decimal↔truncate 往返丢精度。
 * takerDesired = 1e20 - oppositeMakerPercentageOdds
 */
export function sxDesiredProtocolOddsFromBestRow(
  row: SxBestOddsRow | undefined,
  forOutcomeOne: boolean,
): string {
  if (!row)
    return "0";
  const makerOpposite = forOutcomeOne ? row.outcomeTwo : row.outcomeOne;
  const raw = String(makerOpposite?.percentageOdds ?? "").trim();
  if (!raw || raw === "null" || raw === "undefined")
    return "0";
  try {
    const maker = BigInt(raw);
    const full = 10n ** 20n;
    if (maker <= 0n || maker >= full)
      return "0";
    return (full - maker).toString();
  }
  catch {
    return "0";
  }
}

/** 协议格式 percentageOdds（taker 视角 implied * 1e20） */
export function sxDecimalToProtocolOdds(decimalOdds: number): string {
  if (!Number.isFinite(decimalOdds) || decimalOdds <= 1)
    return "0";
  const implied = 1 / decimalOdds;
  if (!(implied > 0) || !(implied < 1))
    return "0";
  return BigInt(Math.round(implied * ODDS_PRECISION)).toString();
}

export function sxProtocolOddsToDecimal(raw: string | number | undefined): number {
  return sxImpliedToDecimal(sxRawOddsToImplied(raw));
}

/** 把 WS best_odds 单侧推送合并进本地 best 行 */
export function applySxBestOddsWsUpdate(
  prev: SxBestOddsRow | undefined,
  update: SxBestOddsWsUpdate,
): SxBestOddsRow {
  const marketHash = String(update.marketHash ?? prev?.marketHash ?? "");
  const next: SxBestOddsRow = {
    marketHash,
    baseToken: update.baseToken ?? prev?.baseToken,
    outcomeOne: { ...(prev?.outcomeOne ?? {}) },
    outcomeTwo: { ...(prev?.outcomeTwo ?? {}) },
  };
  const side = update.isMakerBettingOutcomeOne ? next.outcomeOne! : next.outcomeTwo!;
  const prevAt = Number(side.updatedAt) || 0;
  const nextAt = Number(update.updatedAt) || 0;
  if (nextAt && prevAt && nextAt < prevAt)
    return prev ?? next;
  side.percentageOdds = update.percentageOdds ?? null;
  if (nextAt)
    side.updatedAt = nextAt;
  return next;
}

export function normalizeSxTeamName(name: string): string {
  const normalized = String(name || "")
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\u4E00-\u9FFF]+/gi, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "unknown";
}

export function sxSourceTeamId(gameId: string, name: string): string {
  return `${gameId}:${normalizeSxTeamName(name)}`;
}

export function sxOutcomeOddsId(marketHash: string, outcome: 1 | 2): string {
  return `${marketHash}:${outcome}`;
}
