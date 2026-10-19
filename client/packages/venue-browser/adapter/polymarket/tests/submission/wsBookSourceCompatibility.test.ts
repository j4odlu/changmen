import { expect, test, vi } from "vitest";
import * as legacy from "@changmen/venue-browser/pm-book-diagnostics/shadowObserver";
import * as browser from "@changmen/venue-browser/pm-book-diagnostics/shadowObserver";
import { WsBookShadowRuntime as LegacyRuntime } from "../../submission/preflight/optimized/wsBook/bookRuntime";
import { WsBookShadowRuntime as BrowserRuntime } from "../../../browser/pm-book-diagnostics/bookRuntime";
import { pmOrderBookSource as legacySource } from "../../orderBookSource";
import { pmOrderBookSource as browserSource } from "../../../browser/pm-book-source";
import * as canonical from "../../../../pm-book-diagnostics/shadowObserver";
import { WsBookShadowRuntime as CanonicalRuntime } from "../../../../pm-book-diagnostics/bookRuntime";
import { pmOrderBookSource as hostSource } from "../../../browser/pm-book-source-host";
import { observePmMarketStream } from "../../realtime/marketStream";

test("legacy and browser paths share the same observer slot and HTTP completion", () => {
  expect(legacy.beginWsBookShadow).toBe(browser.beginWsBookShadow);
  expect(browser.beginWsBookShadow).toBe(canonical.beginWsBookShadow);
  expect(browser.registerWsBookShadowObserver).toBe(canonical.registerWsBookShadowObserver);
  const finish = vi.fn(), start = vi.fn(() => finish);
  const remove = browser.registerWsBookShadowObserver(start);
  try {
    const attempt = { tokenId: "1", gateway: "https://clob.polymarket.com", tick: false, proxied: false, role: "primary", leg: "left" };
    const complete = legacy.beginWsBookShadow(attempt);
    const raw = { price: 0.4 };
    complete(raw, false);
    expect(start).toHaveBeenCalledOnce();
    expect(finish).toHaveBeenCalledWith(raw, false);
  } finally { remove(); }
  legacy.beginWsBookShadow({ tokenId: "2", gateway: "", tick: false, proxied: false, role: "primary", leg: "right" })(undefined, true);
  expect(start).toHaveBeenCalledOnce();
});
test("compatibility entries keep one diagnostics runtime and readonly market source", () => {
  expect(LegacyRuntime).toBe(BrowserRuntime);
  expect(BrowserRuntime).toBe(CanonicalRuntime);
  expect(legacySource).toBe(browserSource);
  expect(browserSource).toBe(hostSource);
  expect(browserSource.observe).toBe(observePmMarketStream);
  expect(Object.isFrozen(browserSource)).toBe(true);
});
