import { readFileSync } from "node:fs";
import { runInNewContext, Script } from "node:vm";
import { describe, expect, it } from "vitest";

const html = readFileSync(new URL("./public/index.html", import.meta.url), "utf8");
const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const source = scripts.find(s => s.includes("function renderMatchedTable("));
function extract(name, nextName) {
  return source.slice(source.indexOf(`function ${name}(`), source.indexOf(`function ${nextName}(`));
}

function render(reverse) {
  const rows = [{ platform: "OB", home: "Alpha", away: "Beta", home_id: "a", away_id: "b" }];
  const cm = { id: 42, matchs: { OB: "1" }, reverse };
  const cells = [];
  const context = {
    rows, cm, cells,
    esc: String, pbadge: String, fmtTime: () => "time",
    renderMatchLinkCell: () => "match", renderVenueIdCell: () => "<td>venue</td>",
    renderTeamCell(m, side, _game, _maps, _platform, link) {
      cells.push({ name: m[side], id: m[`${side}_id`], side: link.side });
      return m[side];
    },
  };
  const output = runInNewContext(
    extract("renderReverseCell", "renderMatchedTable")
    + extract("renderMatchedTable", "renderMatchedCard")
    + "renderMatchedTable(rows, 'lol', {}, '', cm, {});", context,
  );
  return { output, cells, rows };
}

async function toggle({ reverse = ["OB"], refreshed = true, error = null } = {}) {
  const requests = [];
  const toasts = [];
  const button = { dataset: { cmId: "42", platform: "OB", reversed: "1" }, textContent: "主客反转", disabled: false };
  const context = {
    button, requests, toasts,
    fetchJson: async (url, options) => {
      requests.push({ url, body: JSON.parse(options.body) });
      return { res: { ok: !error }, data: error ? { error } : { ok: true } };
    },
    load: async options => {
      expect(options.bustCache).toBe(true);
      return refreshed ? { clientMatches: [{ id: 42, reverse }] } : undefined;
    },
    showActionToast: (message, type) => toasts.push({ message, type }),
    refreshMatcherStatus: async () => {},
  };
  await runInNewContext(
    "let _reverseSubmitting = false; async "
    + extract("toggleClientMatchPlatformReverse", "swapClientMatchGbLock").replace(/async\s*$/, "")
    + "toggleClientMatchPlatformReverse(button);", context,
  );
  return { requests, toasts, button };
}

describe("matcher reverse presentation", () => {
  it("keeps the page scripts syntactically valid", () => {
    for (const script of scripts) expect(() => new Script(script)).not.toThrow();
  });

  it("moves reversed teams and their IDs to the system sides without changing the native row", () => {
    const { output, cells, rows } = render(["OB"]);
    expect(cells).toEqual([
      { name: "Beta", id: "b", side: "home" },
      { name: "Alpha", id: "a", side: "away" },
    ]);
    expect(rows[0].home).toBe("Alpha");
    expect(output).toContain('class="reverse-row"');
    expect(output).toContain("已反转 · 生效中");
    expect(output).toContain('aria-pressed="true"');
    expect(output).toContain('data-reversed="0"');
    expect(output).toContain("场馆原始：主 Alpha / 客 Beta");
  });

  it("restores native order and the next action after reversal is removed", () => {
    const { output, cells } = render([]);
    expect(cells).toEqual([
      { name: "Alpha", id: "a", side: "home" },
      { name: "Beta", id: "b", side: "away" },
    ]);
    expect(output).toContain("正向 · 生效中");
    expect(output).toContain('aria-pressed="false"');
    expect(output).toContain('data-reversed="1"');
    expect(output).not.toContain('class="reverse-row"');
  });

  it("keeps the native away ID and canonical mapping on the displayed system home handle", () => {
    const context = {
      row: { platform: "OB", home: "Alpha", away: "Beta", teams: [{ id: "a" }, { id: "b" }] },
      window: {}, esc: String,
      normalizePlatformId: value => value == null ? null : String(value),
      normalizeTeamName: value => String(value || "").toLowerCase(),
      parseTeamsArray: m => m.teams,
      lookupCanonical: (_maps, _platform, id) => ({ canonical: id === "b" ? "22" : "11", pending: false }),
    };
    const output = runInNewContext(
      extract("resolveMatchTeamId", "lookupTeamMapEntry")
      + extract("renderTeamCell", "epochMs")
      + "renderTeamCell(row, 'away', 'lol', {}, 'OB', { cmId: 42, side: 'home' });", context,
    );
    expect(output).toContain('data-team-id="b"');
    expect(output).toContain('data-team-name="Beta"');
    expect(output).toContain('data-canonical-id="22"');
    expect(output).toContain('data-team-side="home"');
    expect(output).toContain('data-cm-id="42"');
  });

  it("preserves the reverse API payload and confirms the refreshed effective state", async () => {
    const { requests, toasts } = await toggle();
    expect(requests).toEqual([{ url: "/api/client-match/42/reverse", body: { platform: "OB", reversed: true } }]);
    expect(toasts[0].type).toBe("ok");
    expect(toasts[0].message).toContain("已生效");
  });

  it("warns when saved direction differs from the effective state", async () => {
    const { toasts } = await toggle({ reverse: [] });
    expect(toasts[0].type).toBe("warn");
    expect(toasts[0].message).toContain("当前生效方向仍为正向");
  });

  it("does not report effective success when the refresh fails", async () => {
    const { toasts } = await toggle({ refreshed: false });
    expect(toasts[0].type).toBe("warn");
    expect(toasts[0].message).not.toContain("已生效");
  });

  it("restores the button after a rejected write", async () => {
    const { button, toasts } = await toggle({ error: "写入失败" });
    expect(button.disabled).toBe(false);
    expect(button.textContent).toBe("主客反转");
    expect(toasts[0].type).toBe("err");
  });
});
