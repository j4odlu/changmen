import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useOddsStore } from "@/stores/oddsStore";
import { useSportOddsStore } from "@/stores/sportOddsStore";
import { PLATFORMS } from "@changmen/venue-browser/adapter/shared";

/**
 * 订单栏现价过滤逻辑的单测替身：与 OrderList bumpOrderLiveIfWatched 同语义。
 * （不挂载 Vue 组件，避免 OrderList 重依赖。）
 */
function makeOrderLiveGate(watched: () => Set<string>) {
  let tick = 0;
  const key = (platform: string, id: string) => `${platform}:${id}`;
  const bumpIfWatched = (platform: unknown, oddId: unknown) => {
    const id = String(oddId ?? "").trim();
    if (!id)
      return;
    if (watched().has(key(String(platform), id)))
      tick += 1;
  };
  return {
    get tick() {
      return tick;
    },
    attach(odds: ReturnType<typeof useOddsStore>, sport: ReturnType<typeof useSportOddsStore>) {
      const stopOdds = odds.$onAction(({ name, args, after }) => {
        after(() => {
          if (name === "save") {
            const entry = args[1] as { id?: unknown } | undefined;
            bumpIfWatched(args[0], entry?.id);
            return;
          }
          if (name === "updateOddsLock") {
            bumpIfWatched(args[0], args[1]);
            return;
          }
          if (name === "clean" && watched().size > 0)
            tick += 1;
        });
      });
      const stopSport = sport.$onAction(({ name, args, after }) => {
        after(() => {
          if (name === "save") {
            bumpIfWatched(args[0], args[1]);
            return;
          }
          if (name === "clear" && watched().size > 0)
            tick += 1;
        });
      });
      return () => {
        stopOdds();
        stopSport();
      };
    },
  };
}

describe("OrderList live price token gate", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("ignores fo saves for unrelated oddIds", () => {
    const watched = new Set([`${PLATFORMS.Polymarket}:tok-order`]);
    const gate = makeOrderLiveGate(() => watched);
    const odds = useOddsStore();
    const sport = useSportOddsStore();
    const stop = gate.attach(odds, sport);

    odds.save(PLATFORMS.OB, { id: "ob-1", odds: 1.9, isLock: false, time: Date.now() });
    odds.save(PLATFORMS.Polymarket, { id: "tok-other", odds: 1.5, isLock: false, time: Date.now() });
    expect(gate.tick).toBe(0);

    odds.save(PLATFORMS.Polymarket, {
      id: "tok-order",
      odds: 1.6,
      isLock: false,
      time: Date.now(),
      clobPrice: 0.62,
    });
    expect(gate.tick).toBe(1);

    stop();
  });

  it("reacts to sportOdds save for watched PF token only", () => {
    const watched = new Set([`${PLATFORMS.PredictFun}:pf-tok`]);
    const gate = makeOrderLiveGate(() => watched);
    const odds = useOddsStore();
    const sport = useSportOddsStore();
    const stop = gate.attach(odds, sport);

    sport.save(PLATFORMS.PredictFun, "other", 1.8);
    expect(gate.tick).toBe(0);
    sport.save(PLATFORMS.PredictFun, "pf-tok", 1.9);
    expect(gate.tick).toBe(1);

    stop();
  });

  it("bumps on clean when watches exist", () => {
    const watched = new Set([`${PLATFORMS.Polymarket}:tok`]);
    const gate = makeOrderLiveGate(() => watched);
    const odds = useOddsStore();
    const sport = useSportOddsStore();
    const stop = gate.attach(odds, sport);

    odds.clean(PLATFORMS.Polymarket);
    expect(gate.tick).toBe(1);

    stop();
  });
});
