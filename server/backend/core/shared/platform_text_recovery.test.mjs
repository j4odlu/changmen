import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { compileBetName, normalizeListEvent } from "../../../platform-probes/ia/core.js";
import { stageLabel } from "@changmen/venue-node/runtime/ray/core.js";
import { stageFromTabName } from "../../../platform-probes/tf/core.js";
import { describeMarketStatus } from "@changmen/venue-node/runtime/ob/core.js";

const state = vi.hoisted(() => ({ platforms: new Map(), tf: { gateway: "https://example.invalid", token: "test", betName: "(独赢)", games: ["1"] } }));
vi.mock("../esport-api/store.js", () => ({ default: {
  setPlatform: (provider, value) => state.platforms.set(provider, value),
  getPlatform: provider => state.platforms.get(provider),
} }));
vi.mock("@changmen/storage/game_catalog", () => ({ getActivePlatformGameIds: () => ["1"] }));
vi.mock("./adapter_paths.js", () => ({ requirePlatform: () => ({
  getRayA8CollectCredentials: () => ({}),
  getTfA8CollectCredentials: async () => state.tf,
}) }));
import { syncTfFromEnv, syncTfFromLocal, syncTfFromSession, syncIaFromEnv } from "../esport-api/platform_sync.js";

beforeEach(() => state.platforms.clear());
afterEach(() => vi.unstubAllEnvs());

describe("platform text recovery", () => {
  it("TF environment credentials without a filter produce a usable browser regex", () => {
    vi.stubEnv("TF_GATEWAY", "https://example.invalid");
    vi.stubEnv("TF_TOKEN", "test");
    vi.stubEnv("TF_BET_NAME", "");
    expect(syncTfFromEnv()).toBe(true);
    expect(new RegExp(state.platforms.get("TF").betName).test("获胜者")).toBe(true);
    vi.stubEnv("TF_BET_NAME", "^独赢$");
    syncTfFromEnv();
    expect(state.platforms.get("TF").betName).toBe("^独赢$");
  });

  it("keeps explicit and cached TF filters ahead of the fallback", async () => {
    await syncTfFromLocal();
    expect(state.platforms.get("TF").betName).toBe(state.tf.betName);
    syncTfFromSession({ gateway: "https://example.invalid", token: "test", gameIds: ["1"] });
    expect(state.platforms.get("TF").betName).toBe(state.tf.betName);
  });

  it("IA default filters recognize Chinese winner markets and keep custom filters", () => {
    const filter = compileBetName({});
    expect(filter.test("[全场]A获胜")).toBe(true);
    expect(filter.test("[地图1]获胜者")).toBe(true);
    expect(filter.test("[全场]总击杀数")).toBe(false);
    expect(compileBetName({ betName: "^custom$" }).test("custom")).toBe(true);
    vi.stubEnv("IA_GATEWAY", "https://example.invalid");
    vi.stubEnv("IA_BET_NAME", "");
    syncIaFromEnv();
    expect(new RegExp(state.platforms.get("IA").betName).test("[全场]A获胜")).toBe(true);
    expect(normalizeListEvent({ id: 1, game_type_id: "1" }).home.name).toBe("主队");
  });

  it("returns readable stage and lock labels without changing numeric status rules", () => {
    expect(stageLabel(0)).toBe("全场");
    expect(stageLabel(2)).toBe("地图2");
    expect(stageFromTabName("MATCH").label).toBe("全场");
    expect(stageFromTabName("MAP 2").label).toBe("地图2");
    expect(describeMarketStatus({ status: 6, visible: 1, suspended: 0 })).toMatchObject({ locked: false, code: "open", label: "可投注" });
    expect(describeMarketStatus({ status: 9, visible: 1, suspended: 0 })).toMatchObject({ locked: true, code: "settled" });
  });
});

const root = fileURLToPath(new URL("../../../../", import.meta.url));
it.each([
  "server/backend/scripts/account_cli.js", "server/backend/scripts/check-collect-platforms.js",
  ...["collect_game_ids.js", "fetch_ob_live.js", "fetch_ob_login.js", "fetch_ob_mqtt.js", "fetch_ob_view.js", "ob_collect_hybrid.js", "probe_game_index.js", "probe_market_status.js", "test_odd_type_collect_live.mjs"].map(file => `server/platform-probes/ob/scripts/${file}`),
])("public CLI parses without executing I/O: %s", file => {
  const result = spawnSync(process.execPath, ["--check", path.join(root, file)], { encoding: "utf8", windowsHide: true });
  expect(result.stderr).toBe("");
  expect(result.status).toBe(0);
});
