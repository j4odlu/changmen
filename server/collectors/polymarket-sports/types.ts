/// <reference path="../../../rds/collector_contracts.d.ts" />
import type { CollectorPmSportSnapshot, CollectorPrematchRecord, LinkedPolymarketMatch } from "@changmen/db";

export type StoredSportSnapshot = CollectorPmSportSnapshot;
export type PrematchRecord = CollectorPrematchRecord;
export type StateSource = "gamma" | "ws";
export interface SportMessage {
  gameId?: unknown;
  slug?: unknown;
  eventId?: unknown;
  event_id?: unknown;
  id?: unknown;
  leagueAbbreviation?: unknown;
  homeTeam?: unknown;
  awayTeam?: unknown;
  status?: unknown;
  live?: unknown;
  ended?: unknown;
  period?: unknown;
  score?: unknown;
  elapsed?: unknown;
  finished_timestamp?: unknown;
  resolutionSource?: unknown;
}
export interface GammaMarket {
  id?: unknown;
  sportsMarketType?: unknown;
  gameStartTime?: unknown;
  clobTokenIds?: unknown;
  events?: GammaEvent[];
  event?: GammaEvent;
}
export interface GammaEvent extends SportMessage {
  title?: unknown;
  markets?: GammaMarket[];
}
export interface GammaIdentity {
  id: string;
  slug: string;
  gameId?: number | null;
}
export interface GammaIndex {
  byGameId: Map<number, GammaIdentity>;
  bySlug: Map<string, GammaIdentity>;
  sportMessages?: SportMessage[];
}
export interface NormalizedSportSnapshot extends StoredSportSnapshot {
  homeTeam: string;
  awayTeam: string;
  status: string;
  live: boolean;
  ended: boolean;
  currentMap: number | null;
  mapScore: { home: number; away: number };
  updatedAt: number;
}
export type SportWriter = (id: number, snapshot: StoredSportSnapshot) => Promise<boolean>;
export type SportStateApply = (
  id: number, msg: SportMessage | null, source: StateSource, write: SportWriter,
) => Promise<boolean>;
export interface MatchState {
  loaded: boolean;
  wsReceived: boolean;
  prev: StoredSportSnapshot | null;
  written: StoredSportSnapshot | null;
  tail: Promise<unknown>;
}
export interface GammaPollOptions {
  list?: () => Promise<LinkedPolymarketMatch[]>;
  fetchEvent?: (id: string) => Promise<GammaEvent | null>;
  apply?: SportStateApply;
}
export interface HistoryPoint {
  price: number | string;
  timestamp: number;
  resolution_seconds: number;
}
export interface PrematchOptions {
  read?: (tokenId: string, cutoff: number) => Promise<unknown>;
  load?: (ids: string[]) => Promise<Record<string, PrematchRecord>>;
  save?: (records: PrematchRecord[]) => Promise<void>;
  now?: number;
}
