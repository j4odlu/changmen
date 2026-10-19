import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  OB_A8_MQTT_PASSWORD,
  OB_A8_MQTT_USERNAME,
} from "./mqttConfig";
import { fetchObDemoMqttConfig, getObChangmenMqttConfig } from "./mqttSession";
import { changmenHttpBaseToWs, changmenDevBackendOrigin } from "../shared/changmenWsBase";

vi.mock("@changmen/client-core/shared/http", () => ({
  directGet: vi.fn(),
}));

import { directGet } from "@changmen/client-core/shared/http";

describe("getObChangmenMqttConfig", () => {
  test("builds ws-forward url with encoded upstream mqtt wss", () => {
    const base = changmenHttpBaseToWs(changmenDevBackendOrigin());
    expect(
      getObChangmenMqttConfig("wss://pro-dj-aws-mqtt.example:8084/mqtt", {
        clientId: "mqttjs_dj53795844534217162",
        memberId: "53795844534217162",
      }),
    ).toEqual({
      url: `${base}/esport/ws-forward/OB?u=wss%3A%2F%2Fpro-dj-aws-mqtt.example%3A8084%2Fmqtt`,
      username: OB_A8_MQTT_USERNAME,
      password: OB_A8_MQTT_PASSWORD,
      clientId: "mqttjs_dj53795844534217162",
      memberId: "53795844534217162",
      source: "changmen",
    });
  });
});

describe("fetchObDemoMqttConfig", () => {
  beforeEach(() => {
    vi.mocked(directGet).mockReset();
  });

  test("parses mqtt endpoint and builds official clientId from member uid", async () => {
    const addr = btoa(
      JSON.stringify({
        api: ["https://ob-api.example"],
        mqtt: ["wss://pro-dj-aws-mqtt.example:8084/mqtt"],
      }),
    );
    const pc = `https://entry.example/pc?token=login-token&addr=${encodeURIComponent(addr)}`;
    vi.mocked(directGet)
      .mockResolvedValueOnce({ data: { pc } })
      .mockResolvedValueOnce({ status: "true", data: { uid: "53795844534217162" } });

    await expect(fetchObDemoMqttConfig()).resolves.toEqual({
      url: "wss://pro-dj-aws-mqtt.example:8084/mqtt",
      username: OB_A8_MQTT_USERNAME,
      password: OB_A8_MQTT_PASSWORD,
      clientId: "mqttjs_dj53795844534217162",
      memberId: "53795844534217162",
      source: "demo",
    });
    expect(directGet).toHaveBeenNthCalledWith(2, "https://ob-api.example/game/balance", {
      device: "1",
      lang: "cn",
      token: "login-token",
    });
  });

  test("returns null when login has no mqtt endpoint", async () => {
    vi.mocked(directGet).mockResolvedValue({ data: { pc: "https://entry.example/pc?token=t" } });
    await expect(fetchObDemoMqttConfig()).resolves.toBeNull();
  });

  test("returns null when demo member uid cannot be resolved", async () => {
    const addr = btoa(
      JSON.stringify({
        api: ["https://ob-api.example"],
        mqtt: ["wss://pro-dj-aws-mqtt.example:8084/mqtt"],
      }),
    );
    const pc = `https://entry.example/pc?token=login-token&addr=${encodeURIComponent(addr)}`;
    vi.mocked(directGet)
      .mockResolvedValueOnce({ data: { pc } })
      .mockResolvedValueOnce({ status: "true", data: { balance: 88 } });

    await expect(fetchObDemoMqttConfig()).resolves.toBeNull();
  });
});
