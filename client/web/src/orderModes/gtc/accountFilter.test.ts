import { PlatformAccount } from "@/models/platformAccount";
import { describe, expect, it, vi } from "vitest";
import { gtcAccountAllows } from "./accountFilter";

vi.mock("@/stores/matchStore", () => ({
  useMatchStore: () => ({ getBetTarget: () => undefined }),
}));

describe("gTC manual account odds", () => {
  it.each([{ minOdds: 2 }, { maxOdds: 1.5 }])("only manual orders skip bounds: %j", (bounds) => {
    const account = new PlatformAccount({ accountId: 1, provider: "Polymarket", ...bounds });
    const leg = { odds: 1.8, target: "Away" } as never;
    expect(gtcAccountAllows(account, leg, { id: 1 } as never, {} as never, "owner", false)).toBe(false);
    expect(gtcAccountAllows(account, leg, { id: 1 } as never, {} as never, "owner", false, true)).toBe(true);
    account.pause = true;
    expect(gtcAccountAllows(account, leg, { id: 1 } as never, {} as never, "owner", false, true)).toBe(false);
  });
});
