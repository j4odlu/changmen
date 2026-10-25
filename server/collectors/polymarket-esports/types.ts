import type { PolymarketMarketIndexEntry } from "@changmen/api-contract";

// Wire scalars stay unknown: the parser deliberately accepts numeric/string IDs
// and normalizes them at the same points as the original collector.
export interface GammaSeries {
  title?: unknown;
  slug?: unknown;
}

export interface GammaTeam {
  id?: unknown;
  name?: unknown;
  alias?: unknown;
  ordering?: unknown;
}

export interface GammaEvent {
  teams?: GammaTeam[] | null;
  id?: unknown;
  slug?: unknown;
  title?: unknown;
  ticker?: unknown;
  seriesSlug?: unknown;
  series?: GammaSeries | GammaSeries[] | null;
  metadata?: { league?: unknown; tournament?: unknown } | null;
  closed?: unknown;
  ended?: unknown;
  startTime?: unknown;
  startDate?: unknown;
  tags?: unknown;
  gameId?: unknown;
  resolutionSource?: unknown;
  markets?: GammaMarket[];
}

export interface ClobToken {
  token_id?: unknown;
  tokenId?: unknown;
  winner?: unknown;
}

export interface GammaMarket {
  condition_id?: unknown;
  conditionId?: unknown;
  market?: unknown;
  id?: unknown;
  sportsMarketType?: unknown;
  sports_market_type?: unknown;
  gameStartTime?: unknown;
  game_start_time?: unknown;
  startDate?: unknown;
  start_date?: unknown;
  tags?: unknown;
  events?: GammaEvent[];
  tokens?: ClobToken[];
  active?: unknown;
  closed?: unknown;
  archived?: unknown;
  accepting_orders?: unknown;
  acceptingOrders?: unknown;
  clob_token_ids?: unknown;
  clobTokenIds?: unknown;
  outcomes?: unknown;
  question?: unknown;
  title?: unknown;
  slug?: unknown;
  group_item_title?: unknown;
  groupItemTitle?: unknown;
  resolutionSource?: unknown;
}

export interface PlatformTeam {
  Type: "Polymarket";
  TeamID: string;
  Name: string;
  GameID: string;
  Logo: string;
}

export interface PlatformMatch {
  Type: "Polymarket";
  SourceMatchID: string;
  SourceGameID: string;
  StartTime: number;
  HomeID: string;
  Home: string;
  AwayID: string;
  Away: string;
  Teams: PlatformTeam[];
}

export interface PlatformBet extends Record<string, unknown> {
  Type: "Polymarket";
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

export interface IndexCandidate {
  marketId: string;
  assetIds: [string, string];
  match: { SourceMatchID: string; StartTime?: number };
  bet: Record<string, unknown>;
  mapOutcome?: "home" | "away";
  outcomeKind?: "official" | "price";
  resolutionSource?: string;
  eventSlug?: string;
}

export interface MappedMarket extends IndexCandidate {
  gameId?: number;
  match: PlatformMatch;
  bet: PlatformBet;
}

export interface IndexOptions {
  removeSourceMatchIds?: string[];
  retainSourceMatchIds?: string[];
  previousEntries?: PolymarketMarketIndexEntry[];
  nowMs?: number;
}

export interface DiscoveryResult {
  markets: GammaMarket[];
  rawEventCount: number;
  rawMarketCount: number;
  excludeSourceMatchIds?: string[];
}

export interface PruneOptions {
  forceDeleteIds: string[];
  staleBeforeMs: number;
}

export interface CycleDependencies {
  fetchMarkets?: () => Promise<DiscoveryResult>;
  fetchPrices?: (ids: string[]) => Promise<Record<string, number>>;
  fetchOfficialMarkets?: (markets: GammaMarket[]) => Promise<GammaMarket[]>;
  resolveTypes?: () => Promise<Set<string>>;
  writeMatches?: (platform: string, matches: PlatformMatch[]) => unknown;
  replaceBets?: (platform: string, sid: string, bets: Record<string, unknown>[]) => unknown;
  persistIndex?: (candidates: IndexCandidate[], prices: Record<string, number>, opts: IndexOptions) => void;
  pruneMatches?: (opts: PruneOptions) => Promise<string[] | number>;
  writePlatform?: boolean;
  maxTracked?: number;
  nowMs?: number;
}

interface CycleCounts {
  matches: number;
  bets: number;
  writePlatform: boolean;
  rawMarketCount: number;
  rawEventCount: number;
  collectTypes: string[];
  typedMlCount?: number;
}

export type CycleStats = CycleCounts & (
  | { skipped: true; reason: "filter_empty_with_typed_ml" }
  | { skipped: false; pruned: number; shadow: boolean; truncated?: boolean }
);
