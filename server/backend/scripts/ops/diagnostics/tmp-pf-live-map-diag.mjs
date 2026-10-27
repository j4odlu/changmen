#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadChangmenEnv } from "@changmen/storage/load_env";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..");
const collector = path.join(root, "server/collectors/predictfun-collector");

loadChangmenEnv();

const api = await import(pathToFileURL(path.join(collector, "api.js")).href);
const parse = await import(pathToFileURL(path.join(collector, "parse.js")).href);

if (!api.resolvePredictFunApiKey()) {
  console.error("no PREDICT_FUN_API_KEY");
  process.exit(1);
}

const {
  fetchPredictCategories,
  fetchPredictOrderbooks,
  predictCollectStartTimeAllowed,
} = api;
const {
  bestAskFromPredictBook,
  buildPredictMappedMarket,
  isPredictEsportsMoneylineCategory,
  parsePredictGameMapNumber,
} = parse;

const raw = await fetchPredictCategories({ status: "OPEN" });
const esport = raw.filter(isPredictEsportsMoneylineCategory);
const inWindow = esport.filter((c) => {
  const startMs = c.startsAt ? Date.parse(c.startsAt) : 0;
  return predictCollectStartTimeAllowed(startMs);
});
console.log(`raw=${raw.length} esport=${esport.length} inWindow=${inWindow.length}`);

const marketIds = [];
for (const c of inWindow) {
  for (const m of c.markets ?? []) {
    if (m.id != null)
      marketIds.push(String(m.id));
  }
}
const books = await fetchPredictOrderbooks(marketIds);
const buyPrices = {};
for (const [id, book] of Object.entries(books)) {
  const ask = bestAskFromPredictBook(book);
  if (ask > 0 && ask < 1)
    buyPrices[id] = ask;
}

let withMaps = 0;
let withoutMaps = 0;
let childTitleButNoBet = 0;

for (const category of inWindow) {
  const markets = category.markets ?? [];
  const childTitles = [];
  for (const m of markets) {
    const mapNum = parsePredictGameMapNumber(m.title);
    const type = String(m.marketType || "");
    if (mapNum > 0 || type.includes("CHILD")) {
      childTitles.push({
        type,
        title: m.title,
        mapNum,
        trading: m.tradingStatus,
        status: m.status,
        outcomes: (m.outcomes || []).map((o) => ({
          name: o.name,
          team: o.team?.name || o.variantData?.team?.name || "",
        })),
      });
    }
  }
  const mapped = buildPredictMappedMarket(category, buyPrices);
  const betMaps = (mapped?.bets || []).map((b) => ({
    map: b.Map,
    name: b.Name || b.BetName || b.betName,
    home: b.HomeTeamName || b.HomeName || b.Home,
    away: b.AwayTeamName || b.AwayName || b.Away,
    ho: b.HomeOdds,
    ao: b.AwayOdds,
    keys: Object.keys(b).slice(0, 12).join(","),
  }));
  const hasMapBet = betMaps.some((b) => Number(b.map) > 0);
  if (hasMapBet)
    withMaps++;
  else
    withoutMaps++;
  if (childTitles.length && !hasMapBet)
    childTitleButNoBet++;

  const label = `${category.id} ${category.title || category.name || category.slug || ""}`;
  const interesting =
    childTitles.length > 0
    || /mcon|once upon|ouat/i.test(label + JSON.stringify(childTitles));
  if (!interesting)
    continue;

  console.log("\n====", label);
  console.log("variant", category.marketVariant, "startsAt", category.startsAt);
  console.log("child-ish markets:", childTitles.length);
  for (const t of childTitles)
    console.log(" ", JSON.stringify(t));
  console.log("mapped bets:", betMaps.length);
  for (const b of betMaps)
    console.log(" ", b);
  if (!mapped)
    console.log("mapped=NULL");
}

console.log(`\nsummary withMaps=${withMaps} withoutMaps=${withoutMaps} childTitleButNoBet=${childTitleButNoBet}`);
