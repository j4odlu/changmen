import { expect, test } from "vitest";
import { pmSubmitRejectionFromHttp } from "@changmen/shared/pm_submit_response";

test.each([400, 401, 403, 404, 422, 429])("official JSON rejection at %s can release a submission", status => {
  expect(pmSubmitRejectionFromHttp(status, JSON.stringify({ error: "FOK_ORDER_NOT_FILLED_ERROR" })))
    .toMatchObject({ success: false, errorMsg: "FOK_ORDER_NOT_FILLED_ERROR", pmSubmitRejected: true });
});
test.each([408, 500, 502, 503, 504, undefined])("HTTP %s alone cannot prove an order was rejected", status => {
  expect(pmSubmitRejectionFromHttp(status, { error: "internal error" })).toBeNull();
});
test("only the documented upstream order timed out is a safe 500 rejection", () => {
  expect(pmSubmitRejectionFromHttp(500, { error: "order timed out" })).not.toBeNull();
  expect(pmSubmitRejectionFromHttp(500, "timeout of 30000ms exceeded")).toBeNull();
  expect(pmSubmitRejectionFromHttp(400, "<html>gateway error</html>")).toBeNull();
  expect(pmSubmitRejectionFromHttp(400, { error: "failed", success: true, orderID: "accepted" })).toBeNull();
});

test.each([
  "Trading is currently disabled. Check polymarket.com for updates",
  "Trading is currently cancel-only. New orders are not accepted, but cancels are allowed.",
  "post-only mode: only post-only orders and cancels are allowed",
])("documented 503 refusal does not leave an unsent order locked: %s", (error) => {
  expect(pmSubmitRejectionFromHttp(503, { error })).toMatchObject({ success: false, errorMsg: error });
});

test("duplicate submission cannot establish that the original order was unfilled", () => {
  expect(pmSubmitRejectionFromHttp(400, { error: "order 0x123 is invalid. Duplicated." })).toBeNull();
});
