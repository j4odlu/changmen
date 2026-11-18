import { describe, expect, it } from "vitest";

import { checkActionAuth } from "./action_permissions.js";

describe("checkActionAuth", () => {
  it.each(["Client_AdminBetProfitAnalytics"])("reserves %s for administrators", (action) => {
    expect(checkActionAuth(action, { id: "u", role: "user" })).toMatchObject({ success: 0 });
    expect(checkActionAuth(action, { id: "l", role: "leader", teamId: "t" })).toMatchObject({ success: 0 });
    expect(checkActionAuth(action, { id: "a", role: "admin" })).toBeNull();
    expect(checkActionAuth(action, null)).toMatchObject({ code: "AUTH_REQUIRED" });
  });
  it("keeps the original EV analytics available to team leaders", () => {
    expect(checkActionAuth("Client_AdminValueBetAnalytics", { id: "l", role: "leader", teamId: "t" })).toBeNull();
    expect(checkActionAuth("Client_AdminValueBetAnalytics", { id: "a", role: "admin" })).toBeNull();
    expect(checkActionAuth("Client_AdminValueBetAnalytics", { id: "u", role: "user" })).toMatchObject({ success: 0 });
    expect(checkActionAuth("Client_AdminValueBetAnalytics", null)).toMatchObject({ code: "AUTH_REQUIRED" });
  });
  it("returns a stable AUTH_REQUIRED code for protected actions", () => {
    expect(checkActionAuth("Client_GetUserInfo", null)).toEqual({
      success: 0,
      code: "AUTH_REQUIRED",
      msg: "未登录",
      info: null,
    });
  });

  it("keeps refresh and logout public so they can classify their own token", () => {
    expect(checkActionAuth("Client_RefreshToken", null)).toBeNull();
    expect(checkActionAuth("Client_Logout", null)).toBeNull();
  });
});
