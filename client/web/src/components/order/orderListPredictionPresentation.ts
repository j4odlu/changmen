import type { OrderRow } from "@/types/order";
import type { useOrderListLiveQuotes } from "./controllers/useOrderListLiveQuotes";
import { isPmPendingOrder } from "@changmen/shared/pm_submission";
import { toFixed } from "@changmen/client-core/shared/format";
import {
  isPmOrderListRow, isPmSellOrderListRow, pmBuyLifecycleTagText, pmOrderFillPriceText,
  pmOrderSubmissionQuote, pmOrderOddsText, pmOrderPriceLabel, pmOrderProfitDisplayCny,
  pmOrderSharesText, pmOrderStakeDisplayCny,
} from "@/shared/pmOrderDisplay";
import {
  isPfOrderListRow, isPfSellOrderListRow, pfBuyLifecycleTagText, pfOrderFillPriceText,
  pfOrderOddsText, pfOrderPriceLabel, pfOrderProfitDisplayCny, pfOrderSharesText,
  pfOrderStakeDisplayCny, pfStakeLabel,
} from "@/shared/pfOrderDisplay";
import { isPendingRow, pmStakeLabel } from "./orderListPresentation";

interface AmountDisplay { amountLabel: string; amountText: string }
interface QuoteDisplay {
  sharesText?: string | null;
  priceLabel: string;
  priceText: string | null;
  oddsText: string;
  oddsTitle?: string;
  showOdds: boolean;
}
interface ProfitDisplay extends AmountDisplay {
  profitText: string;
  livePnlText: string | null;
  livePnlTone: "positive" | "negative" | "neutral";
}
interface LiveQuoteDisplay { showPrice: boolean; showOdds: boolean; priceText: string; oddsText: string }
type BaseDisplay = { venue: "pm" | "pf"; quote: QuoteDisplay };
export type PredictionDisplay = BaseDisplay & (
  { side: "sell"; amount: AmountDisplay & { sharesText: string | null } }
  | { side: "buy"; profit: ProfitDisplay; live: LiveQuoteDisplay }
);
type LiveQuotes = ReturnType<typeof useOrderListLiveQuotes>;
function pnlTone(value: number | null): ProfitDisplay["livePnlTone"] {
  return (value ?? 0) > 0 ? "positive" : (value ?? 0) < 0 ? "negative" : "neutral";
}

/** Assemble display values only. Money, lifecycle and quote rules remain in their original modules. */
export function predictionDisplay(row: OrderRow, peers: OrderRow[], live: LiveQuotes): PredictionDisplay | null {
  if (isPmOrderListRow(row)) {
    const amount = { amountLabel: pmStakeLabel(row), amountText: toFixed(pmOrderStakeDisplayCny(row), 0) };
    const priceText = pmOrderFillPriceText(row);
    const quote: QuoteDisplay = { priceLabel: pmOrderPriceLabel(row), priceText,
      oddsText: pmOrderOddsText(row), showOdds: !!priceText };
    if (isPmSellOrderListRow(row))
      return { venue: "pm", side: "sell", amount: { ...amount, sharesText: pmOrderSharesText(row) }, quote };
    const submission = pmOrderSubmissionQuote(row);
    const buyQuote: QuoteDisplay = submission
      ? { priceLabel: "提交限价", priceText: submission.priceText, oddsText: submission.oddsText,
        oddsTitle: "提交赔率 / 成交赔率", showOdds: true }
      : { ...quote, sharesText: pmOrderSharesText(row), showOdds: !row.PmGtcExecutionId || !!priceText,
        oddsTitle: row.PmGtcExecutionId ? undefined : "提交赔率 / 成交赔率" };
    return { venue: "pm", side: "buy", quote: buyQuote,
      profit: { ...amount,
        profitText: isPmPendingOrder(row) ? "待确认" : isPendingRow(row) && !pmBuyLifecycleTagText(row)
          ? "待结算" : toFixed(pmOrderProfitDisplayCny(row, peers) ?? 0, 0),
        livePnlText: live.pmLiveUnrealizedPnlText(row), livePnlTone: pnlTone(live.pmLiveUnrealizedPnlCny(row)) },
      live: { showPrice: live.pmShowLivePrice(row), priceText: live.pmLivePriceText(row),
        showOdds: live.pmShowLiveOdds(row), oddsText: live.pmLastLineOddsText(row) } };
  }
  if (isPfOrderListRow(row)) {
    const amount = { amountLabel: pfStakeLabel(row), amountText: toFixed(pfOrderStakeDisplayCny(row), 0) };
    const priceText = pfOrderFillPriceText(row);
    const quote: QuoteDisplay = { priceLabel: pfOrderPriceLabel(row), priceText,
      oddsText: pfOrderOddsText(row), showOdds: !!priceText };
    if (isPfSellOrderListRow(row))
      return { venue: "pf", side: "sell", amount: { ...amount, sharesText: pfOrderSharesText(row) }, quote };
    return { venue: "pf", side: "buy", quote: { ...quote, sharesText: pfOrderSharesText(row) },
      profit: { ...amount,
        profitText: isPendingRow(row) && !pfBuyLifecycleTagText(row)
          ? "待结算" : toFixed(pfOrderProfitDisplayCny(row) ?? 0, 0),
        livePnlText: live.pfLiveUnrealizedPnlText(row), livePnlTone: pnlTone(live.pfLiveUnrealizedPnlCny(row)) },
      live: { showPrice: live.pfShowLivePrice(row), priceText: live.pfLivePriceText(row),
        showOdds: live.pfShowLiveOdds(row), oddsText: live.pfLastLineOddsText(row) } };
  }
  return null;
}
