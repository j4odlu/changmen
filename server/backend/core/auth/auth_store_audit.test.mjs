import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.hoisted(() => vi.fn());

vi.mock("../../../db/rds/common.js", () => ({
  getPgPool: () => ({ query }),
}));

const { recordAuthAudit } = await import("../../../db/rds/auth_store.js");

describe("recordAuthAudit", () => {
  beforeEach(() => {
    query.mockReset();
    query.mockResolvedValue({ rowCount: 1 });
  });

  it("stores only the session prefix and bounded request metadata", async () => {
    const ok = await recordAuthAudit({
      userId: "153f91c6-ce36-4014-8f9b-3612bbe4c0d1",
      userName: "GB15",
      eventType: "REFRESH",
      result: "SUCCESS",
      reasonCode: "",
      sessionId: "12345678-secret-session-tail",
      clientIp: "155.254.104.202",
      certCn: "gb15",
      userAgent: "x".repeat(700),
    });

    expect(ok).toBe(true);
    const params = query.mock.calls[0][1];
    expect(params[5]).toBe("12345678");
    expect(params[8]).toHaveLength(512);
    expect(JSON.stringify(params)).not.toContain("secret-session-tail");
  });

  it("does not break authentication when the audit insert fails", async () => {
    query.mockRejectedValue(new Error("audit table unavailable"));

    await expect(recordAuthAudit({ eventType: "LOGIN", result: "FAILED" })).resolves.toBe(false);
  });
});
