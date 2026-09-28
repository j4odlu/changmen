import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("pm odds drop signal isolation", () => {
  it("does not import or mutate existing odds, betting, EV, arb, or prematch gates", () => {
    const files = [
      "extensions/pmOddsDropSignal/detector.ts",
      "extensions/pmOddsDropSignal/runtime.ts",
      "extensions/pmOddsDropSignal/venueSnapshot.ts",
      "extensions/pmOddsDropSignal/PmOddsDropSignalPanel.vue",
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
      join(root, "src/extensions/pmOddsDropSignal/runtime.ts"),
      "utf8",
    );
    const callbackStart = runtime.indexOf("const unsubscribe = onPolymarketMarketQuote");
    const callbackEnd = runtime.indexOf("\n  });", callbackStart);
    const listener = runtime.slice(callbackStart, callbackEnd);

    expect(listener).toMatch(/enqueueQuote/);
    expect(listener).not.toMatch(/activeDetector\.push/);
    expect(runtime).toMatch(/pendingQuotes\.push/);
    expect(runtime).toMatch(/setTimeout\(drainQuotes, 0\)/);
  });

  it("defaults monitoring off and exits before registering listeners or timers", () => {
    const runtime = readFileSync(
      join(root, "src/extensions/pmOddsDropSignal/runtime.ts"),
      "utf8",
    );
    const monitorStart = runtime.indexOf("export function startPmOddsDropSignalMonitor");
    const listenerStart = runtime.indexOf("const unsubscribe = onPolymarketMarketQuote", monitorStart);
    const preRegistration = runtime.slice(monitorStart, listenerStart);

    expect(runtime).toMatch(/enabled: false/);
    expect(preRegistration).toMatch(/if \(!pmOddsDropSettings\.value\.enabled\)/);
    expect(preRegistration).toMatch(/return \(\) => \{\};/);
  });
});
