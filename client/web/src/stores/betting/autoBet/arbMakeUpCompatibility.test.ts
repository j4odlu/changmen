import type { PlatformId } from "@/types/esport";
import type { ArbBetAttemptParams, ArbBetPlaced } from "./phases/types";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BetOption } from "@changmen/client-core/models/betOption";
import { BetResult } from "@changmen/client-core/models/betResult";
import { isPendingConfirmVenueProvider, isPolymarketProvider } from "@changmen/shared/account_multiply";
import { pmSubmissionFromResult } from "@changmen/shared/pm_submission";
import { LoseOrder } from "@/models/loseOrder";
import { PlatformAccount } from "@/models/platformAccount";
import { resolveMakeUpSuccessReference } from "@/stores/betting/makeUpReference";
import { createDefaultUserConfig } from "@/types/userConfig";
import { applyArbMakeUpFromRejects } from "./arbMakeUpFromRejects";
import { arbMakeUpSides } from "./arbMakeUpPair";
import { enqueueMakeUpOrder } from "./makeUp";

type EnqueueInput = Parameters<typeof enqueueMakeUpOrder>[0];
type Admission = "allowed" | "denied" | "error";
const bridge = vi.hoisted(() => ({ queue: {} as object, trace: [] as unknown[], admission: "allowed" as Admission,
  enqueue: vi.fn<(input: EnqueueInput) => Promise<boolean>>(),
}));
vi.mock("@/stores/loseOrderStore", () => ({ useLoseOrderStore: () => bridge.queue }));
vi.mock("./makeUp", () => ({ enqueueMakeUpOrder: (input: EnqueueInput) => bridge.enqueue(input) }));

