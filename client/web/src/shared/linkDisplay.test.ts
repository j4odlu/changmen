import { describe, expect, it } from "vitest";
import {
  formatActiveBetLinkLabel,
  formatLinkIdFull,
  groupHasUnboundPlaceholder,
  isUnboundPlaceholderLink,
  resolveLinkKindBadge,
  resolveOrderGroupKindBadge,
} from "@/shared/linkDisplay";

describe("linkDisplay", () => {
  it("shows manual badges on active and persisted order groups", () => {
    const link = -(4e15 + 1_781_000_000_123);
    expect(resolveLinkKindBadge(link)).toMatchObject({ source: "manual", label: "手动" });
    expect(formatActiveBetLinkLabel(link)).toBe("Link 000123 · 手动");
    expect(resolveOrderGroupKindBadge([{ Link: link, Type: "Polymarket", OrderID: "manual" } as never])?.label).toBe("手动");
    expect(isUnboundPlaceholderLink(link)).toBe(false);
  });
  it("keeps OB single labels on active and historical order groups", () => {
    const link = -(5e15 + 1_781_000_000_123);
    expect(resolveLinkKindBadge(link)).toMatchObject({ source: "obSingle", label: "OB单边" });
    expect(formatActiveBetLinkLabel(link)).toBe("Link 000123 · OB单边");
    expect(resolveOrderGroupKindBadge([
      { Link: link, Type: "OB", OrderID: "ob1", Status: "Win" } as never,
    ])?.label).toBe("OB单边");
  });
  it("resolveLinkKindBadge maps arb/single/valueBet/hash", () => {
    expect(resolveLinkKindBadge(1_781_000_000_000)?.label).toBe("套利");
    expect(resolveLinkKindBadge(-1_781_000_000_000)?.label).toBe("单边");
    expect(resolveLinkKindBadge(-(7e15 + 1_781_000_000_000))?.label).toBe("正EV");
    expect(resolveLinkKindBadge(42)?.label).toBe("未绑单");
  });

  it("resolveOrderGroupKindBadge marks lone arb leg", () => {
    const link = 1_781_000_000_123;
    expect(resolveOrderGroupKindBadge([
      { Link: link, Type: "RAY", OrderID: "r1", Status: "Lose" } as never,
    ])?.label).toBe("套利·单腿");
    expect(resolveOrderGroupKindBadge([
      { Link: link, Type: "RAY", OrderID: "r1", Status: "Lose" } as never,
      { Link: link, Type: "OB", OrderID: "o1", Status: "Win" } as never,
    ])?.label).toBe("套利");
  });

  it("formatLinkIdFull keeps full number", () => {
    expect(formatLinkIdFull(1_781_000_000_123)).toBe("1781000000123");
    expect(formatLinkIdFull(-1_781_000_000_123)).toBe("-1781000000123");
    expect(formatLinkIdFull(0)).toBe("—");
  });

  it("formatActiveBetLinkLabel includes kind", () => {
    expect(formatActiveBetLinkLabel(1_781_000_000_123)).toContain("套利");
    expect(formatActiveBetLinkLabel(-1_781_000_000_123)).toContain("单边");
  });

  it("isUnboundPlaceholderLink detects create_at-1 and hash", () => {
    const ca = 1_781_000_000_500;
    expect(isUnboundPlaceholderLink(ca - 1, ca)).toBe(true);
    expect(isUnboundPlaceholderLink(ca, ca)).toBe(true);
    expect(isUnboundPlaceholderLink(999, ca)).toBe(true);
    expect(isUnboundPlaceholderLink(1_781_000_000_123, ca)).toBe(false);
  });

  it("groupHasUnboundPlaceholder", () => {
    expect(groupHasUnboundPlaceholder([
      { Link: 999, CreateAt: 1_781_000_000_500 } as never,
    ])).toBe(true);
    expect(groupHasUnboundPlaceholder([
      { Link: 1_781_000_000_123, CreateAt: 1_781_000_000_500 } as never,
    ])).toBe(false);
  });
});
