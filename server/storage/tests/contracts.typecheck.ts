import type { PolymarketMarketIndex, PredictFunMarketIndex, SxBetMarketIndex } from "@changmen/api-contract";
import { readJsonFile, writeJsonFile, setPlatform, loadChangmenEnv } from "@changmen/storage";
import { readPolymarketMarketIndex, writePolymarketMarketIndex } from "@changmen/storage/polymarket_market_index.js";
import { readPredictFunMarketIndex } from "@changmen/storage/predictfun_market_index.js";
import { readSxBetMarketIndex } from "@changmen/storage/sxbet_market_index.js";
import { readDevWebPort } from "@changmen/storage/dev_web_config.js";
import { CHANGMEN_LAYOUT } from "@changmen/storage/paths.js";

// @ts-expect-error preserve the readonly layout fields from the previous declaration file.
CHANGMEN_LAYOUT.serverDb = "moved";

const parsed = readJsonFile<{ enabled: boolean } | null>("config", null);
if (parsed) parsed.enabled satisfies boolean;
const fallback = readJsonFile("config", { version: 1 });
fallback.version satisfies number;
// @ts-expect-error JSON boundary types do not implicitly allow arbitrary properties.
fallback.missing;
writeJsonFile("config", { value: "fixture" });
const platform = setPlatform("OB", { token: "fixture" });
platform.provider satisfies string;
platform.updatedAt satisfies number;
loadChangmenEnv({ prepend: ["fixture.env"] });
// @ts-expect-error env file lists must be string arrays.
loadChangmenEnv({ prepend: "fixture.env" });
readDevWebPort("fixture", {}, "custom-platform") satisfies number;
readPolymarketMarketIndex() satisfies PolymarketMarketIndex | null;
readPredictFunMarketIndex() satisfies PredictFunMarketIndex | null;
readSxBetMarketIndex() satisfies SxBetMarketIndex | null;
// @ts-expect-error market index writes require the shared API contract.
writePolymarketMarketIndex({ invalid: true });
