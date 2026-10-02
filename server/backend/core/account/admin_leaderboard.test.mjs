import { beforeEach, describe, expect, it, vi } from "vitest";
import * as db from "@changmen/db";
import { checkActionAuth } from "../auth/action_permissions.js";
import { getAdminLeaderboardUsers, setAdminLeaderboardExcluded } from "./admin_leaderboard.js";

vi.mock("@changmen/db", () => ({
  fetchLeaderboardUsers: vi.fn(),
  setUserLeaderboardExcluded: vi.fn(),
}));

const admin = { id: "a1", role: "admin" };
describe("admin leaderboard settings", () => {
  beforeEach(() => vi.clearAllMocks());

  it("denies anonymous, ordinary users and team leaders on reads and writes", async () => {
    for (const caller of [null, { role: "user" }, { role: "leader" }]) {
      for (const action of ["Client_AdminLeaderboardUsers", "Client_AdminSetLeaderboardExcluded"])
        expect(checkActionAuth(action, caller)?.success).toBe(0);
      await expect(getAdminLeaderboardUsers(caller)).rejects.toThrow("无管理员权限");
      await expect(setAdminLeaderboardExcluded({ userId: "u1", excluded: true }, caller)).rejects.toThrow("无管理员权限");
    }
    expect(db.fetchLeaderboardUsers).not.toHaveBeenCalled();
    expect(db.setUserLeaderboardExcluded).not.toHaveBeenCalled();
  });

  it("returns only the settings fields and saves explicit true and false", async () => {
    vi.mocked(db.fetchLeaderboardUsers).mockResolvedValue([
      { id: "u1", user_name: "alice", leaderboard_excluded: true, metadata: { secret: "hidden" } },
    ]);
    expect(await getAdminLeaderboardUsers(admin)).toEqual([
      { userId: "u1", userName: "alice", isAdmin: false, excluded: true },
    ]);
    for (const input of [true, false, "true", "false", "1", "0"]) {
      const excluded = [true, "true", "1"].includes(input);
      vi.mocked(db.setUserLeaderboardExcluded).mockResolvedValue({ id: "u1", user_name: "alice", leaderboard_excluded: excluded });
      expect((await setAdminLeaderboardExcluded({ userId: "u1", excluded: input }, admin)).excluded).toBe(excluded);
      expect(db.setUserLeaderboardExcluded).toHaveBeenLastCalledWith("u1", excluded);
    }
  });

  it("rejects malformed inputs and propagates database failures", async () => {
    await expect(setAdminLeaderboardExcluded({ userId: "", excluded: true }, admin)).rejects.toThrow("请选择用户");
    await expect(setAdminLeaderboardExcluded({ userId: "u1", excluded: "invalid" }, admin)).rejects.toThrow("布尔值");
    expect(db.setUserLeaderboardExcluded).not.toHaveBeenCalled();
    vi.mocked(db.setUserLeaderboardExcluded).mockRejectedValue(new Error("数据库不可用"));
    await expect(setAdminLeaderboardExcluded({ userId: "u1", excluded: true }, admin)).rejects.toThrow("数据库不可用");
  });
});
