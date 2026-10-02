import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

describe("matcher forbidden response display", () => {
  it("distinguishes CSRF rejection from insufficient role", () => {
    const window = { location: { pathname: "/matcher/" } };
    vm.runInNewContext(readFileSync(new URL("../../../match/matcher/ui/public/matcher_config.js", import.meta.url), "utf8"), {
      window, document: { cookie: "" }, localStorage: { getItem: () => null },
    });
    expect(window.matcherForbiddenMessage({ error: "CSRF_INVALID" })).toContain("请求校验失败");
    expect(window.matcherForbiddenMessage({ error: "forbidden", message: "需要团队长或管理员权限" })).toBe("需要团队长或管理员权限");
  });
});
