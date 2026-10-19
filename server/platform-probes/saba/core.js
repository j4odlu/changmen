"use strict";

const crypto = require("crypto");

const BET_TYPES = {
  20: "Moneyline",
  9001: "Map X Moneyline",
};

function extractEsField(html, field) {
  const re = new RegExp(`ES\\.${field}\\s*=\\s*(.+);`);
  const m = re.exec(html);
  return m ? m[1].trim() : null;
}

function parseEsUrl(raw) {
  if (!raw) return null;
  let text = raw.replace(/^["']|["']$/g, "");
  try {
    const obj = JSON.parse(text);
    if (obj?.p) return String(obj.p);
  } catch {
    /* fall through */
  }
  const m = /"p"\s*:\s*"([^"]+)"/.exec(text);
  if (m) return m[1];
  if (text.startsWith("wss://")) return text.replace(/^wss:\/\//, "");
  return text;
}

function parseEsportsPage(html) {
  const urlRaw = extractEsField(html, "url");
  const wsHost = parseEsUrl(urlRaw);
  const id = extractEsField(html, "id")?.replace(/\\"/g, "").replace(/^"|"$/g, "");
  const logo = extractEsField(html, "logo")?.replace(/\\"/g, "").replace(/^"|"$/g, "");
  const accountRaw = extractEsField(html, "account");
  if (!wsHost || !id || !logo || !accountRaw) return null;
  let account;
  try {
    account = JSON.parse(accountRaw);
  } catch {
    return null;
  }
  const token = account?.pnv?.tk;
  if (!token) return null;
  return {
    wsHost,
    id,
    logo,
    token,
    gid: crypto.randomUUID().replace(/-/g, "").slice(0, 16),
    rid: "1",
    ext: 1,
  };
}

function convertMalaysianToEU(odds, digits = 2) {
  const n = Number(odds);
  if (!Number.isFinite(n)) return 0;
  const fixed = (v) => Number(v.toFixed(digits));
  return n > 0 ? fixed(n + 1) : fixed(1 + 1 / Math.abs(n));
}

function normalizeMatch(row, gameIds) {
  if (!row?.gameId || !gameIds.includes(String(row.gameId))) return null;
  const nowSec = Date.now() / 1000;
  if (row.kickofftime > nowSec + 3600) return null;
  return {
    matchId: String(row.matchid),
    gameId: String(row.gameId),
    startTime: Number(row.kickofftime) * 1000,
    home: { id: String(row.homeid), name: row.hteamnamecn || row.hteamname || "主队" },
    away: { id: String(row.awayid), name: row.ateamnamecn || row.ateamname || "客队" },
    leagueName: row.leaguenamecn || "",
    isLive: true,
  };
}

function normalizeOdds(oddRow, match) {
  const betType = BET_TYPES[oddRow.bettype];
  if (!betType || !match) return null;
  const stageId = oddRow.resourceid ? Number(oddRow.resourceid) : 0;
  const locked = oddRow.oddsstatus !== "running";
  const homeId = `${oddRow.oddsid}:Home`;
  const awayId = `${oddRow.oddsid}:Away`;
  return {
    matchId: match.matchId,
    stageId,
    label: betType.replace("Map X", stageId ? `Map ${stageId}` : "全场"),
    winMarketId: String(oddRow.oddsid),
    winHomeId: homeId,
    winAwayId: awayId,
    winHome: convertMalaysianToEU(oddRow.odds1a),
    winAway: convertMalaysianToEU(oddRow.odds2a),
    winLocked: locked,
    betName: betType.replace("Map X", stageId ? `Map ${stageId}` : "Moneyline"),
  };
}

function decodePairMessage(parts, fieldMap) {
  const obj = {};
  for (let i = 0; i < parts.length; i += 2) {
    const key = parts[i];
    const val = parts[i + 1];
    obj[fieldMap[key] ?? key] = val;
  }
  return obj;
}

module.exports = {
  BET_TYPES,
  parseEsportsPage,
  convertMalaysianToEU,
  normalizeMatch,
  normalizeOdds,
  decodePairMessage,
};
