import { renderToString } from "@vue/server-renderer";
import { createSSRApp, h } from "vue";
import { expect, it } from "vitest";
import OrderProfitLine from "./OrderProfitLine.vue";

it.each(["待确认", "待结算", "53", "-72", "0"])("renders the supplied profit %s without reinterpreting it", async profitText => {
  const html = await renderToString(createSSRApp(OrderProfitLine, {
    amountLabel: "买入金额", amountText: "72", profitText,
  }));
  expect(html.replace(/<[^>]*>/g, "")).toContain(`买入金额：72 盈亏：${profitText}`);
  expect(html).not.toContain("order__live-pnl");
});
it.each([
  ["positive", "+12", "pos"], ["negative", "-8", "neg"], ["neutral", "0", ""],
] as const)("keeps %s live P&L in the amount/profit line", async (livePnlTone, livePnlText, className) => {
  const html = await renderToString(createSSRApp(OrderProfitLine, {
    amountLabel: "回款", amountText: "80", profitText: "待结算", livePnlText, livePnlTone,
  }));
  const classes = html.match(/<span class="([^"]+)"/)![1]!.split(" ");
  expect(classes).toContain("order__live-pnl");
  if (className) expect(classes).toContain(className);
  else expect(classes).toEqual(["order__live-pnl"]);
  expect(html).toContain(`>${livePnlText}</span>`);
  expect(html).not.toContain("button");
});
it("preserves a caller's custom amount slot and escapes display text", async () => {
  const app = createSSRApp({ render: () => h(OrderProfitLine,
    { amountLabel: "申请金额", amountText: "100", profitText: "<未确认>" },
    { amount: () => h("strong", { class: "custom-amount" }, "自定义金额") }) });
  const html = await renderToString(app);
  expect(html).toContain('<strong class="custom-amount">自定义金额</strong>');
  expect(html).not.toContain("100");
  expect(html).toContain("&lt;未确认&gt;");
});
