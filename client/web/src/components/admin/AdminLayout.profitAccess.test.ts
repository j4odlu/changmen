import { describe, expect, it, vi } from "vitest";
import { createSSRApp, defineComponent, h } from "vue";
import { renderToString } from "@vue/server-renderer";
import AdminLayout from "./AdminLayout.vue";

const mock = vi.hoisted(() => ({ user: { isAdmin: false, userName: "leader" } }));
vi.mock("@/stores/userStore", () => ({ useUserStore: () => mock.user }));
vi.mock("vue-router", () => ({ useRoute: () => ({ name: "admin-ev-analytics" }), useRouter: () => ({ push: vi.fn() }) }));
vi.mock("element-plus/es/components/base/style/css", () => ({}));
vi.mock("element-plus/es/components/button/style/css", () => ({}));

async function render(admin: boolean) {
  mock.user.isAdmin = admin;
  const app = createSSRApp(AdminLayout);
  app.component("RouterLink", defineComponent({
    props: ["to"],
    setup(props, { slots }) { return () => h("a", { href: props.to.name }, slots.default?.()); },
  }));
  return renderToString(app);
}
describe("profit analysis navigation", () => {
  it("preserves the EV link for leaders and hides the combined admin profit link", async () => {
    const html = await render(false);
    expect(html).toContain('href="admin-ev-analytics"');
    expect(html).toContain("正EV分析");
    expect(html).not.toContain("下注盈利分析");
  });
  it("shows both links to administrators in the existing EV position", async () => {
    const html = await render(true);
    expect(html).toContain('href="admin-bet-profit-analytics"');
    expect(html.indexOf("数据分析")).toBeLessThan(html.indexOf("正EV分析"));
    expect(html.indexOf("正EV分析")).toBeLessThan(html.indexOf("下注盈利分析"));
  });
});
