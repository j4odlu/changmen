import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  disconnectObMqtt,
  handleObMqttMessage,
  setObMqttCollectPlatform,
  syncObMqttSubscriptionsForGetMatchs,
} from "./mqtt";
import type { ViewMatch } from "@changmen/client-core/models/match";
import type { CollectPlatformInfo } from "@changmen/api-contract";

const refreshObMatchMarkets = vi.hoisted(() => vi.fn());

const isVenueOdds = vi.hoisted(() => vi.fn());
const getVenueOddsEntry = vi.hoisted(() => vi.fn());
const saveVenueOdds = vi.hoisted(() => vi.fn());
const updateVenueBetLock = vi.hoisted(() => vi.fn());
const updateVenueOddsMessage = vi.hoisted(() => vi.fn());

vi.mock("@changmen/client-core/bridge/oddsAccess", () => ({
  isVenueOdds,
  getVenueOddsEntry,
  saveVenueOdds,
  updateVenueBetLock,
  updateVenueOddsMessage,
}));

vi.mock("./markets", () => ({
  refreshObMatchMarkets,
}));

describe("handleObMqttMessage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setObMqttCollectPlatform(null);
    isVenueOdds.mockReturnValue(false);
    getVenueOddsEntry.mockReturnValue(undefined);
  });

  test("saves known odds updates from market oddsUpdate messages", () => {
    isVenueOdds.mockImplementation((_platform: string, id: string) => id === "odd-1");
    getVenueOddsEntry.mockReturnValue({ betId: "market-old", side: "home" });

    handleObMqttMessage(
      "/market/oddsUpdate/123",
      JSON.stringify([
        { id: "odd-1", odd: "1.91", market_id: "market-1" },
        { id: "unknown", odd: "2.15", market_id: "market-2" },
      ]),
      12345,
    );

    expect(updateVenueOddsMessage).toHaveBeenCalledWith("OB", expect.any(String));
    expect(saveVenueOdds).toHaveBeenCalledOnce();
    expect(saveVenueOdds).toHaveBeenCalledWith(
      "OB",
      {
        id: "odd-1",
        odds: 1.91,
        isLock: false,
        betId: "market-1",
        side: "home",
        time: 12345,
      },
      "mqtt",
    );
  });

  test("locks markets from statusUpdate and suspended messages", () => {
    handleObMqttMessage("/market/statusUpdate/123", JSON.stringify([{ market_id: "m1" }]));
    handleObMqttMessage(
      "/market/suspended/123",
      JSON.stringify([{ market_id: "m2", suspended: 0 }]),
    );

    expect(updateVenueBetLock).toHaveBeenNthCalledWith(1, "OB", "m1", true);
    expect(updateVenueBetLock).toHaveBeenNthCalledWith(2, "OB", "m2", false);
  });

  test("ignores invalid payloads after recording the raw message", () => {
    handleObMqttMessage("/market/oddsUpdate/123", "not-json");

    expect(updateVenueOddsMessage).toHaveBeenCalledWith("OB", "not-json");
    expect(saveVenueOdds).not.toHaveBeenCalled();
    expect(updateVenueBetLock).not.toHaveBeenCalled();
  });
});

describe("syncObMqttSubscriptionsForGetMatchs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    disconnectObMqtt();
  });

  test("does not prepare OB markets before collector provides platform config", async () => {
    const match = { providers: { OB: "1001" } } as unknown as ViewMatch;

    await syncObMqttSubscriptionsForGetMatchs([match]);

    expect(refreshObMatchMarkets).not.toHaveBeenCalled();
  });

  test("reuses the latest OB collector platform config", async () => {
    const platform = {
      Gateway: "https://ob.example",
      BetName: "独赢",
    } as unknown as CollectPlatformInfo;
    const match = { providers: { OB: "1001" } } as unknown as ViewMatch;
    setObMqttCollectPlatform(platform);

    await syncObMqttSubscriptionsForGetMatchs([match]);

    expect(refreshObMatchMarkets).toHaveBeenCalledOnce();
    expect(refreshObMatchMarkets).toHaveBeenCalledWith(platform, "1001", match, expect.any(RegExp));
  });
});

describe("OB MQTT A8 parity source contracts", () => {
  const root = dirname(fileURLToPath(import.meta.url));

  test("mqtt handlers never call refreshOddsOnBets / scheduleMqttRefresh", () => {
    const mqtt = readFileSync(join(root, "mqtt.ts"), "utf8");
    // 注释可提主循环 refresh；禁止实际调用与 debounce 实现
    expect(mqtt).not.toMatch(/refreshOddsOnBets\s*\(/);
    expect(mqtt).not.toMatch(/scheduleMqttRefresh/);
    expect(mqtt).not.toMatch(/MQTT_REFRESH_DEBOUNCE/);
    expect(mqtt).toMatch(/saveVenueOdds/);
    expect(mqtt).toMatch(/updateVenueBetLock/);
    expect(mqtt).toMatch(/export function connectObMqtt\(\): void/);
  });

  test("collector connects MQTT without refreshOddsOnBets callback", () => {
    const collect = readFileSync(join(root, "collect.ts"), "utf8");
    expect(collect).toMatch(/connectObMqtt\(\)/);
    expect(collect).not.toMatch(/connectObMqtt\(\(\) =>/);
    expect(collect).not.toMatch(/refreshOddsOnBets\s*\(/);
    expect(collect).not.toMatch(/useMatchStore/);
  });
});
