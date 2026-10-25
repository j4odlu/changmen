import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import gameCatalog from "./game_catalog.json" with { type: "json" };
import sportsCatalog from "./game_catalog_sports.json" with { type: "json" };
import { getGameCodeForPlatformId } from "./game_catalog.ts";
import {
  getConfiguredPlatformDiscovery,
  getConfiguredPlatformGameIds,
  matchConfiguredPlatformGameText,
} from "./game_catalog_rules.ts";

const previousCommit = "84364793171244eca85378ef7bce3388f147b237";
const oldSource = (path: string) => execFileSync("git", ["show", `${previousCommit}:${path}`], { encoding: "utf8" });
const previousCatalog = JSON.parse(oldSource("packages/shared/catalog/game_catalog.json"));
const previousGameSource = oldSource("packages/shared/catalog/game_catalog.ts");

function loadCatalogModule(source: string, config: unknown) {
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports: Record<string, (...args: any[]) => any> = {};
  vm.runInNewContext(output, {
    exports,
    process: { env: {} },
    require(path: string) {
      if (path === "./game_catalog.json")
        return config;
      if (path === "./game_catalog_sports.json")
        return sportsCatalog;
      throw new Error(`Unexpected catalog dependency: ${path}`);
    },
  });
  return exports;
}

const previous = loadCatalogModule(previousGameSource, previousCatalog);
const stripSettings = (game: Record<string, unknown>) => {
  const { platformSettings: _settings, ...existing } = game;
  return existing;
};
const previousCodes = new Set(previousCatalog.games.map((game: { code: string }) => game.code));
assert.deepEqual(gameCatalog.games.filter(game => previousCodes.has(game.code)).map(stripSettings), previousCatalog.games,
  "all existing game identities and venue IDs are preserved");

const platforms = ["PB", "Stake", "Polymarket", "Limitless", "SXBet", "Azuro", "TF", "RAY", "OB", "PredictFun"];
const aliases = new Set<string>(["", "unknown", "nba", "1072082", "undefined"]);
for (const match of previousGameSource.matchAll(/const \w+_ALIASES:[^=]+?= (\{[\s\S]*?\n\});/g)) {
  for (const alias of Object.keys(vm.runInNewContext(`(${match[1]})`))) {
    for (const variant of [alias, alias.toUpperCase(), alias.toLowerCase(), ` ${alias}`, `${alias} `])
      aliases.add(variant);
  }
}
for (const game of [...previousCatalog.games, ...sportsCatalog.games]) {
  for (const id of Object.values(game.platforms ?? {}))
    aliases.add(String(id));
}
let comparisons = 0;
for (const platform of platforms) {
  for (const spelling of [platform, platform.toLowerCase(), ` ${platform} `]) {
    for (const alias of aliases) {
      // Missing venue IDs must not stringify into a match on a newly added game.
      if (alias === "undefined") {
        assert.equal(getGameCodeForPlatformId(spelling, alias), null);
        continue;
      }
      if (platform === "RAY" && alias === "1072082") {
        assert.equal(getGameCodeForPlatformId(spelling, alias), "basketball");
        continue;
      }
      assert.equal(getGameCodeForPlatformId(spelling, alias), previous.getGameCodeForPlatformId(spelling, alias),
        `${spelling}: original alias, casing and whitespace behavior for ${JSON.stringify(alias)}`);
      comparisons++;
    }
  }
}

assert.deepEqual(getConfiguredPlatformGameIds("RAY"), ["70", "151", "140", "74", "37197927", "1072082"]);
const pmDiscovery = getConfiguredPlatformDiscovery("Polymarket");
assert.deepEqual({ sportKeys: pmDiscovery.sportKeys.slice(0, 5), fallbackSeriesIds: pmDiscovery.fallbackSeriesIds.slice(0, 5) }, {
  sportKeys: ["cs2", "lol", "dota2", "hok", "val"],
  fallbackSeriesIds: ["10310", "10311", "10309", "10434", "10369"],
});
for (const key of ["nba", "wnba", "ncaab", "euroleague", "bkkbl", "bknbl", "bkfr1"])
  assert.ok(pmDiscovery.sportKeys.includes(key), `basketball discovery includes ${key}`);
assert.ok(pmDiscovery.fallbackSeriesIds.includes("10874"));
assert.ok(!pmDiscovery.sportKeys.includes("epl"));
assert.equal(matchConfiguredPlatformGameText("Polymarket", "bkkbl-dae-seo2-2026-10-25"), "basketball");
assert.deepEqual(getConfiguredPlatformGameIds("unknown"), []);
const ids = getConfiguredPlatformGameIds("RAY");
ids.length = 0;
assert.equal(getConfiguredPlatformGameIds("RAY").length, 6, "callers cannot mutate the collector scope");

// Replay the original PM parser's entire classification function, including precedence.
const oldParser = oldSource("server/collectors/polymarket-esports/parse.js");
const oldMapping = oldParser.slice(oldParser.indexOf("function tagsText"), oldParser.indexOf("function marketIdOf"));
const legacyPm = vm.runInNewContext(`(() => { ${oldMapping.replace("export ", "")} return mapPolymarketGameId; })()`);
const samples = ["league of legends", "LEAGUE-OF-LEGENDS", "lol", "dota", "dota2", "dota-2", "cs2", "csgo",
  "counter-strike", "counterstrike", "honor-of-kings", "king of glory", "kings of glory", "hok", "kog",
  "王者荣耀", "valorant", "VALORANT", "nba", "football", "val", "unknown", "lollipop", "cs2 lol",
  "valorant dota2", "kog cs2", "valorant 王者荣耀"];
for (const text of samples) {
  if (text === "nba") {
    assert.equal(matchConfiguredPlatformGameText("Polymarket", text), "basketball");
    continue;
  }
  assert.equal(matchConfiguredPlatformGameText("Polymarket", text), legacyPm({ question: text }),
    `original PM classification: ${text}`);
}

// A new configured game flows through generic collectors and recognition without venue code changes.
const rulesSource = readFileSync(new URL("./game_catalog_rules.ts", import.meta.url), "utf8");
const extended = structuredClone(gameCatalog) as { games: unknown[] };
extended.games.push({ code: "fixture-game", sport: "esport", platforms: { RAY: "fixture-ray", Polymarket: "fixture-pm" },
  platformSettings: { Polymarket: { aliases: ["fixture-alias"], collection: {
    sportKeys: ["fixture-sport"], fallbackSeriesIds: ["fixture-series"], textPattern: "\\bfixture-game\\b",
  } } } });
const configured = loadCatalogModule(rulesSource, extended);
assert.ok(configured.getConfiguredPlatformGameIds("RAY").includes("fixture-ray"));
assert.ok(configured.getConfiguredPlatformDiscovery("Polymarket").sportKeys.includes("fixture-sport"));
assert.ok(configured.getConfiguredPlatformDiscovery("Polymarket").fallbackSeriesIds.includes("fixture-series"));
assert.equal(configured.getConfiguredGameAlias("Polymarket", "fixture-alias"), "fixture-game");
assert.equal(configured.matchConfiguredPlatformGameText("Polymarket", "fixture-game A vs B"), "fixture-game");

console.log(`game_catalog_rules_smoke: ok (${comparisons} legacy alias comparisons)`);
