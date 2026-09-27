import { describe, expect, it } from "vitest";

import { checkActionAuth } from "./action_permissions.js";

describe("checkActionAuth", () => {
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
