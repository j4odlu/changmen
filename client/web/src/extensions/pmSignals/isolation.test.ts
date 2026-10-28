import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("PM signals isolation", () => {
  it("does not import or mutate existing odds, betting, EV, arb, or prematch gates", () => {
    const files = [
      "extensions/pmSignals/downDetector.ts",
      "extensions/pmSignals/upDetector.ts",
      "extensions/pmSignals/upSettings.ts",
      "extensions/pmSignals/records.ts",
      "extensions/pmSignals/downSettings.ts",
      "extensions/pmSignals/downVenueSnapshot.ts",
      "extensions/pmSignals/PmSignalsPanel.vue",
      "extensions/pmSignals/OddsSignalBadges.vue",
      "extensions/pmSignals/oddsBadges.ts",
      "extensions/pmSignals/SignalCard.vue",
      "extensions/pmSignals/useSignalMonitors.ts",
      "extensions/pmSignals/runtime.ts",
      "extensions/pmSignals/downMatchSignals.ts",
    ];
    const source = files
      .map(file => readFileSync(join(root, "src", file), "utf8"))
      .join("\n");

    expect(source).not.toMatch(/prematchFullOnly|setPrematchFullMode/);
    expect(source).not.toMatch(/oddsStore|saveVenueOdds|writeVenueOdds/);
    expect(source).not.toMatch(/bettingStore|placeValueBet|executeArbBet|valueBetAutoBet/);
    expect(source).not.toMatch(/registerPolymarketQuoteAssets/);
  });

  it("defers detection work beyond the synchronous PM quote callback", () => {
    const runtime = readFileSync(
      join(root, "src/extensions/pmSignals/runtime.ts"),
      "utf8",
    );
    const callbackStart = runtime.indexOf("function receivePmQuote(");
    const callbackEnd = runtime.indexOf("function scanReferenceVenue(", callbackStart);
    const listener = runtime.slice(callbackStart, callbackEnd);

    expect(listener).toMatch(/enqueueQuote/);
    expect(listener).not.toMatch(/(?:down|up)\.push\(/);
    expect(runtime).toMatch(/pendingQuotes\.push/);
    expect(runtime).toMatch(/setTimeout\(drainQuotes, 0\)/);
  });

  it("keeps one quote listener in the unified monitor and retires the two old monitor entries", () => {
    const runtime = readFileSync(join(root, "src/extensions/pmSignals/runtime.ts"), "utf8");
    expect(runtime.match(/onPolymarketMarketQuote\(/g)).toHaveLength(1);
    for (const file of ["pm_up", "pmOddsDropSignal"]) {
      expect(existsSync(join(root, "src/extensions", file))).toBe(false);
    }
    for (const file of ["upSettings.ts", "downSettings.ts", "records.ts"]) {
      const source = readFileSync(join(root, "src/extensions/pmSignals", file), "utf8");
      expect(source).not.toMatch(/onPolymarketMarketQuote|startPmUpMonitor|startPmOddsDropSignalMonitor|setInterval|setTimeout/);
    }
  });
});
