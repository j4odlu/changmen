import { describe, expect, test } from "vitest";
import { buildTfWsUrl, nextTfWsHost, TF_WS_HOSTS } from "./wsConfig";

describe("tf/wsConfig", () => {
  test("TF_WS_HOSTS is empty after A8 removal", () => {
    expect(TF_WS_HOSTS).toEqual([]);
  });

  test("nextTfWsHost throws", () => {
    expect(() => nextTfWsHost()).toThrow(/TF A8 WebSocket/);
  });

  test("buildTfWsUrl throws", () => {
    expect(() => buildTfWsUrl("tok")).toThrow(/TF A8 WebSocket/);
  });
});
