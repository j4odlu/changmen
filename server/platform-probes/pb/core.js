/** 与 A8 bundle 中 _Ze / Bw 一致：联赛 gameCode → 目录 slug */
export function slugify(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/\s/g, "-");
}

/** bundle L7：平博 itemId / SourceHomeID 格式 */
export function selectionId(matchId, map, side) {
  const homeBit = side === "HOME" ? 0 : 1;
  return [matchId, map, 1, homeBit, 0, 0, homeBit].join("|");
}

export function toNumber(value) {
  if (value == null) return 0;
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value) || 0;
  if (typeof value.toNumber === "function") return value.toNumber();
  return Number(value) || 0;
}

function periodLabel(map) {
  return map === 0 ? "全场" : `地图${map}`;
}

export function betNameForMap(map) {
  return `[${periodLabel(map)}]-比赛胜负`;
}

function isLocked(moneyLine) {
  if (!moneyLine) return true;
  return Boolean(moneyLine.offline || moneyLine.unavailable);
}

function isKillsSide(participant) {
  return /\(Kills\)/i.test(participant?.englishName || participant?.name || "");
}

/**
 * 解析平博电竞 odds 接口（sportId=12）响应。
 * @returns {{ matches: object[], byMatch: Record<string, object>, lineIds: Map<string, number> }}
 */
export function parseEuroOddsPayload(data, options = {}) {
  const allowedSlugs = options.allowedSlugs
    ? new Set([...options.allowedSlugs].map(slugify))
    : null;

  const matches = [];
  const byMatch = {};
  const lineIds = new Map();

  const leagues = data?.leagues || [];
  for (const league of leagues) {
    const gameSlug = slugify(league.gameCode);
    if (allowedSlugs && !allowedSlugs.has(gameSlug)) continue;

    for (const event of league.events || []) {
      const home = (event.participants || []).find((p) => p.type === "HOME");
      const away = (event.participants || []).find((p) => p.type === "AWAY");
      if (!home || !away) continue;
      if (isKillsSide(home) || isKillsSide(away)) continue;

      const matchId = String(event.id);
      const stages = [];
      const periods = event.periods || {};

      for (const key of Object.keys(periods)) {
        const map = Number(key);
        if (Number.isNaN(map)) continue;
        const period = periods[key];
        const ml = period?.moneyLine;
        if (!ml || ml.unavailable) continue;

        lineIds.set(`${matchId}:${map}`, ml.lineId);

        const locked = isLocked(ml);
        const homeOdds = toNumber(ml.homePrice);
        const awayOdds = toNumber(ml.awayPrice);
        const homeItemId = selectionId(matchId, map, "HOME");
        const awayItemId = selectionId(matchId, map, "AWAY");
        const betId = `${matchId}:${map}`;

        stages.push({
          stageId: map,
          label: periodLabel(map),
          winHome: homeOdds,
          winAway: awayOdds,
          winHomeId: homeItemId,
          winAwayId: awayItemId,
          winMarketId: betId,
          winLineId: ml.lineId,
          winLocked: locked,
          winMarketStatus: locked ? { code: "locked", label: "锁盘" } : { code: "open", label: "可买入" },
          betName: betNameForMap(map),
        });
      }

      stages.sort((a, b) => a.stageId - b.stageId);
      const primary = stages.find((s) => s.stageId === 0) || stages[0] || {};

      const matchRow = {
        matchId,
        gameId: gameSlug,
        gameCode: gameSlug,
        gameName: league.gameName || league.name || gameSlug,
        leagueName: league.name || "",
        bo: inferBo(stages),
        startTime: Number(event.time) || Date.now(),
        isLive: Boolean(event.live || event.isLive),
        home: {
          id: slugify(home.englishName || home.name),
          name: home.name || home.englishName || "",
          englishName: home.englishName || "",
        },
        away: {
          id: slugify(away.englishName || away.name),
          name: away.name || away.englishName || "",
          englishName: away.englishName || "",
        },
        raw: event,
      };

      matches.push(matchRow);
      byMatch[matchId] = {
        stages,
        winHome: primary.winHome ?? null,
        winAway: primary.winAway ?? null,
        winHomeId: primary.winHomeId ?? null,
        winAwayId: primary.winAwayId ?? null,
        winMarketId: primary.winMarketId ?? null,
        winLineId: primary.winLineId ?? null,
        winLocked: primary.winLocked ?? true,
      };
    }
  }

  matches.sort((a, b) => a.startTime - b.startTime);
  return { matches, byMatch, lineIds };
}

function inferBo(stages) {
  const maps = stages.filter((s) => s.stageId > 0).map((s) => s.stageId);
  if (!maps.length) return stages.some((s) => s.stageId === 0) ? 1 : 0;
  return Math.max(...maps);
}
