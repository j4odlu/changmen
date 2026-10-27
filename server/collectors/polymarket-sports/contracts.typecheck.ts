import type { PmSportSnapshot, PmPrematchTokenSnapshot } from "@changmen/api-contract";
import type { CollectorPmSportSnapshot, CollectorPrematchRecord } from "@changmen/db";
import { writePmPrematchPrices } from "@changmen/db";
import { readPolymarketMarketIndex } from "@changmen/storage/polymarket_market_index";
import { buildPmSportSnapshot } from "./parse_sport.ts";
import { createPmSportStateWriter } from "./sport_state.ts";
import { pollLinkedGammaSportStates } from "./gamma_poll.ts";

// Compile-only assertions for the canonical DB/storage and public wire types.
function assertContracts(stored: CollectorPmSportSnapshot, record: CollectorPrematchRecord): void {
  const publicSnapshot: PmSportSnapshot = stored;
  const publicRecord: PmPrematchTokenSnapshot = record;
  const fromWire: CollectorPrematchRecord = publicRecord;
  const mapped: CollectorPmSportSnapshot = buildPmSportSnapshot({ live: true, elapsed: 0 });
  void [publicSnapshot, fromWire, mapped, readPolymarketMarketIndex];
  const apply = createPmSportStateWriter(async () => null);
  // @ts-expect-error only Gamma and WS are state producers
  void apply(1, { live: true }, "http", async () => true);
  // @ts-expect-error persisted scores are normalized numbers
  const badScore: CollectorPmSportSnapshot = { mapScore: { home: "1", away: 0 } };
  void badScore;
  // @ts-expect-error history records use the shared finite status set
  void writePmPrematchPrices([{ ...record, status: "live" }]);
  // @ts-expect-error linked client match IDs must be numbers
  void pollLinkedGammaSportStates(async () => true, { list: async () => [{ source_match_id: "pm", match_id: "1", home: "h", away: "a" }] });
}
void assertContracts;
