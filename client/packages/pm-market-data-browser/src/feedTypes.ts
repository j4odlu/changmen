import type { LocalOrderBook } from "./bookReducer";
import type { MarketStreamEvent } from "./marketStreamProtocol";

export interface BookFeedOptions {
  allowed: () => boolean;
  publish: (books: ReadonlyMap<string, LocalOrderBook>) => void;
  invalidate: (reason: string) => void;
  unavailable?: (assets: readonly string[], reason: string) => void;
  now?: () => number;
}
export interface BookFeed {
  setAssets(ids: readonly string[]): void;
  reset(reason: string, assets?: readonly string[]): void;
  stop(): void;
  accept?(event: MarketStreamEvent): void;
}
