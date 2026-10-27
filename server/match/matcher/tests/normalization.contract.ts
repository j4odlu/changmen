import { getGameCodeForPlatformId, describePlatformGame, resolveClientGame } from "@changmen/shared/catalog/game_catalog";
import { canonicalMatchKeyByIdOnly } from "@changmen/match-identity/teams/team_key.js";
import { collectPlatformEntries, canUseIdKey, canUseNameKey, pairKeyId, pairKeyName } from "../compose/normalize/platform_entry.ts";
import { cloneRawSource, nativeSourcesByMap, rawSourceForMap, sourceFromBet } from "@changmen/matcher/compose/normalize/native_bets";
import type { NativeBetSource, PlatformBetBuckets, SavedBetInput } from "../compose/normalize/types.ts";

// Compile-only boundary checks; no snapshot reads or application startup.
const snapshot = { SourceMatchID: 1, SourceGameID: null, Home: "A", Away: "B", extra: { version: 7 } };
const entries = collectPlatformEntries({ OB: { one: snapshot, missing: null } });
const id: string = entries[0]!.sourceMatchId;
const metadata: number = entries[0]!.nativeRow.extra.version;
const unknownGame: string | null = entries[0]!.gameCode;
const useId: boolean = canUseIdKey(entries[0]!);
const useName: boolean = canUseNameKey({ homeN: "a", awayN: "b" });
const key: string | null = pairKeyId(entries[0]!);
pairKeyName({ homeN: "a", awayN: "b", homeName: "A", awayName: "B", GameID: "3", gameCode: null });
collectPlatformEntries({ PB: [snapshot] as const });
getGameCodeForPlatformId("OB", undefined) satisfies string | null;
describePlatformGame("OB", null).gameCode satisfies string;
resolveClientGame("OB", null).GameID satisfies number;
canonicalMatchKeyByIdOnly(null, "A", "B", null);

const bet: SavedBetInput = { SourceBetID: 1, SourceHomeID: "h", HomeOdds: "1.9", Map: 0, OddTypeID: "type" };
const buckets: PlatformBetBuckets = { "OB:m": [bet] as const, "PB:m": { bets: [bet] as const } };
const native: NativeBetSource = sourceFromBet("OB", bet);
const odds: number = native.HomeOdds;
const cloned: NativeBetSource | null = cloneRawSource(native);
const selected: NativeBetSource | null = rawSourceForMap("OB", "m", 0, buckets, null);
const map: Map<number, NativeBetSource> = nativeSourcesByMap("OB", "m", buckets);
const partialOdds: string | number | null | undefined = cloneRawSource({ HomeOdds: "1.9" })?.HomeOdds;
// @ts-expect-error Raw source IDs remain scalar IDs, not nested records.
collectPlatformEntries({ OB: { one: { SourceMatchID: { id: 1 } } } });
// @ts-expect-error Raw odds accept numeric strings; objects are not stored odds.
sourceFromBet("OB", { HomeOdds: { value: 1.9 } });
// @ts-expect-error A platform bet bucket contains rows or an object with a row array.
nativeSourcesByMap("OB", "m", { "OB:m": { bets: {} } });
// @ts-expect-error A source projection has normalized string option IDs.
const numericOption: number = native.HomeID;
void [id, metadata, unknownGame, useId, useName, key, odds, cloned, selected, map, partialOdds, numericOption];
