import { describe, expect, it } from "vitest";
import { resolveBackendPageUrl } from "./apiBase";

describe("resolveBackendPageUrl", () => {
  it("本地同源部署使用相对 matcher 地址", () => {
    expect(resolveBackendPageUrl("/matcher/", "")).toBe("/matcher/");
  });

  it("生产分离部署使用 API Cookie 同源地址", () => {
    expect(resolveBackendPageUrl("/matcher/", "https://api.changmen.fun"))
      .toBe("https://api.changmen.fun/matcher/");
  });

  it("忽略 API base 中的路径并定位到后端根路径", () => {
    expect(resolveBackendPageUrl("matcher/", "https://api.example.com/gateway"))
      .toBe("https://api.example.com/matcher/");
  });
});
