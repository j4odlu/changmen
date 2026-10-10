import { renderToString } from "@vue/server-renderer";
import { describe, expect, it } from "vitest";
import { createSSRApp } from "vue";
import Prompt from "./PmManualOrderPrompt.vue";

describe("pM manual order mode prompt", () => {
  it("shows both modes and defaults to FOK", async () => {
    const html = await renderToString(createSSRApp(Prompt, { context: "A vs B\n买入 A" }));
    expect(html).toMatch(/value="FOK" checked/); expect(html).not.toMatch(/value="GTC" checked/);
    expect(html).toContain("GTC"); expect(html).toContain("本次默认使用 FOK");
  });
  it("explains remaining GTC quantity without promising full execution", async () => {
    const html = await renderToString(createSSRApp(Prompt, { context: "A", modelValue: "GTC" }));
    expect(html).toMatch(/value="GTC" checked/); expect(html).toContain("未成交份额继续挂单");
    expect(html).toContain("已成交部分保留");
  });
  it("escapes match context", async () => {
    const html = await renderToString(createSSRApp(Prompt, { context: "<script>credential()</script>" }));
    expect(html).not.toContain("<script>"); expect(html).toContain("&lt;script&gt;");
  });
});
