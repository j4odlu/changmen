import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { OB_A8_MQTT_PASSWORD, OB_A8_MQTT_USERNAME } from "./mqttConfig";
import { createObRealtimeClient, setObMqttSourceMode, type ObMqttMessage } from "./realtime";

const connectMock = vi.fn();
const fetchObDemoMqttConfig = vi.fn();
const getObChangmenMqttConfig = vi.fn();

vi.mock("mqtt", () => ({
  default: {
    connect: (...args: unknown[]) => connectMock(...args),
  },
}));

vi.mock("./mqttSession", () => ({
  fetchObDemoMqttConfig: (...args: unknown[]) => fetchObDemoMqttConfig(...args),
  getObChangmenMqttConfig: (...args: unknown[]) => getObChangmenMqttConfig(...args),
}));

function fakeMqttClient() {
  const handlers: Record<string, Array<(...args: unknown[]) => void>> = {};
  return {
    connected: false,
    on(event: string, fn: (...args: unknown[]) => void) {
      (handlers[event] ||= []).push(fn);
      return this;
    },
    removeAllListeners() {
      for (const key of Object.keys(handlers)) delete handlers[key];
    },
    end: vi.fn(),
    subscribe: vi.fn((_topic: string, cb?: () => void) => cb?.()),
    unsubscribe: vi.fn(),
    emit(event: string, ...args: unknown[]) {
      for (const fn of handlers[event] || []) fn(...args);
    },
  };
}

const demoConfig = {
  url: "wss://ob-mqtt.example/ws",
  username: OB_A8_MQTT_USERNAME,
  password: OB_A8_MQTT_PASSWORD,
  clientId: "mqttjs_dj53795844534217162",
  memberId: "53795844534217162",
  source: "demo" as const,
};

const changmenConfig = {
  url: "ws://127.0.0.1:3560/esport/ws-forward/OB?u=wss%3A%2F%2Fob-mqtt.example%2Fws",
  username: OB_A8_MQTT_USERNAME,
  password: OB_A8_MQTT_PASSWORD,
  clientId: "mqttjs_dj53795844534217162",
  memberId: "53795844534217162",
  source: "changmen" as const,
};

beforeEach(() => {
  fetchObDemoMqttConfig.mockReset();
  getObChangmenMqttConfig.mockReset();
  getObChangmenMqttConfig.mockReturnValue(changmenConfig);
  setObMqttSourceMode("demo");
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("createObRealtimeClient", () => {
  test("connects demo source with official member clientId and reconnectPeriod 5s", async () => {
    fetchObDemoMqttConfig.mockResolvedValue(demoConfig);
    const fake = fakeMqttClient();
    connectMock.mockReturnValue(fake);

    const received: ObMqttMessage[] = [];
    const client = createObRealtimeClient();
    await client.start((message) => received.push(message));
    fake.connected = true;
    fake.emit("connect");
    fake.emit("message", "/market/oddsUpdate/1", Buffer.from("[{}]"));
    await client.subscribe("/market/oddsUpdate/1");

    expect(connectMock).toHaveBeenCalledWith(
      "wss://ob-mqtt.example/ws",
      expect.objectContaining({
        username: OB_A8_MQTT_USERNAME,
        password: OB_A8_MQTT_PASSWORD,
        clientId: "mqttjs_dj53795844534217162",
        reconnectPeriod: 5000,
      }),
    );
    expect(received).toEqual([{ topic: "/market/oddsUpdate/1", payload: "[{}]" }]);
    expect(fake.subscribe).toHaveBeenCalledWith("/market/oddsUpdate/1", expect.any(Function));

    await client.stop();
  });

  test("falls back to CHANGMEN forward when demo connection errors", async () => {
    fetchObDemoMqttConfig.mockResolvedValue(demoConfig);
    const demoClient = fakeMqttClient();
    const changmenClient = fakeMqttClient();
    connectMock.mockReturnValueOnce(demoClient).mockReturnValueOnce(changmenClient);

    const client = createObRealtimeClient();
    await client.start(() => {});
    demoClient.emit("error", new Error("connection refused"));

    await vi.waitFor(() => {
      expect(connectMock).toHaveBeenCalledTimes(2);
    });

    expect(getObChangmenMqttConfig).toHaveBeenCalledWith(demoConfig.url, demoConfig);
    expect(connectMock).toHaveBeenNthCalledWith(
      2,
      changmenConfig.url,
      expect.objectContaining({
        username: OB_A8_MQTT_USERNAME,
        password: OB_A8_MQTT_PASSWORD,
        clientId: "mqttjs_dj53795844534217162",
        reconnectPeriod: 5000,
      }),
    );

    await client.stop();
  });

  test("cycles back to demo when CHANGMEN forward errors (no A8)", async () => {
    fetchObDemoMqttConfig.mockResolvedValue(demoConfig);
    const demoClient = fakeMqttClient();
    const changmenClient = fakeMqttClient();
    const demoRetry = fakeMqttClient();
    connectMock
      .mockReturnValueOnce(demoClient)
      .mockReturnValueOnce(changmenClient)
      .mockReturnValueOnce(demoRetry);

    const client = createObRealtimeClient();
    await client.start(() => {});
    demoClient.emit("error", new Error("refused"));
    await vi.waitFor(() => expect(connectMock).toHaveBeenCalledTimes(2));
    await new Promise((resolve) => setTimeout(resolve, 0));
    changmenClient.emit("error", new Error("refused"));

    await vi.waitFor(() => expect(connectMock).toHaveBeenCalledTimes(3));
    expect(connectMock).toHaveBeenNthCalledWith(
      3,
      demoConfig.url,
      expect.objectContaining({
        clientId: "mqttjs_dj53795844534217162",
      }),
    );

    await client.stop();
  });

  test("maps legacy a8 localStorage mode to demo", async () => {
    setObMqttSourceMode("a8" as never);
    fetchObDemoMqttConfig.mockResolvedValue(demoConfig);
    const demoClient = fakeMqttClient();
    connectMock.mockReturnValueOnce(demoClient);

    const client = createObRealtimeClient();
    await client.start(() => {});

    expect(connectMock).toHaveBeenCalledWith(demoConfig.url, expect.any(Object));
    expect(fetchObDemoMqttConfig).toHaveBeenCalled();

    await client.stop();
  });

  test("connects selected CHANGMEN source directly", async () => {
    setObMqttSourceMode("changmen");
    fetchObDemoMqttConfig.mockResolvedValue(demoConfig);
    const changmenClient = fakeMqttClient();
    connectMock.mockReturnValueOnce(changmenClient);

    const client = createObRealtimeClient();
    await client.start(() => {});

    expect(connectMock).toHaveBeenCalledOnce();
    expect(getObChangmenMqttConfig).toHaveBeenCalledWith(demoConfig.url, demoConfig);
    expect(connectMock).toHaveBeenCalledWith(
      changmenConfig.url,
      expect.objectContaining({
        clientId: "mqttjs_dj53795844534217162",
      }),
    );

    await client.stop();
  });

  test("stays on selected CHANGMEN source when connection fails", async () => {
    setObMqttSourceMode("changmen");
    fetchObDemoMqttConfig.mockResolvedValue(demoConfig);
    const changmenClient = fakeMqttClient();
    connectMock.mockReturnValueOnce(changmenClient);

    const client = createObRealtimeClient();
    await client.start(() => {});
    changmenClient.emit("error", new Error("refused"));

    await vi.waitFor(() => expect(connectMock).toHaveBeenCalledTimes(1));

    await client.stop();
  });
});