const baseline = "86e722cc0e2498175cc167f95e63c25839dedaa0";
const original = execFileSync("git", ["show", `${baseline}:client/web/src/stores/betting/autoBet/arbMakeUpFromRejects.ts`], {
  cwd: fileURLToPath(new URL("../../../../../..", import.meta.url)), encoding: "utf8",
}).replaceAll("\r\n", "\n");
const exports: Partial<typeof import("./arbMakeUpFromRejects")> = {};
const dependencies: Record<string, unknown> = {
  "@changmen/shared/account_multiply": { isPendingConfirmVenueProvider, isPolymarketProvider },
  "@changmen/shared/pm_submission": { pmSubmissionFromResult },
  "@/models/loseOrder": { LoseOrder },
  "@/stores/betting/autoBet/arbMakeUpPair": { arbMakeUpSides },
  "@/stores/betting/autoBet/makeUp": { enqueueMakeUpOrder },
  "@/stores/betting/makeUpReference": { resolveMakeUpSuccessReference },
  "@/stores/loseOrderStore": { useLoseOrderStore: () => bridge.queue },
};
runInNewContext(ts.transpileModule(original, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
  { exports, Date, require: (id: string) => {
    if (!(id in dependencies)) throw new Error(`Unexpected original dependency: ${id}`);
    return dependencies[id];
  } });
const legacy = exports.applyArbMakeUpFromRejects!;

function result(provider: PlatformId, status: number, blankId: boolean): BetResult | undefined {
  if (status === 0) return undefined;
  const value = new BetResult(provider, status !== 1);
  value.orderId = blankId ? " " : `${provider}-original`;
  value.request = { order: { side: "BUY", makerAmount: "14250000" } };
  if (status === 3) value.reject = "timeout";
  if (status === 4) value.reject = "unfilled";
  if (status === 5) { value.success = false; value.pmSubmitUnknown = true; }
  return value;
}

function prepareQueue(params: ArbBetAttemptParams, existing: boolean, admission: Admission) {
  bridge.trace.length = 0;
  bridge.admission = admission;
  const orders = new Map<number, LoseOrder>();
  if (existing) orders.set(params.bet.id, new LoseOrder({ betId: params.bet.id }));
  bridge.queue = {
    orders,
    setPendingVenueOrder: (...args: unknown[]) => { bridge.trace.push(["pending", ...args]); },
    createOrder: (order: LoseOrder) => { orders.set(order.betId, order); bridge.trace.push(["create", order.toJSON()]); },
  };
  bridge.enqueue.mockImplementation(async (input) => {
    const { loseStore, match, bet, config, setMessage, ...payload } = input;
    bridge.trace.push(["enqueue", payload, {
      queue: loseStore === bridge.queue, match: match === params.match, bet: bet === params.bet,
      config: config === params.config, message: setMessage === params.setMessage,
    }]);
    if (bridge.admission === "error") throw new Error("admission unavailable");
    return bridge.admission === "allowed";
  });
  return orders;
}

describe("complete makeup orchestration compatibility", () => {
  beforeEach(() => { vi.spyOn(Date, "now").mockReturnValue(1_800_000_000_000); });
  afterEach(() => { vi.restoreAllMocks(); });

  it("uses the unmodified committed implementation as the independent comparison baseline", () => {
    expect(createHash("sha256").update(original).digest("hex"))
      .toBe("3c600fe9dbd20f482d01baeb895c14b5e49761c748d1b3dce8a9085dc0cc629d");
  });

  it("preserves results, queue operations, money and observation metadata for 9216 original-entry scenarios", async () => {
    const profiles: { providers: [PlatformId, PlatformId]; admission: Admission; existing?: boolean; missing?: "A" | "B"; blankId?: boolean }[] = [
      { providers: ["RAY", "OB"], admission: "allowed" },
      { providers: ["Polymarket", "PredictFun"], admission: "denied" },
      { providers: ["PredictFun", "Polymarket"], admission: "error" },
      { providers: ["Polymarket", "OB"], admission: "denied", existing: true },
      { providers: ["OB", "PredictFun"], admission: "error", existing: true },
      { providers: ["Polymarket", "PredictFun"], admission: "allowed", missing: "A" },
      { providers: ["Polymarket", "PredictFun"], admission: "allowed", missing: "B" },
      { providers: ["Polymarket", "PredictFun"], admission: "allowed", blankId: true },
    ];
    let count = 0;
    for (const profile of profiles) for (const betBothLegs of [false, true])
      for (const stateA of [0, 1, 2, 3, 4, 5]) for (const stateB of [0, 1, 2, 3, 4, 5])
        for (const rejectA of [false, true]) for (const rejectB of [false, true])
          for (const pendingA of [false, true]) for (const pendingB of [false, true]) {
            const [providerA, providerB] = profile.providers;
            const legA = new BetOption(providerA, "m1", "b1", "a", 14.25, "Home", 2.4);
            const legB = new BetOption(providerB, "m2", "b2", "b", 41.7, "Away", 1.8);
            for (const [side, leg] of [["A", legA], ["B", legB]] as const) {
              leg.newOdds = 9.9;
              leg.observation = Object.freeze({ executionId: "execution", attemptId: `attempt-${side}`, ownerUserId: "owner" });
              Object.freeze(leg);
            }
            const params = Object.freeze({
              match: { id: 1, title: "A vs B" }, bet: { id: 100, getBetName: () => "map1" },
              config: Object.freeze({ ...createDefaultUserConfig(), makeUp: count % 2 === 0 }), setMessage: vi.fn(),
            }) as unknown as ArbBetAttemptParams;
            const placed = Object.freeze({ legA, legB, betBothLegs, linkId: 1000,
              accountA: profile.missing === "A" ? undefined : new PlatformAccount({ accountId: 7, provider: providerA, currency: "USDT" }),
              accountB: profile.missing === "B" ? undefined : new PlatformAccount({ accountId: 8, provider: providerB, currency: "USDT" }),
              resultA: result(providerA, stateA, Boolean(profile.blankId)), resultB: result(providerB, stateB, Boolean(profile.blankId)),
            }) as ArbBetPlaced;
            const venue = { ordersA: [], ordersB: [] };
            const pending = Object.freeze({ pendingConfirmA: pendingA, pendingConfirmB: pendingB });
            const run = async (entry: typeof legacy) => {
              const orders = prepareQueue(params, Boolean(profile.existing), profile.admission);
              let output;
              let error;
              try { output = await entry(params, placed, rejectA, rejectB, venue, pending); }
              catch (caught) { error = (caught as Error).message; }
              return { output, error, trace: [...bridge.trace], orders: [...orders].map(([key, order]) => [key, order.toJSON()]) };
            };
            const expected = await run(legacy);
            expect(await run(applyArbMakeUpFromRejects)).toEqual(expected);
            count++;
          }
    expect(count).toBe(9216);
  });
});
