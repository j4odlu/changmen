import { describe, expect, test } from "vitest";
import { upstreamRouteFromUrl } from "./directRealtimeStatus";

describe("upstreamRouteFromUrl", () => {
  test("treats 47.115.75.57 as A8", () => {
    expect(upstreamRouteFromUrl("wss://47.115.75.57/esport/ws/OB")).toBe("a8");
    expect(upstreamRouteFromUrl("wss://47.115.75.57/esport/ws/IA")).toBe("a8");
  });

  test("treats api.a8.to as A8", () => {
    expect(upstreamRouteFromUrl("wss://api.a8.to/esport/ws/TF?auth_token=x")).toBe("a8");
  });

  test("treats localhost as CHANGMEN forward", () => {
    expect(upstreamRouteFromUrl("http://localhost:5274")).toBe("changmen");
    expect(upstreamRouteFromUrl("http://127.0.0.1:3560")).toBe("changmen");
    expect(upstreamRouteFromUrl("http://localhost:5274", "changmen")).toBe("changmen");
  });

  test("treats platform source hosts as official", () => {
    expect(upstreamRouteFromUrl("wss://socket.ajj123.net/socket.io/")).toBe("official");
    expect(upstreamRouteFromUrl("wss://pro-dj-aws-mqtt.x7hsa3.com:8084/mqtt")).toBe("official");
    expect(upstreamRouteFromUrl("wss://cfsocket.365raylinks.com/socketcluster/")).toBe("official");
    expect(upstreamRouteFromUrl("wss://ob-mqtt.example/ws", "demo")).toBe("official");
  });
});
