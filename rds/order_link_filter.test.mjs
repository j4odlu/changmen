import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  ARB_LINK_MIN,
  VALUE_BET_LINK_BASE,
  backendBindLinkFromCreateAt,
  CLIENT_ORDER_LIST_SQL,
  canRebindLinkNewerToOlder,
  isSameOrderMatchMap,
  normalizeOrderMatchKey,
  parseBetMapLabel,
  isArbBindLink,
  isConfirmedClientBindLink,
  isBackendBindPlaceholderLink,
  isClientOrderListVisible,
  isCreateAtPlaceholderLink,
  isHashLink,
  isInsertTimePlaceholderLink,
  isOrderListVisible,
  isPbHashOrder,
  isSingleLegRateLink,
  isValueBetLink,
  orderBelongsToMsRange,
  orderLinkSortKey,
  orderVisibleSqlAnd,
  placeholderLinkFromCreateAt,
  sqlOrderBelongsToRange,
  placeholderLinkFromInsertAt,
  shouldAllowOrderBind,
  shouldFireOrderBoundHook,
} from "./order_link_filter.js";

describe("order_link_filter", () => {
  it("isHashLink detects placeholder links", () => {
    assert.equal(isHashLink(12345), true);
    assert.equal(isHashLink(1_000_000_000_001), false);
    assert.equal(isHashLink(-1), false);
  });

  it("isPbHashOrder only matches PB hash orders", () => {
    assert.equal(isPbHashOrder(12345, "PB"), true);
    assert.equal(isPbHashOrder(12345, "OB"), false);
    assert.equal(isPbHashOrder(1_000_000_000_001, "PB"), false);
  });

  it("orderVisibleSqlAnd appends link filter", () => {
    assert.equal(orderVisibleSqlAnd("user_id = $1"), "user_id = $1 AND link < create_at");
    assert.equal(orderVisibleSqlAnd(""), "link < create_at");
  });

  it("isClientOrderListVisible uses link < create_at", () => {
    const ca = 1_781_890_412_000;
    assert.equal(isClientOrderListVisible(1_781_890_411_000, ca), true);
    assert.equal(isClientOrderListVisible(ca + 50_000, ca), false);
    assert.equal(isClientOrderListVisible(-ca, ca), true);
    assert.equal(CLIENT_ORDER_LIST_SQL, "link < create_at");
  });

  it("isOrderListVisible matches A8 JS helper (not SQL)", () => {
    assert.equal(isOrderListVisible(1_000_000_000_001, "PB"), true);
    assert.equal(isOrderListVisible(12345, "OB"), true);
    assert.equal(isOrderListVisible(12345, "PB"), false);
    assert.equal(isOrderListVisible(-1, "RAY"), true);
  });

  it("orderBelongsToMsRange uses Link bind time for timestamp links", () => {
    const bind = Date.parse("2026-09-04T23:46:13+08:00");
    const fill = Date.parse("2026-09-05T00:08:27+08:00");
    const dayStart = Date.parse("2026-09-04T00:00:00+08:00");
    const dayEnd = Date.parse("2026-09-05T00:00:00+08:00");
    const nextStart = dayEnd;
    const nextEnd = Date.parse("2026-09-06T00:00:00+08:00");
    assert.equal(orderBelongsToMsRange(bind, fill, dayStart, dayEnd), true);
    assert.equal(orderBelongsToMsRange(bind, fill, nextStart, nextEnd), false);
  });

  it("orderBelongsToMsRange falls back to create_at for small placeholder links", () => {
    const fill = Date.parse("2026-09-05T00:08:27+08:00");
    const dayStart = Date.parse("2026-09-04T00:00:00+08:00");
    const dayEnd = Date.parse("2026-09-05T00:00:00+08:00");
    const nextStart = dayEnd;
    const nextEnd = Date.parse("2026-09-06T00:00:00+08:00");
    assert.equal(orderBelongsToMsRange(42, fill, dayStart, dayEnd), false);
    assert.equal(orderBelongsToMsRange(42, fill, nextStart, nextEnd), true);
  });

  it("orderBelongsToMsRange decodes value-bet links", () => {
    const ts = Date.parse("2026-09-04T12:00:00+08:00");
    const vb = -(VALUE_BET_LINK_BASE + ts);
    const dayStart = Date.parse("2026-09-04T00:00:00+08:00");
    const dayEnd = Date.parse("2026-09-05T00:00:00+08:00");
    assert.equal(orderBelongsToMsRange(vb, ts + 86400000, dayStart, dayEnd), true);
  });

  it("sqlOrderBelongsToRange uses Link home then create_at fallback", () => {
    const sql = sqlOrderBelongsToRange(2, 3);
    assert.match(sql, /ABS\(link\) >= 1000000000000/);
    assert.match(sql, /7000000000000000/);
    assert.match(sql, /\$2/);
    assert.match(sql, /\$3/);
    assert.match(sql, /create_at >= \$2 AND create_at < \$3/);
  });

  it("placeholderLinkFromCreateAt uses create_at ms", () => {
    assert.equal(placeholderLinkFromCreateAt(1_781_882_462_790), 1_781_882_462_790);
    assert.equal(placeholderLinkFromCreateAt(0, 99), 99);
    assert.equal(placeholderLinkFromCreateAt("bad", 42), 42);
  });

  it("isCreateAtPlaceholderLink matches link === create_at", () => {
    const ca = 1_781_882_462_790;
    assert.equal(isCreateAtPlaceholderLink(ca, ca), true);
    assert.equal(isCreateAtPlaceholderLink(ca + 1, ca), false);
    assert.equal(isCreateAtPlaceholderLink(12345, ca), false);
  });

  it("backendBindLinkFromCreateAt is before create_at", () => {
    const ca = 1_781_882_462_790;
    assert.equal(backendBindLinkFromCreateAt(ca), ca - 1);
    assert.ok(backendBindLinkFromCreateAt(ca) < ca);
  });

  it("isBackendBindPlaceholderLink matches create_at - 1", () => {
    const ca = 1_781_882_462_790;
    assert.equal(isBackendBindPlaceholderLink(ca - 1, ca), true);
    assert.equal(isBackendBindPlaceholderLink(ca, ca), false);
    assert.equal(isBackendBindPlaceholderLink(ca - 2, ca), false);
  });

  it("placeholderLinkFromInsertAt uses insert ms", () => {
    assert.equal(placeholderLinkFromInsertAt(1_781_900_000_000), 1_781_900_000_000);
    assert.ok(placeholderLinkFromInsertAt(0) >= ARB_LINK_MIN);
  });

  it("isInsertTimePlaceholderLink requires link after create_at", () => {
    const ca = 1_781_882_462_790;
    assert.equal(isInsertTimePlaceholderLink(ca + 50_000, ca), true);
    assert.equal(isInsertTimePlaceholderLink(ca, ca), false);
    assert.equal(isInsertTimePlaceholderLink(ca - 1, ca), false);
  });

  it("shouldFireOrderBoundHook covers hash and create_at placeholders", () => {
    const arb = 1_700_000_000_123;
    assert.equal(
      shouldFireOrderBoundHook({ link: 12345, create_at: 1 }, arb),
      true,
    );
    const ca = 1_781_882_462_790;
    assert.equal(
      shouldFireOrderBoundHook({ link: ca, create_at: ca }, arb),
      true,
    );
    assert.equal(
      shouldFireOrderBoundHook({ link: ca - 1, create_at: ca }, arb),
      true,
    );
    assert.equal(
      shouldFireOrderBoundHook({ link: ca + 60_000, create_at: ca }, arb),
      true,
    );
    assert.equal(
      shouldFireOrderBoundHook({ link: arb, create_at: ca }, arb + 1),
      false,
    );
    assert.equal(shouldFireOrderBoundHook({ link: 12345 }, 99999), false);
  });

  it("isArbBindLink requires ms-scale link", () => {
    assert.equal(isArbBindLink(1_000_000_000_001), true);
    assert.equal(isArbBindLink(12345), false);
  });

  it("classifies value-bet and 9999 links", () => {
    const ts = 1_756_000_000_000;
    const vb = -(VALUE_BET_LINK_BASE + ts);
    const single = -ts;
    assert.equal(isValueBetLink(vb), true);
    assert.equal(isSingleLegRateLink(vb), false);
    assert.equal(isValueBetLink(single), false);
    assert.equal(isSingleLegRateLink(single), true);
    assert.equal(isConfirmedClientBindLink(vb), true);
    assert.equal(isConfirmedClientBindLink(single), true);
    assert.equal(isConfirmedClientBindLink(ts), true);
    assert.equal(isConfirmedClientBindLink(12345), false);
  });

  it("shouldAllowOrderBind refuses far link overwriting near arb link", () => {
    const ca = 1_783_195_621_000;
    const prevLink = 1_783_195_619_962;
    assert.equal(
      shouldAllowOrderBind({ link: prevLink, create_at: ca }, 1_783_199_338_220),
      false,
    );
    assert.equal(
      shouldAllowOrderBind({ link: ca, create_at: ca }, 1_700_000_000_123),
      true,
    );
    assert.equal(
      shouldAllowOrderBind({ link: 12345, create_at: ca }, 1_700_000_000_123),
      true,
    );
    assert.equal(
      shouldAllowOrderBind({ link: prevLink, create_at: ca }, prevLink),
      true,
    );
  });

  it("shouldAllowOrderBind allows makeup rebind from create_at-1 to inherited arb link", () => {
    // Shopify map2 makeup: PM create_at minutes after RAY attempt linkId
    const createAt = 1_783_645_770_000;
    const placeholder = createAt - 1;
    const inheritedArbLink = 1_783_645_508_532;
    assert.equal(
      shouldAllowOrderBind({ link: placeholder, create_at: createAt }, inheritedArbLink),
      true,
    );
    // final makeup: ~11 min later
    const createAt2 = 1_783_647_570_000;
    assert.equal(
      shouldAllowOrderBind(
        { link: createAt2 - 1, create_at: createAt2 },
        1_783_646_881_736,
      ),
      true,
    );
  });

  it("orderLinkSortKey and canRebindLinkNewerToOlder enforce newer→older", () => {
    const older = 1_700_000_000_100;
    const newer = 1_700_000_000_200;
    assert.equal(orderLinkSortKey(newer) > orderLinkSortKey(older), true);
    assert.equal(canRebindLinkNewerToOlder(newer, older), true);
    assert.equal(canRebindLinkNewerToOlder(older, newer), false);
    assert.equal(canRebindLinkNewerToOlder(newer, newer), false);
    assert.equal(canRebindLinkNewerToOlder(0, older), false);
  });

  it("isSameOrderMatchMap requires same match and map", () => {
    assert.equal(parseBetMapLabel("[地图2] 获胜"), "地图2");
    assert.equal(normalizeOrderMatchKey("B vs A"), normalizeOrderMatchKey("A vs B"));
    assert.equal(
      isSameOrderMatchMap(
        { match: "A vs B", bet: "[地图2] 获胜" },
        { match: "B vs A", bet: "[地图2] 让分" },
      ),
      true,
    );
    assert.equal(
      isSameOrderMatchMap(
        { match: "A vs B", bet: "[地图2] 获胜" },
        { match: "A vs B", bet: "[地图1] 获胜" },
      ),
      false,
    );
    assert.equal(
      isSameOrderMatchMap(
        {
          match: "LoL: Team Secret vs Karmine Corp - Game 2 Winner",
          bet: "地图2",
        },
        {
          match: "Team Secret vs Karmine Corp",
          bet: "[地图2]单局 - 获胜",
        },
      ),
      true,
    );
  });
});
