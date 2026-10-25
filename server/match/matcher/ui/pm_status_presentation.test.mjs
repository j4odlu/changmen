import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import ts from "typescript";
import { clientMatchWithPmStatus } from "./matcher_data.js";
import { formatPmMatchStatus } from "./pm_match_status.js";

const html = readFileSync(new URL("./public/index.html", import.meta.url), "utf8");
function extract(name, next) {
  return html.slice(html.indexOf(`function ${name}(`), html.indexOf(`function ${next}(`));
}
const badge = extract("renderPmMatchStatus", "renderMatchedCard");
const esc = value => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");

function render(cm, ended = false, column = "id") {
  return runInNewContext(badge
    + (ended ? extract("renderEndedMatchCard", "renderHiddenPanel") : extract("renderMatchedCard", "collectUnmatchedRows"))
    + (ended ? "renderEndedMatchCard(cm, {}, {});" : "renderMatchedCard(cm, {}, {}, '', column);"), {
    cm, column, esc, fmtTime: value => `time:${value}`,
    resolveClientMatchRows: () => [{ platform: "Polymarket" }],
    clientMatchGameCode: () => "cs2", renderTitleTeamSlot: side => side,
    renderMatchedTable: () => "<table></table>", renderEndedMatchTable: () => "<table></table>",
    clientMatchTeamsFullyIdMapped: () => true, clientMatchNeedsAttention: () => false,
    renderMatchMergeTarget: () => "", pbadge: String, gbadge: String, formatVsTitle: esc,
  });
}

describe("matcher PM status presentation", () => {
  it("keeps the displayed state identical to the existing user-page formatter", () => {
    // 测试中对照用户页原实现；matcher 运行时不依赖客户端代码。
    const source = readFileSync(new URL("../../../../client/web/src/shared/pmSportDisplay.ts", import.meta.url), "utf8");
    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
    const userPage = {};
    runInNewContext(compiled, { exports: userPage, URL });
    const snapshots = [undefined, {}, { status: "scheduled" }, { status: "not_started" },
      { status: "postponed", live: true }, { status: "cancelled", ended: true },
      { status: "final", scoreRaw: "3-2", mapScore: { home: 3, away: 2 } },
      { status: "running", period: "2/3", elapsed: "89", scoreRaw: "8-5|1-0", mapScore: { home: 1, away: 0 } },
      { live: true, currentMap: 3, bo: 5, mapScore: { home: 0, away: 0 } },
      { status: "inprogress", period: "OT", elapsed: "12:34" }];
    for (const snapshot of snapshots)
      expect(formatPmMatchStatus(snapshot)).toEqual(userPage.formatPmMatchStatus(snapshot));
  });

  it.each(["id", "name", "ended"])("shows the stored PM state in the %s card header", column => {
    const cm = clientMatchWithPmStatus({ id: 42, start_time: 1, matchs: { Polymarket: "pm1" },
      pm_sport: { source: "ws", updatedAt: 123, status: "running", period: "2/3" } });
    const output = render(cm, column === "ended", column);
    expect(output).toContain('class="pm-match-status live"');
    expect(output).toContain("PM · 进行中 · 地图2/3");
    expect(output).toContain('title="数据来源：PM · 快照更新 time:123"');
  });

  it("shows waiting for linked PM without a snapshot, and no PM badge for other venues", () => {
    expect(render(clientMatchWithPmStatus({ matchs: { Polymarket: "pm1" } }))).toContain("PM · 状态待更新");
    expect(render(clientMatchWithPmStatus({ matchs: { OB: "ob1" } }))).not.toContain("pm-match-status");
  });

  it("escapes status text coming from the snapshot", () => {
    const cm = clientMatchWithPmStatus({ pm_sport: { live: true, period: '<img src=x onerror="bad">' } });
    const output = render(cm);
    expect(output).not.toContain("<img");
    expect(output).toContain("&lt;img src=x onerror=&quot;bad&quot;>");
  });
});
