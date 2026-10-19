import { describe, expect, it } from "vitest";

import { formatPredictFunHeartbeatReply } from "./ws";

describe("predictfun ws heartbeat", () => {
  it("matches Predict.fun official echo format", () => {
    const ts = 1736696400000;
    expect(JSON.parse(formatPredictFunHeartbeatReply(ts))).toEqual({
      method: "heartbeat",
      data: ts,
    });
  });
});
