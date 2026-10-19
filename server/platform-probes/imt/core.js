"use strict";

const { getSportCode, getSportName } = require("./sport_ids.js");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseMapFromWs(ws) {
  if (!ws || ws.length !== 2) return 0;
  const row = ws[0];
  const text = row?.s || "";
  const m = /gamenr=(\d)/.exec(String(text));
  return m ? Number(m[1]) : 0;
}

function oddsKey(si, wsi) {
  return `${si}:${wsi}`;
}

function normalizeFullPayload(data) {
  const matches = [];
  const ale = data?.ale || [];
  for (const group of ale) {
    for (const sel of group.sels || []) {
      const matchId = `${sel.st}:${sel.eid}`;
      const stages = [];
      for (const ml of sel.mls || []) {
        const map = parseMapFromWs(ml.ws);
        if (map === 0) continue;
        const home = ml.ws?.find((w) => w.si === 707);
        const away = ml.ws?.find((w) => w.si === 708);
        if (!home || !away) continue;
        const marketId = `${map}:${ml.bti}:${ml.mi}`;
        stages.push({
          stageId: map,
          label: `地图${map}`,
          winMarketId: marketId,
          winHomeId: oddsKey(home.si, home.wsi),
          winAwayId: oddsKey(away.si, away.wsi),
          winHome: Number(home.o),
          winAway: Number(away.o),
          winLocked: Boolean(ml.il),
          betName: ml.btn || "",
        });
      }
      stages.sort((a, b) => a.stageId - b.stageId);

      const sportId = String(sel.st);
      matches.push({
        matchId,
        gameId: sportId,
        gameCode: getSportCode(sportId),
        gameName: getSportName(sportId),
        bo: 0,
        startTime: sel.edt ? new Date(sel.edt).getTime() : Date.now(),
        isLive: true,
        score: null,
        leagueName: sel.cn || sel.en || "",
        home: { id: String(sel.htid || ""), name: sel.htn || "主队" },
        away: { id: String(sel.atid || ""), name: sel.atn || "客队" },
        stages,
      });
    }
  }
  return {
    matches,
    delta: data?.d ?? null,
    sportIds: [...new Set(matches.map((m) => m.gameId))],
  };
}

function applyDeltaToDetail(detail, deltaRow) {
  if (!detail?.stages?.length) return false;
  let touched = false;
  for (const stage of detail.stages) {
    for (const w of deltaRow.ws || []) {
      const key = oddsKey(w.si, w.wsi);
      if (stage.winHomeId === key) {
        stage.winHome = Number(w.o);
        stage.winLocked = Boolean(deltaRow.il);
        touched = true;
      }
      if (stage.winAwayId === key) {
        stage.winAway = Number(w.o);
        stage.winLocked = Boolean(deltaRow.il);
        touched = true;
      }
    }
  }
  if (touched) {
    const first = detail.stages[0];
    detail.winHome = first?.winHome ?? detail.winHome;
    detail.winAway = first?.winAway ?? detail.winAway;
    detail.winLocked = detail.stages.some((s) => s.winLocked);
    detail.updatedAt = Date.now();
  }
  return touched;
}

function flattenDeltaChanges(data) {
  const changes = [];
  for (const block of data?.dc || []) {
    for (const row of block.v || []) {
      for (const ws of row.ws || []) {
        changes.push({
          oddsId: oddsKey(ws.si, ws.wsi),
          odd: Number(ws.o),
          locked: Boolean(row.il),
          row,
        });
      }
    }
  }
  return changes;
}

function registerOddsIndex(oddsIndex, matchId, stages) {
  for (const stage of stages) {
    if (stage.winHomeId) {
      oddsIndex[stage.winHomeId] = { matchId, side: "home", stageId: stage.stageId };
    }
    if (stage.winAwayId) {
      oddsIndex[stage.winAwayId] = { matchId, side: "away", stageId: stage.stageId };
    }
  }
}

function buildDetailFromMatch(match) {
  const detail = {
    stages: match.stages || [],
    winHome: null,
    winAway: null,
    winLocked: true,
    marketCount: (match.stages || []).length,
    updatedAt: Date.now(),
    error: null,
  };
  const first = detail.stages[0];
  if (first) {
    detail.winHome = first.winHome;
    detail.winAway = first.winAway;
    detail.winLocked = first.winLocked;
  }
  return detail;
}

module.exports = {
  sleep,
  normalizeFullPayload,
  applyDeltaToDetail,
  flattenDeltaChanges,
  registerOddsIndex,
  buildDetailFromMatch,
  oddsKey,
};
