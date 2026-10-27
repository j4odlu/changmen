import type { OptionalIdentityId } from "@changmen/match-identity/types";
import { swapBetSource } from "@changmen/matcher/compose/util/swap";
import { dedupeRowsById, mergeMatchs, scoreRowRichness } from "../compose/ids/dedupe_rows.ts";
import { startTimesCompatibleId, startTimesCompatibleName } from "../compose/util/time.ts";

// This file is checked by tsc, not executed by a test runner.
const swapped = swapBetSource({
  HomeID: "home", AwayID: 42, HomeOdds: 1.9, AwayOdds: 2.1,
  HomeMarketID: "market", AwayMarketID: null, providerMeta: { version: 1 },
});
const homeId: number = swapped.HomeID;
const awayId: string = swapped.AwayID;
const marketId: string = swapped.HomeMarketID;
const meta: { version: number } = swapped.providerMeta;
const absent: undefined = swapBetSource({ HomeID: "h" }).HomeID;
const nil: null = swapBetSource(null);
const text: "raw" = swapBetSource("raw" as const);
const callable = (id: number) => id;
const sameCallable: typeof callable = swapBetSource(callable);
// @ts-expect-error The incoming AwayID is numeric, so the projected HomeID is numeric.
const wrongSideId: string = swapped.HomeID;

const rows = [{ ID: "1", Matchs: { OB: "ob" }, Title: "", extra: { basis: "binding" }, Bets: [{ Sources: { OB: {} }, Map: 0 }] }];
const result = dedupeRowsById([...rows, null, undefined]);
const preservedMetadata: { basis: string } = result.list[0]!.extra;
const source: object = result.list[0]!.Bets[0]!.Sources.OB;
const mergedPlatformId: OptionalIdentityId = result.list[0]!.Matchs?.RAY;
mergeMatchs({ OB: 1 }, { OB: "2", RAY: null }, {
  prefer: "a",
  onConflict(platform, previous, incoming) {
    const p: string = platform;
    const a: string | number = previous;
    const b: OptionalIdentityId = incoming;
    void [p, a, b];
  },
});
// @ts-expect-error Platform source IDs remain strings or numbers, not nested objects.
mergeMatchs({ OB: { id: 1 } });
// @ts-expect-error A preference must select an existing side.
mergeMatchs({}, {}, { prefer: "newest" });
// @ts-expect-error Bets must retain the compose row array shape.
dedupeRowsById([{ ID: 1, Bets: {} }]);
const richness: number = scoreRowRichness(null);
const compatible: boolean = startTimesCompatibleId(undefined, "1800000000");
const nameCompatible: boolean = startTimesCompatibleName({}, null);
void [homeId, awayId, marketId, meta, absent, nil, text, sameCallable, wrongSideId, preservedMetadata, source, mergedPlatformId, richness, compatible, nameCompatible];
