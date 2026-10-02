import { describe, expect, it } from "vitest";
import { observationFailureEvidence } from "./orderObservationEvidence";

describe("旁路失败证据", () => {
  it("classifies without copying credentials or raw responses", () => {
    const evidence = observationFailureEvidence("token=SECRET signature=PRIVATE", { code: "AUTH_FAILED", token: "SECRET" });
    expect(evidence.errorCategory).toBe("authentication");
    expect(evidence.responseCode).toBe("AUTH_FAILED");
    expect(JSON.stringify(evidence)).not.toMatch(/SECRET|PRIVATE|signature/);
  });
  it("only records actual Axios HTTP status, not venue business status", () => {
    expect(observationFailureEvidence("network", { status: 503 }).httpStatus).toBeUndefined();
    expect(observationFailureEvidence("network", undefined, { isAxiosError: true, response: { status: 503 } }).httpStatus).toBe(503);
    expect(observationFailureEvidence("network", undefined, { isAxiosError: true, response: { status: 999 } }).httpStatus).toBeUndefined();
  });
  it("rejects response codes containing arbitrary text and tolerates unreadable responses", () => {
    expect(observationFailureEvidence("timeout", { code: "SECRET token=abc" }).responseCode).toBeUndefined();
    expect(observationFailureEvidence("timeout", { get code() { throw new Error("bad getter"); } })).toEqual({});
  });
});
