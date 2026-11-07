import { expect, test, vi } from "vitest";
import * as facade from "../../../browser/pm-book-diagnostics/shadowObserver";
import * as browser from "@changmen/venue-browser/pm-book-diagnostics/shadowObserver";
import { WsBookShadowRuntime as LegacyRuntime } from "@changmen/venue-browser/adapter/browser/pm-book-diagnostics/bookRuntime";
import { WsBookShadowRuntime as BrowserRuntime } from "../../../browser/pm-book-diagnostics/bookRuntime";
import { pmOrderBookSource as legacySource } from "@changmen/venue-browser/adapter/browser/pm-book-source";
import { pmOrderBookSource as browserSource } from "../../../browser/pm-book-source";
import * as canonical from "../../../../pm-book-diagnostics/shadowObserver";
import { WsBookShadowRuntime as CanonicalRuntime } from "../../../../pm-book-diagnostics/bookRuntime";
import { pmOrderBookSource as hostSource } from "../../../browser/pm-book-source-host";
import { observePmMarketStream } from "@changmen/venue-browser/polymarket/marketStream";

test("public, browser facade and source entries share the observer slot and HTTP completion", () => {
  for (const entry of [browser, facade]) {
    expect(Object.keys(entry).sort()).toEqual(Object.keys(canonical).sort());
    for (const [name, value] of Object.entries(canonical))
      expect((entry as Record<string, unknown>)[name], name).toBe(value);
  }
  const finish = vi.fn(), start = vi.fn(() => finish);
  const remove = browser.registerWsBookShadowObserver(start);
  try {
    const attempt = { tokenId: "1", gateway: "https://clob.polymarket.com", tick: false, proxied: false, role: "primary", leg: "left" };
    const complete = facade.beginWsBookShadow(attempt);
    const raw = { price: 0.4 };
    complete(raw, false);
    expect(start).toHaveBeenCalledOnce();
    expect(finish).toHaveBeenCalledWith(raw, false);
  } finally { remove(); }
  facade.beginWsBookShadow({ tokenId: "2", gateway: "", tick: false, proxied: false, role: "primary", leg: "right" })(undefined, true);
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
