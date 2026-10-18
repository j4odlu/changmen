// Compile-only assertions: these must fail if the migration loses its contracts.
import type { CycleStats, MappedMarket } from "./types.ts";
import { buildPolymarketMappedMarket } from "./parse.ts";
import { fetchBatchBuyPrices } from "./api.ts";
import { runPolymarketEsportsDiscoveryCycle } from "./loop.ts";

function assertContracts(stats: CycleStats, mapped: MappedMarket): void {
  if (stats.skipped) {
    const reason: "filter_empty_with_typed_ml" = stats.reason;
    void reason;
    // @ts-expect-error skipped cycles do not report successful pruning
    void stats.pruned;
  }
  const assets: [string, string] = mapped.assetIds;
  void assets;
  // @ts-expect-error outcome sides must match the market index contract
  mapped.mapOutcome = "draw";
  // @ts-expect-error prices are normalized numeric probabilities
  void runPolymarketEsportsDiscoveryCycle({ fetchPrices: async () => ({ token: "0.5" }) });
  // @ts-expect-error official token results must be an array
  buildPolymarketMappedMarket({ tokens: "winner" });
  // @ts-expect-error CLOB price lookup needs token IDs, not numeric asset IDs
  void fetchBatchBuyPrices([123]);
}
void assertContracts;
