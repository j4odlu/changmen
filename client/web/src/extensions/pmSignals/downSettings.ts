import type { PmMarketWsSourceMode } from "@changmen/venue-browser/polymarket";
import type { PmOddsDropSignal } from "./downDetector";
import type { PmOddsDropVenueSnapshot } from "./downVenueSnapshot";
import type { BetSide } from "@/models/match";
import { normalizePmOddsDropSettings, type BrowserPmOddsDropSettings, type OddsDropReferenceVenue } from "@/config/pmSignalSettings";

const SETTINGS_KEY = "changmen:pm-odds-drop:settings:v1";

export interface OddsDropSelection {
  matchId: number;
  betId: number;
  side: BetSide;
}

export interface ReferenceVenueQuote {
  key: string;
  odds: number;
  selection: OddsDropSelection;
}

export interface BrowserPmOddsDropSignal extends PmOddsDropSignal {
  sourceMode: PmMarketWsSourceMode;
  referenceVenue: OddsDropReferenceVenue;
  selection: OddsDropSelection | null;
  /** 行情接收时捕获的只读快照，异步判定与后续变价不会改写历史 EV。 */
  venueSnapshot: PmOddsDropVenueSnapshot | null;
}

export type PmOddsDropSnapshotQuote = Pick<PmOddsDropSignal, "assetId" | "currentOdds">;

/** 在报价入队时捕获；不依赖随后异步检测才生成的涨跌幅、基线等字段。 */
export type PmOddsDropSnapshotResolver = (
  quote: PmOddsDropSnapshotQuote,
  referenceVenue: OddsDropReferenceVenue,
  selection: OddsDropSelection | null,
) => PmOddsDropVenueSnapshot | null;

export type ReferenceVenueQuoteReader = (
  venue: Exclude<OddsDropReferenceVenue, "Polymarket">,
) => ReferenceVenueQuote[];

/** 仅迁移旧本机配置；已保存的用户配置始终优先，不再写入旧 key。 */
export function readLegacyPmOddsDropSettings(): BrowserPmOddsDropSettings | undefined {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return undefined;
    const value: unknown = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value)
      ? normalizePmOddsDropSettings(value) : undefined;
  }
  catch { return undefined; }
}
