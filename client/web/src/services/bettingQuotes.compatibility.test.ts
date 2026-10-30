import type { BetOption } from "@changmen/client-core/models/betOption";
import type { DetectionQuoteSource } from "@/domain/betting/quoteSource";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { afterEach, expect, it } from "vitest";
import * as pm from "@changmen/venue-browser/adapter/polymarket";
import * as pf from "@changmen/venue-browser/adapter/predictfun";
import * as platforms from "@changmen/venue-browser/adapter/shared";
import * as priceQuote from "@changmen/venue-browser/polymarket/priceQuote";
import * as tick from "@/domain/polymarket/tickBufferQuote";
import { attachPolymarketDetectionQuote } from "@/domain/polymarket/attachDetectionQuote";
import { attachPredictFunDetectionQuote } from "@/domain/predictfun/attachDetectionQuote";
import { buildPolymarketArbProgressMeta } from "@/domain/polymarket/arbProgressPmMeta";
import * as config from "@/config/valueBet";
import * as legacyConfig from "@/extensions/valueBet/evConfig";
import evidence from "../../../../scripts/verification/frontend-dependency-refactor.json";

const sha = (source: string) => createHash("sha256").update(source).digest("hex");

/** Run the complete, hash-bound pre-refactor source; no hand-written replica of its rules. */
function original<T>(relative: string, modules: Record<string, unknown>): T {
  const file = `client/web/src/${relative}`;
  const row = evidence.files.find(row => row.file === file)!;
  // Historical inputs come from their recorded revision so later business changes
  // remain testable against the same original behavior without rewriting hashes.
  const source = execFileSync("git", ["show", `${evidence.baseline}:${file}`], { encoding: "utf8", windowsHide: true }).replaceAll("\r\n", "\n");
  expect(sha(source)).toBe(row.beforeSha);
  const exports = {};
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  runInNewContext(output.outputText, { exports, require: (name: string) => {
    if (!(name in modules)) throw new Error(`Unbound original dependency: ${name}`);
    return modules[name];
  } });
  return exports as T;
}

let entry: { clobPrice?: number; odds?: number; isLock?: boolean; marketId?: string } | undefined;
let reads: string[] = [];
const quotes: DetectionQuoteSource = {
  getEntry: (provider, id) => { reads.push(`${provider}:${id}`); return entry; },
  getPmQuoteEntry: id => { reads.push(`snapshot:${id}`); return entry; },
};
const modules = {
  "@/stores/oddsStore": { useOddsStore: () => quotes },
  "@changmen/venue-browser/adapter/polymarket": pm,
  "@changmen/venue-browser/adapter/predictfun": pf,
  "@changmen/venue-browser/adapter/shared": platforms,
  "@changmen/venue-browser/polymarket/priceQuote": priceQuote,
};
const oldTick = original<typeof tick>("domain/polymarket/tickBufferQuote.ts", modules) as unknown as {
  capturePmPriceQuote: (option: BetOption) => void;
};
const oldPm = original<{ attachPolymarketDetectionQuote: (option: BetOption, scope: "esport" | "sport") => void }>(
  "domain/polymarket/attachDetectionQuote.ts", { ...modules, "./tickBufferQuote": oldTick });
const oldPf = original<{ attachPredictFunDetectionQuote: (option: BetOption) => void }>("domain/predictfun/attachDetectionQuote.ts", modules);
const oldMeta = original<{ buildPolymarketArbProgressMeta: (option: BetOption) => unknown }>("domain/polymarket/arbProgressPmMeta.ts", modules);

afterEach(() => { pm.resetPmArbPriceBufferPrefsForTests(); pm.clearPmTickBufferMetadata(); pf.resetPfArbPriceBufferPrefsForTests(); });

function option(type: string, odds: number, data: Record<string, unknown> | null): BetOption {
  return { type, itemId: "t", odds, data: structuredClone(data) } as BetOption;
}
function observe(leg: BetOption, run: () => unknown) {
  reads = [];
  let value: unknown;
  let error: string | undefined;
  try { value = run(); } catch (caught) { error = (caught as Error).message; }
  return { value, error, data: leg.data, reads: [...reads] };
}

