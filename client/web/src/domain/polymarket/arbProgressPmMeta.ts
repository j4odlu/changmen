import type { BetOption } from "@changmen/client-core/models/betOption";
import type { ArbProgressPolymarketMeta } from "@/types/arbProgress";
import { PLATFORMS } from "@changmen/venue-browser/adapter/shared";
import type { DetectionQuoteSource } from "@/domain/betting/quoteSource";
import type { PolymarketBuyCheckData } from "@changmen/venue-browser/adapter/polymarket";
import {
  detectionMaxPriceFromOdds,
  hasLockedPolymarketDetectionQuote,
  isValidClobPrice,
  type PolymarketOptionQuoteData,
} from "@changmen/venue-browser/adapter/polymarket";

function shortenTokenId(tokenId: string): string {
  if (tokenId.length <= 16)
    return tokenId;
  return `${tokenId.slice(0, 6)}…${tokenId.slice(-5)}`;
}

function readQuoteData(option: BetOption): PolymarketOptionQuoteData & Partial<PolymarketBuyCheckData> {
  if (!option.data || typeof option.data !== "object")
    return {};
  return option.data as PolymarketOptionQuoteData & Partial<PolymarketBuyCheckData>;
}

function resolveCapSource(
  data: PolymarketOptionQuoteData,
  foClobPrice: number | undefined,
): ArbProgressPolymarketMeta["capSource"] {
  if (hasLockedPolymarketDetectionQuote(data))
    return "locked";
  if (isValidClobPrice(Number(data.detectionClobPrice ?? foClobPrice)))
    return "clob";
  return "odds";
}

/** PM 腿 Telegram 进度块：检测价 / fo clob / 盘口 ask */
export function buildPolymarketArbProgressMeta(option: BetOption, quotes: DetectionQuoteSource): ArbProgressPolymarketMeta {
  const data = readQuoteData(option);
  const foClobPrice = quotes.getEntry(PLATFORMS.Polymarket, option.itemId)?.clobPrice;
  const detectionOdds = Number(data.detectionOdds) > 1
    ? Number(data.detectionOdds)
    : option.odds;
  const detectionMaxPrice = Number(data.detectionMaxPrice ?? data.detectionClobPrice) > 0
    ? Number(data.detectionMaxPrice ?? data.detectionClobPrice)
    : isValidClobPrice(Number(foClobPrice ?? data.detectionClobPrice))
      ? Number(foClobPrice ?? data.detectionClobPrice)
      : detectionMaxPriceFromOdds(detectionOdds);

  return {
    tokenId: option.itemId,
    tokenShort: shortenTokenId(option.itemId),
    detectionOdds,
    detectionMaxPrice,
    foClobPrice: isValidClobPrice(Number(foClobPrice)) ? Number(foClobPrice) : undefined,
    bookPrice: Number.isFinite(Number(data.bookPrice)) ? Number(data.bookPrice) : undefined,
    apiBetMoney: Number.isFinite(Number(data.apiBetMoney)) ? Number(data.apiBetMoney) : undefined,
    capSource: resolveCapSource(data, foClobPrice),
  };
}
