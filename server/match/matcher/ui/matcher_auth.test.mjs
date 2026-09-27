import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { isMatcherSkipAuthEnabled } from "../lib/config.js";
import {
  canAccessMatcherUi,
  getRequestToken,
  isMatcherAuthBypassed,
  resolveMatcherUser,
} from "./matcher_auth.js";

const saved = { ...process.env };

afterEach(() => {
  process.env = { ...saved };
});

describe("isMatcherSkipAuthEnabled", () => {
  it("默认关闭", () => {
    delete process.env.MATCHER_SKIP_AUTH;
    delete process.env.NODE_ENV;
    assert.equal(isMatcherSkipAuthEnabled(), false);
  });

  it("显式 SKIP_AUTH=1 且 NODE_ENV=development 时开启", () => {
    process.env.MATCHER_SKIP_AUTH = "1";
    process.env.NODE_ENV = "development";
    assert.equal(isMatcherSkipAuthEnabled(), true);
  });

  it("sKIP_AUTH=1 但 NODE_ENV 未设置时不开启", () => {
    process.env.MATCHER_SKIP_AUTH = "1";
    delete process.env.NODE_ENV;
    assert.equal(isMatcherSkipAuthEnabled(), false);
  });

  it("production 下忽略 SKIP_AUTH", () => {
    process.env.MATCHER_SKIP_AUTH = "1";
    process.env.NODE_ENV = "production";
    assert.equal(isMatcherSkipAuthEnabled(), false);
  });
});

describe("isMatcherAuthBypassed", () => {
  it("与 isMatcherSkipAuthEnabled 一致", () => {
    process.env.MATCHER_SKIP_AUTH = "1";
    process.env.NODE_ENV = "test";
    assert.equal(isMatcherAuthBypassed(), isMatcherSkipAuthEnabled());
  });
});

describe("getRequestToken", () => {
  it("读取 token 头与 Bearer", () => {
    assert.equal(getRequestToken({ headers: { token: "abc" } }), "abc");
    assert.equal(getRequestToken({ headers: { authorization: "Bearer xyz" } }), "xyz");
    assert.equal(getRequestToken({ headers: { cookie: "app_token=tok%201" } }), "tok 1");
    assert.equal(getRequestToken({ headers: {} }), "");
  });
});

describe("resolveMatcherUser", () => {
  it("通过 HttpOnly 浏览器会话恢复 matcher 用户", async () => {
    delete process.env.AUTH_MODE;
    delete process.env.NODE_ENV;
    const calls = [];
    const req = {
      headers: {
        cookie: "cm_session=bs_test.secret",
        "user-agent": "matcher-test",
      },
      socket: { remoteAddress: "127.0.0.1" },
    };
    const result = await resolveMatcherUser(req, {
      authBrowserSession: async (sessionToken, audit) => {
        calls.push({ sessionToken, audit });
        return { accessToken: "restored-access" };
      },
      getUserByToken: async token => ({ userName: token, role: "admin" }),
    });

    assert.equal(result.user.userName, "restored-access");
    assert.equal(calls[0].sessionToken, "bs_test.secret");
    assert.equal(calls[0].audit.userAgent, "matcher-test");
  });

  it("保留显式 token 的旧版兼容路径", async () => {
    const result = await resolveMatcherUser(
      { headers: { token: "legacy-access", cookie: "cm_session=ignored" } },
      {
        authBrowserSession: async () => assert.fail("不应恢复浏览器会话"),
        getUserByToken: async token => ({ userName: token, role: "leader" }),
      },
    );
    assert.equal(result.user.userName, "legacy-access");
  });

  it("登录服务临时不可用时不会误报会话失效", async () => {
    delete process.env.AUTH_MODE;
    delete process.env.NODE_ENV;
    const result = await resolveMatcherUser(
      { headers: { cookie: "cm_session=bs_test.secret" }, socket: {} },
      {
        authBrowserSession: async () => ({ temporary: true }),
        getUserByToken: async () => assert.fail("不应查询用户"),
      },
    );
    assert.equal(result.temporary, true);
    assert.equal(result.user, null);
  });
});

describe("canAccessMatcherUi", () => {
  it("允许管理员和团队长访问 matcher", () => {
    assert.equal(canAccessMatcherUi({ role: "admin" }), true);
    assert.equal(canAccessMatcherUi({ role: "leader" }), true);
    assert.equal(canAccessMatcherUi({ isAdmin: true }), true);
  });

  it("拒绝普通用户访问 matcher", () => {
    assert.equal(canAccessMatcherUi({ role: "user" }), false);
    assert.equal(canAccessMatcherUi({}), false);
    assert.equal(canAccessMatcherUi(null), false);
  });
});