it("preserves PM results, errors and lazy quote-read order in 432 original-input scenarios", () => {
  const policies = [{ enabled: false, multiplier: 1.01 }, { enabled: true, multiplier: 1.01 }, { enabled: true, multiplier: 1.01, mode: "tick" as const }];
  const entries = [undefined, { clobPrice: 0.5, odds: 2 }, { clobPrice: 0.5, odds: 2, isLock: true }, { clobPrice: 0.69, odds: 1.449 }];
  const data = [null, { detectionClobPrice: 0.5 }, { detectionOdds: 2, detectionMaxPrice: 0.5, detectionClobPrice: 0.5, tokenId: "t", side: "BUY" }];
  let cases = 0;
  pm.notePmTickBufferBook("t", { asset_id: "t", tick_size: "0.01" });
  for (const policy of policies) for (const row of entries) for (const scope of ["esport", "sport"] as const)
    for (const odds of [2, 1.980, 1.960]) for (const prior of data) for (const provider of ["Polymarket", "OB"]) {
      pm.setPmArbPriceBufferPrefs(policy); entry = row;
      const before = option(provider, odds, prior), after = option(provider, odds, prior);
      expect(observe(after, () => attachPolymarketDetectionQuote(after, quotes, scope)))
        .toEqual(observe(before, () => oldPm.attachPolymarketDetectionQuote(before, scope)));
      cases++;
    }
  expect(cases).toBe(432);
});

it("preserves frozen percentage and tick quotes after market and policy changes", () => {
  pm.notePmTickBufferBook("t", { asset_id: "t", tick_size: "0.01" });
  for (const mode of ["percent", "tick"] as const) {
    pm.setPmArbPriceBufferPrefs({ enabled: true, multiplier: 1.01, mode }); entry = { clobPrice: 0.5, odds: 2 };
    const before = option("Polymarket", mode === "tick" ? 1.960 : 1.980, null), after = option("Polymarket", before.odds, null);
    expect(observe(after, () => tick.capturePmPriceQuote(after, quotes))).toEqual(observe(before, () => oldTick.capturePmPriceQuote(before)));
    entry = { clobPrice: 0.7, odds: 1.428 };
    pm.setPmArbPriceBufferPrefs({ enabled: true, multiplier: 1.04, mode: mode === "tick" ? "percent" : "tick" });
    expect(observe(after, () => attachPolymarketDetectionQuote(after, quotes)))
      .toEqual(observe(before, () => oldPm.attachPolymarketDetectionQuote(before, "esport")));
    expect(after.data?.detectionClobPrice).toBe(mode === "tick" ? 0.51 : 0.505);
  }
});

it("preserves PF caps, market identity, existing locks and read order in 96 scenarios", () => {
  let cases = 0;
  for (const enabled of [false, true]) for (const row of [undefined, {}, { clobPrice: 0.55, marketId: "m1" }, { clobPrice: 0.6, marketId: "m2" }])
    for (const odds of [1.818, 1.666]) for (const data of [null, { marketId: "existing" }, { detectionClobPrice: 0.4 }]) for (const provider of ["PredictFun", "OB"]) {
      pf.setPfArbPriceBufferPrefs({ enabled, multiplier: 1.01 }); entry = row;
      const before = option(provider, odds, data), after = option(provider, odds, data);
      expect(observe(after, () => attachPredictFunDetectionQuote(after, quotes)))
        .toEqual(observe(before, () => oldPf.attachPredictFunDetectionQuote(before)));
      cases++;
    }
  expect(cases).toBe(96);
});

it("preserves progress metadata fallback values and read order", () => {
  for (const row of [undefined, { clobPrice: 0.68 }, { clobPrice: 0 }]) for (const data of [null, { detectionClobPrice: 0.68 }, { detectionOdds: 1.47, detectionMaxPrice: 0.68, bookPrice: 0.69, apiBetMoney: 35.5 }]) {
    entry = row;
    const before = option("Polymarket", 1.47, data), after = option("Polymarket", 1.47, data);
    expect(observe(after, () => buildPolymarketArbProgressMeta(after, quotes)))
      .toEqual(observe(before, () => oldMeta.buildPolymarketArbProgressMeta(before)));
  }
});

it("preserves historical EV exports and forwards all current configuration exports", () => {
  const old = original<Record<string, unknown>>("extensions/valueBet/evConfig.ts", {});
  // 业务可新增配置；历史 API 仍保留，旧入口必须完整转出当前唯一实现。
  expect(Object.keys(config)).toEqual(expect.arrayContaining(Object.keys(old)));
  expect(Object.keys(legacyConfig).sort()).toEqual(Object.keys(config).sort());
  for (const name of Object.keys(config) as (keyof typeof config)[]) expect(legacyConfig[name]).toBe(config[name]);
  expect(config.createDefaultValueBetSoftPlatforms()).toEqual((old.createDefaultValueBetSoftPlatforms as () => unknown)());
});
