import type { PlatformId } from "@changmen/api-contract";

export type OddsSaveSource = "mqtt" | "http";

/** 与 web `oddsStore.OddsEntry` 对齐 */
export interface VenueOddsEntry {
  id: string;
  odds: number;
  isLock: boolean;
  betId?: string;
  side?: "home" | "away";
  time: number;
  source?: OddsSaveSource;
  clobPrice?: number;
  /** [changmen 扩展] Predict.fun market id（下注拉 orderbook 用） */
  marketId?: string;
}

export interface VenueLimitEntry {
  value: number;
  payout?: number;
  expireTime?: number;
}

export interface OddsAccessBridge {
  read(platform: PlatformId, oddsId: string, fallback: number): number;
  save(platform: PlatformId, entry: VenueOddsEntry, source?: OddsSaveSource): void;
  clean(platform?: PlatformId): void;
  isOdds(platform: PlatformId, oddsId: string): boolean;
  getEntry(platform: PlatformId, oddsId: string): VenueOddsEntry | undefined;
  updateOddsLock(platform: PlatformId, oddsId: string, locked: boolean): void;
  updateBetLock(platform: PlatformId, betId: string, locked: boolean): void;
  updateMessage(platform: PlatformId, payload: string): void;
  getLimit(platform: PlatformId, oddsId: string): VenueLimitEntry | undefined;
  setLimit(
    platform: PlatformId,
    oddsId: string,
    value: number,
    payout?: number,
    ttlSec?: number,
  ): void;
}

const noopBridge: OddsAccessBridge = {
  read: (_p, _id, fallback) => fallback || 0,
  save: () => {},
  clean: () => {},
  isOdds: () => false,
  getEntry: () => undefined,
  updateOddsLock: () => {},
  updateBetLock: () => {},
  updateMessage: () => {},
  getLimit: () => undefined,
  setLimit: () => {},
};

let bridge: OddsAccessBridge = noopBridge;

export function registerOddsAccess(next: OddsAccessBridge): void {
  bridge = next;
}

export function clearOddsAccess(): void {
  bridge = noopBridge;
}

export function readVenueOdds(
  platform: PlatformId,
  itemId: string,
  fallback = 0,
): number {
  return bridge.read(platform, itemId, fallback) || 0;
}

export function saveVenueOdds(
  platform: PlatformId,
  entry: VenueOddsEntry,
  source: OddsSaveSource = "http",
): void {
  bridge.save(platform, entry, source);
}

/** `BetOption.updateOdds` 写入 fo 的薄封装 */
export function writeVenueOdds(platform: PlatformId, payload: {
  id: string;
  odds: number;
  betId: string;
  isLock?: boolean;
  time?: number;
}): void {
  saveVenueOdds(platform, {
    id: payload.id,
    odds: payload.odds,
    isLock: payload.isLock ?? false,
    betId: payload.betId,
    time: payload.time ?? Date.now(),
  });
}

export function cleanVenueOdds(platform?: PlatformId): void {
  bridge.clean(platform);
}

export function isVenueOdds(platform: PlatformId, oddsId: string): boolean {
  return bridge.isOdds(platform, oddsId);
}

export function getVenueOddsEntry(
  platform: PlatformId,
  oddsId: string,
): VenueOddsEntry | undefined {
  return bridge.getEntry(platform, oddsId);
}

export function updateVenueOddsLock(
  platform: PlatformId,
  oddsId: string,
  locked: boolean,
): void {
  bridge.updateOddsLock(platform, oddsId, locked);
}

export function updateVenueBetLock(
  platform: PlatformId,
  betId: string,
  locked: boolean,
): void {
  bridge.updateBetLock(platform, betId, locked);
}

export function updateVenueOddsMessage(platform: PlatformId, payload: string): void {
  bridge.updateMessage(platform, payload);
}

export function getVenueOddsLimit(
  platform: PlatformId,
  oddsId: string,
): VenueLimitEntry | undefined {
  return bridge.getLimit(platform, oddsId);
}

export function setVenueOddsLimit(
  platform: PlatformId,
  oddsId: string,
  value: number,
  payout?: number,
  ttlSec?: number,
): void {
  bridge.setLimit(platform, oddsId, value, payout, ttlSec);
}
