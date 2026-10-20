import { describe, expect, it } from "vitest";
import { resolveCanonicalTeamName } from "../teams/canonical_ob_name.js";

describe("canonical_ob_name", () => {
  it("prefers OB platform_name over stored canonical name", () => {
    expect(resolveCanonicalTeamName("OB 队名", "RAY 队名")).toBe("OB 队名");
  });

  it("falls back to stored name when OB name missing", () => {
    expect(resolveCanonicalTeamName(null, "Stored")).toBe("Stored");
    expect(resolveCanonicalTeamName("", "Stored")).toBe("Stored");
  });

  it("ignores placeholder OB names", () => {
    expect(resolveCanonicalTeamName("主队", "Real Team")).toBe("Real Team");
    expect(resolveCanonicalTeamName("Unknown", "Real Team")).toBe("Real Team");
  });
});
