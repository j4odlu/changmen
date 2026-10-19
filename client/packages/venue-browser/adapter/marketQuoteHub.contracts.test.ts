/**
 * 电竞/体育热路径静态契约：防止「顺手清错 hub / 写错 fo」。
 * 与 marketQuoteHub.lifecycle.test.ts 一起作为合并闸门。
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const adapterRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(adapterRoot, "../../../..");
const webRoot = join(repoRoot, "client/web/src");

describe("esport/sport odds path isolation (source contracts)", () => {
  test("sportLiveOdds does not write fo", () => {
    const src = readFileSync(join(webRoot, "runtime/sportLiveOdds.ts"), "utf8");
    expect(src).not.toMatch(/from\s+["'][^"']*oddsAccess["']/);
    expect(src).not.toMatch(/saveVenueOdds\s*\(/);
    expect(src).not.toMatch(/useOddsStore/);
    expect(src).toMatch(/setPolymarketSportAssetIds/);
    expect(src).toMatch(/ensurePolymarketSportMarketConnection/);
    expect(src).toMatch(/clearPolymarketSportHub/);
    expect(src).toMatch(/setPredictFunSportMarketIds/);
    expect(src).toMatch(/sportOdds\.clear\(\)/);
  });

  test("HomeView MatchCard does not disable betting (esport)", () => {
    const src = readFileSync(join(webRoot, "views/HomeView.vue"), "utf8");
    expect(src).toMatch(/<MatchCard/);
    expect(src).not.toMatch(/:allow-betting="false"/);
  });

  test("SportMatchBoard disables betting and owns sportOddsStore", () => {
    const src = readFileSync(join(webRoot, "components/match/SportMatchBoard.vue"), "utf8");
    expect(src).toMatch(/:allow-betting="false"/);
    expect(src).toMatch(/useSportOddsStore/);
    expect(src).toMatch(/startSportLiveOddsSession/);
  });

  test("esport-freeze.json lists collect and fo/bet freeze paths", () => {
    const manifestPath = join(adapterRoot, "../../../../packages/venue-adapter/esport-freeze.json");
    expect(existsSync(manifestPath)).toBe(true);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    expect(manifest.allowEnv).toBe("ALLOW_ESPORT_TOUCH");
    expect(manifest.paths).toContain("packages/venue-adapter/polymarket/collect.ts");
    expect(manifest.paths).toContain("packages/venue-adapter/predictfun/collect.ts");
    expect(manifest.paths).toContain("client/web/src/stores/oddsStore.ts");
    expect(manifest.paths).toContain("client/web/src/stores/match/mainBetLoop.ts");
    expect(manifest.paths).toContain("packages/venue-adapter/polymarket/bet.ts");
    // hub / sport 不在冻结清单
    expect(manifest.paths).not.toContain("packages/venue-adapter/polymarket/marketQuoteHub.ts");
    expect(manifest.paths).not.toContain("packages/venue-adapter/polymarket/sportQuoteHub.ts");
  });
});
