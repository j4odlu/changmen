import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";

const html = readFileSync(new URL("./public/index.html", import.meta.url), "utf8");
const script = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1])
  .find(s => s.includes("function renderRayRiskMatches("));
function render(rows) {
  const elements = { "ray-risk-count": {}, "ray-risk-body": {} };
  const esc = script.slice(script.indexOf("function esc("), script.indexOf("function ", script.indexOf("function esc(") + 1));
  const renderSource = script.slice(script.indexOf("function renderRayRiskMatches("), script.indexOf("function renderStats("));
  runInNewContext(esc + renderSource + "renderRayRiskMatches(rows);", {
    rows, document: { getElementById: id => elements[id] }, fmtTime: () => "10-19 09:00",
  });
  return elements;
}

it("puts the anomaly section between statistics and the normal matcher board", () => {
  expect(html.indexOf('id="ray-risk-panel"')).toBeGreaterThan(html.indexOf('id="stats-bar"'));
  expect(html.indexOf('id="ray-risk-panel"')).toBeLessThan(html.indexOf('id="panel-main"'));
});

it("renders the match, time, native ID and close message while escaping venue text", () => {
  const output = render([{ title: '<img src=x onerror="alert(1)">', startTime: 1,
    rayMatchId: "910001", clientMatchId: 42, detailsAvailable: true }]);
  expect(output["ray-risk-count"].textContent).toBe(1);
  const body = output["ray-risk-body"].innerHTML;
  expect(body).toContain("10-19 09:00");
  expect(body).toContain("RAY #910001 · 本站 #42");
  expect(body).toContain("可能存在让局，此局关闭。");
  expect(body).toContain("&lt;img");
  expect(body).not.toContain("<img");
});

it("distinguishes no anomaly records from records whose collected details disappeared", () => {
  expect(render([])["ray-risk-body"].innerHTML).toContain("暂无异常比赛记录");
  const output = render([{ title: "RAY 比赛 #1", rayMatchId: "1", startTime: 0, detailsAvailable: false }]);
  expect(output["ray-risk-count"].textContent).toBe(1);
  expect(output["ray-risk-body"].innerHTML).toContain("当前采集资料已不可用，保留异常记录");
  expect(output["ray-risk-body"].innerHTML).toContain("未知");
});
