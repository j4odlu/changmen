import { fetchClientMatches } from "@changmen/db";
import { createValueSignalDashboardReader } from "@changmen/db/value_signals.js";

const SHARP = process.env.VB_SHARP_PLATFORM || "PB";
const SOFT = (process.env.VB_SOFT_PLATFORMS || "OB,IM,RAY,TF,IA,SABA,IMT,HG").split(",").map(s => s.trim()).filter(Boolean);
const MIN_EDGE = Number(process.env.VB_MIN_EDGE || 0.03);
const KELLY_MUL = Number(process.env.VB_KELLY_MULTIPLIER || 0.25);
const MIN_ODDS = Number(process.env.VB_MIN_ODDS || 1.40);
const MAX_ODDS = Number(process.env.VB_MAX_ODDS || 5.00);

function removVig(h, a) {
  if (!h || !a || h <= 1 || a <= 1)
    return null;
  const ih = 1 / h; const ia = 1 / a; const or = ih + ia;
  if (or <= 1)
    return null;
  return { fairHome: 1 / (ih / or), fairAway: 1 / (ia / or), overround: or };
}

function buildDiagnostics() {
  const matches = _cachedMatches;
  if (!matches || !matches.length)
    return { matchCount: 0, totalBets: 0, betsWithSharp: 0, sharpPct: 0, platformCoverage: [], edgeDist: {}, topEdges: [], config: getConfig() };

  let totalBets = 0; let betsWithSharp = 0;
  const platCount = {};
  const edgeDist = { "neg": 0, "0-1": 0, "1-2": 0, "2-3": 0, "3-5": 0, "5-10": 0, "10+": 0 };
  const allEdges = [];

  for (const match of matches) {
    const bets = match.bets;
    if (!bets)
      continue;
    const betRows = Array.isArray(bets) ? bets : bets.Bets || bets.bets || [];
    for (const bet of betRows) {
      const sources = bet.Sources || bet.sources;
      if (!sources)
        continue;
      totalBets++;
      for (const p of Object.keys(sources)) platCount[p] = (platCount[p] || 0) + 1;
      const sharp = sources[SHARP];
      if (!sharp)
        continue;
      betsWithSharp++;
      const fair = removVig(sharp.HomeOdds, sharp.AwayOdds);
      if (!fair)
        continue;
      for (const p of SOFT) {
        const src = sources[p];
        if (!src || src.Status === "Locked")
          continue;
        for (const side of ["Home", "Away"]) {
          const so = side === "Home" ? src.HomeOdds : src.AwayOdds;
          const fo = side === "Home" ? fair.fairHome : fair.fairAway;
          if (!so || so <= 1)
            continue;
          const edge = so / fo - 1;
          const r = Math.round;
          allEdges.push({
            edge: r(edge * 100000) / 100000,
            platform: p,
            side,
            softOdds: r(so * 1000) / 1000,
            fairOdds: r(fo * 1000) / 1000,
            sharpHome: sharp.HomeOdds,
            sharpAway: sharp.AwayOdds,
            match: match.title || "",
            game: match.game || "",
            betName: bet.Name || bet.name || "",
            map: bet.Map ?? bet.map ?? 0,
          });
          if (edge < 0)
            edgeDist.neg++;
          else if (edge < 0.01)
            edgeDist["0-1"]++;
          else if (edge < 0.02)
            edgeDist["1-2"]++;
          else if (edge < 0.03)
            edgeDist["2-3"]++;
          else if (edge < 0.05)
            edgeDist["3-5"]++;
          else if (edge < 0.10)
            edgeDist["5-10"]++;
          else edgeDist["10+"]++;
        }
      }
    }
  }

  allEdges.sort((a, b) => b.edge - a.edge);
  const platformCoverage = Object.entries(platCount)
    .sort((a, b) => b[1] - a[1])
    .map(([p, c]) => ({ platform: p, count: c, pct: totalBets ? Math.round(c / totalBets * 1000) / 10 : 0 }));

  return {
    matchCount: matches.length,
    totalBets,
    betsWithSharp,
    sharpPct: totalBets ? Math.round(betsWithSharp / totalBets * 1000) / 10 : 0,
    platformCoverage,
    edgeDist,
    topEdges: allEdges.slice(0, 15),
    config: getConfig(),
  };
}

function getConfig() {
  return { sharpPlatform: SHARP, softPlatforms: SOFT, minEdge: MIN_EDGE, kellyMultiplier: KELLY_MUL, minOdds: MIN_ODDS, maxOdds: MAX_ODDS };
}

let _cachedMatches = null;
let _cacheAt = 0;
const CACHE_TTL = 8000;

async function refreshMatchCache() {
  const now = Date.now();
  if (_cachedMatches && now - _cacheAt < CACHE_TTL)
    return;
  _cachedMatches = await fetchClientMatches() || [];
  _cacheAt = now;
}

export async function getValueBetDashboard() {
  const readSignals = createValueSignalDashboardReader();

  await refreshMatchCache();
  const diagnostics = buildDiagnostics();

  const { dbAvailable, signals, stats, platformDist } = await readSignals();

  return {
    available: true,
    dbAvailable,
    signals,
    stats,
    platformDist,
    diagnostics,
    queriedAt: Date.now(),
  };
}
