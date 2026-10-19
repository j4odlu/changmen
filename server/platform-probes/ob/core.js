import {
  obPickWinMarket,
  obFormatNormalizedMarketName,
} from "@changmen/shared/catalog/market_catalog";

/** �̿ڿ���̬��game/view �� market.status ����֪��Ͷעֵ */
const MARKET_STATUS_OPEN = 6;

/** visible / suspended ����֪����ֵ */
const MARKET_VISIBLE_SHOW = 1;
const MARKET_SUSPENDED_OFF = 0;

/**
 * �ж��̿��Ƿ����̣�����Ͷעչʾ̬����
 * ������ A8/����ɼ���һ�£�����ͬʱ�����Ϊ���š�
 */
function isMarketLocked({ status, visible, suspended } = {}) {
  const s = numberOrZero(status);
  const v = numberOrZero(visible);
  const u = numberOrZero(suspended);
  return s !== MARKET_STATUS_OPEN || v !== MARKET_VISIBLE_SHOW || u !== MARKET_SUSPENDED_OFF;
}

/**
 * �� OB ԭʼ�̿��ֶν���Ϊ�ɶ�״̬��HTTP ���� / MQTT ���������ã���
 * @returns {{ locked: boolean, code: string, label: string, reasons: string[] }}
 */
function describeMarketStatus(fields = {}) {
  const status = numberOrZero(fields.status);
  const visible = numberOrZero(fields.visible);
  const suspended = numberOrZero(fields.suspended);
  const settleCount = numberOrZero(fields.settle_count ?? fields.settleCount);
  const locked = isMarketLocked({ status, visible, suspended });
  const reasons = [];

  if (status !== MARKET_STATUS_OPEN) {
    if (status === 9 || status === 12 || settleCount > 0) {
      reasons.push(`status=${status}�������ѽ��㣬settle_count=${settleCount}��`);
    } else if (status === 7) {
      reasons.push(`status=7������/ͣͶ�������ڹ�����̣�`);
    } else {
      reasons.push(`status=${status}���ǿ���ֵ ${MARKET_STATUS_OPEN}��`);
    }
  }
  if (visible !== MARKET_VISIBLE_SHOW) reasons.push(`visible=${visible}����չʾ��`);
  if (suspended !== MARKET_SUSPENDED_OFF) {
    const st = fields.suspended_type ?? fields.suspendedType;
    reasons.push(
      st != null && st !== 0
        ? `suspended=${suspended}����ͣ��suspended_type=${st}��`
        : `suspended=${suspended}����ͣ��`
    );
  }

  let code = "open";
  let label = "��Ͷע";
  if (locked) {
    if (status === 9 || status === 12 || settleCount > 0) {
      code = "settled";
      label = "�ѽ���";
    } else if (suspended !== MARKET_SUSPENDED_OFF) {
      code = "suspended";
      label = "��ͣ";
    } else if (visible !== MARKET_VISIBLE_SHOW) {
      code = "hidden";
      label = "���ɼ�";
    } else {
      code = "locked";
      label = "����";
    }
  }

  return { locked, code, label, reasons };
}

/** �Ӵ�ȷ��ַ��������������� "1:0" �� { home: 1, away: 1, total: 2 } */
function parseScore(scoreStr) {
  const parts = cleanText(scoreStr).split(":").map((x) => numberOrZero(x));
  const home = parts[0] || 0;
  const away = parts[1] || 0;
  return { home, away, total: home + away };
}

/** game/index ����������״̬�ֶΣ�HTTP ��ʼ�� / ��ʱˢ�£� */
function extractMatchFieldsFromIndex(item) {
  return {
    isLive: numberOrZero(item.is_live),
    status: numberOrZero(item.status),
    score: cleanText(item.score || ""),
    suspended: numberOrZero(item.suspended),
    visible: numberOrZero(item.visible),
    closeTime: numberOrZero(item.close_time),
    betDelayTime: numberOrZero(item.bet_delay_time),
  };
}

/**
 * ������״̬������ game/index��MQTT ��ֱ�����ͱ������󣬿���ʱ index ˢ�� + �̿� MQTT ��ӷ�ӳ��
 */
function describeMatchStatus(fields = {}) {
  const isLive = numberOrZero(fields.isLive ?? fields.is_live);
  const status = numberOrZero(fields.status);
  const suspended = numberOrZero(fields.suspended);
  const visible = numberOrZero(fields.visible);
  const score = cleanText(fields.score || "");

  let code = "scheduled";
  let label = liveStatusLabel(isLive);

  if (visible !== MARKET_VISIBLE_SHOW) {
    code = "hidden";
    label = "���ɼ�";
  } else if (suspended !== MARKET_SUSPENDED_OFF) {
    code = "suspended";
    label = "������ͣ";
  } else if (isLive === 2) {
    code = "live";
    label = score ? `������ ${score}` : "������";
  } else if (isLive === 1) {
    code = "scheduled";
    label = "δ����";
  }

  return {
    code,
    label,
    isLive,
    status,
    score,
    suspended,
    visible,
    locked: suspended !== MARKET_SUSPENDED_OFF || visible !== MARKET_VISIBLE_SHOW,
  };
}

/** game/getTimer �� ��ǰ�����еĵ�ͼ��round�� */
function normalizeGetTimer(response) {
  if (!response || response.status !== "true" || !response.data) return {};
  const out = {};
  const rows = Array.isArray(response.data) ? response.data : Object.values(response.data);
  for (const row of rows) {
    const matchId = String(row.match_id ?? row.matchId ?? "");
    if (!matchId) continue;
    const round = numberOrZero(row.round);
    out[matchId] = {
      matchId,
      round,
      stageId: round,
      startTime: numberOrZero(row.start_time) * 1000,
    };
  }
  return out;
}

/**
 * ��ͼ/stage ״̬��HTTP game/view ��ʼ�� + MQTT �������� locked + getTimer �굱ǰ��
 */
function describeStageStatus({
  stageId,
  winLocked,
  winMarketStatus,
  timer,
  isLive,
} = {}) {
  const sid = numberOrZero(stageId);
  const isCurrentMap = Boolean(timer && numberOrZero(timer.round ?? timer.stageId) === sid);

  let code = "unknown";
  let label = "δ֪";
  const ms = winMarketStatus || {};

  if (ms.code === "settled") {
    code = "settled";
    label = "�ѽ���";
  } else if (winLocked) {
    code = ms.code === "suspended" ? "suspended" : "locked";
    label = ms.label || "����";
  } else {
    code = "open";
    label = "��Ͷע";
  }

  if (isCurrentMap && isLive === 2) {
    label = `${label} �� ��ǰ��`;
  }

  return {
    code,
    label,
    stageId: sid,
    isCurrentMap,
    winLocked: Boolean(winLocked),
    winMarketCode: ms.code || null,
  };
}

/** ���� timer / ����״̬ˢ�� byMatch ������ stageStatus */
function refreshStageStatuses(detail, match, timer) {
  if (!detail?.stages?.length) return detail;
  for (const stage of detail.stages) {
    stage.stageStatus = describeStageStatus({
      stageId: stage.stageId,
      winLocked: stage.winLocked,
      winMarketStatus: stage.winMarketStatus,
      timer,
      isLive: match?.isLive,
    });
  }
  return detail;
}

/** MQTT ���������Ƿ���ˢ�� stage */
function isMqttLockChange(type) {
  return (
    type === "market.statusUpdate" ||
    type === "market.suspended" ||
    type === "market.visible" ||
    type === "odd.statusUpdate" ||
    type === "odd.visible" ||
    type === "odd.suspended"
  );
}

function numberOrZero(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function cleanText(value) {
  return String(value == null ? "" : value)
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeBase64Json(value) {
  if (!value) return {};
  const decoded = decodeURIComponent(String(value));
  return JSON.parse(Buffer.from(decoded, "base64").toString("utf8"));
}

function parseObEntryUrl(rawUrl) {
  const url = new URL(String(rawUrl));
  const addrRaw = url.searchParams.get("addr") || "";
  return {
    pageUrl: url.toString(),
    token: url.searchParams.get("token") || "",
    lang: url.searchParams.get("lang") || "",
    domain: url.searchParams.get("domain") || "",
    addr: addrRaw ? decodeBase64Json(addrRaw) : {},
  };
}

function normalizeGameIndex(response) {
  if (!response || response.status !== "true" || !Array.isArray(response.data)) return [];
  return response.data
    .map((item) => {
      const teams = cleanText(item.match_team).split(",").map(cleanText);
      const teamIds = String(item.team_id || "").split(",").map(cleanText);
      const matchFields = extractMatchFieldsFromIndex(item);
      return {
        provider: "OB",
        matchId: String(item.id),
        gameId: String(item.game_id),
        bo: numberOrZero(item.bo),
        startTime: numberOrZero(item.start_time) * 1000,
        ...matchFields,
        matchStatus: describeMatchStatus(matchFields),
        home: { id: teamIds[0] || "", name: teams[0] || "" },
        away: { id: teamIds[1] || "", name: teams[1] || "" },
        raw: item,
      };
    })
    .filter((item) => item.matchId && item.home.name && item.away.name);
}

/** @see GAME_INDEX.md */
function buildGameIndexQuery({ gameId = "0", flag = 1, day = 1 } = {}) {
  const params = new URLSearchParams({
    game_id: String(gameId),
    flag: String(flag),
    day: String(day),
  });
  return `/game/index?${params.toString()}`;
}

/** ���� flag/day �ƶ����̷�Χ��ǩ���� live ̽����һ�£� */
function describeIndexSource(flag, day) {
  const f = Number(flag);
  const d = Number(day);
  if (f === 0) return { scope: "all", label: "ȫ������" };
  if (f === 1) return { scope: "today", label: "����" };
  if (f === 2) {
    if (d === 0) return { scope: "today", label: "����(�Ӽ�)" };
    if (d === 1) return { scope: "tomorrow", label: "����" };
    return { scope: "future", label: `δ��+${d}��` };
  }
  if (f === 3) return { scope: "week", label: "��һ��" };
  if (f === 4) {
    if (d === 1) return { scope: "tomorrow", label: "����" };
    return { scope: "future", label: `δ��+${d}��` };
  }
  if (f === 5) return { scope: "past", label: "�ѽ���" };
  return { scope: "unknown", label: `flag=${f}&day=${d}` };
}

function liveStatusLabel(isLive) {
  if (isLive === 2) return "������";
  if (isLive === 1) return "δ����";
  return "δ֪";
}

function normalizeGameView(matchId, stageId, response) {
  if (!response || response.status !== "true" || !Array.isArray(response.data)) return [];
  const out = [];
  response.data.forEach((market) => {
    const round = numberOrZero(market.round);
    const locked = isMarketLocked({
      status: market.status,
      visible: market.visible,
      suspended: market.suspended,
    });
    const odds = Object.keys(market.odds || {}).map((key) => {
      const item = market.odds[key];
      return {
        oddsId: String(item.id),
        name: cleanText(item.name),
        odd: numberOrZero(item.odd),
        marketId: String(market.id),
        side: item.name === "@T1" ? "home" : item.name === "@T2" ? "away" : "unknown",
        raw: item,
      };
    });
    out.push({
      provider: "OB",
      matchId: String(matchId),
      stageId: numberOrZero(stageId),
      marketId: String(market.id),
      oddTypeId: String(market.odd_type_id || ""),
      marketName: obFormatNormalizedMarketName(round, market.cn_name),
      round,
      status: market.status,
      visible: market.visible,
      suspended: market.suspended,
      settleCount: numberOrZero(market.settle_count),
      marketStatus: describeMarketStatus({
        status: market.status,
        visible: market.visible,
        suspended: market.suspended,
        settle_count: market.settle_count,
        suspended_type: market.suspended_type,
      }),
      locked,
      odds,
      raw: market,
    });
  });
  return out;
}

function mqttTopicsForMatch(matchId) {
  const id = String(matchId);
  return [
    `/odd/insert/${id}`,
    `/odd/statusUpdate/${id}`,
    `/odd/visible/${id}`,
    `/odd/suspended/${id}`,
    `/market/sortCodeUpdate/${id}`,
    `/market/suspended/${id}`,
    `/market/visible/${id}`,
    `/market/statusUpdate/${id}`,
    `/market/oddsUpdate/${id}`,
  ];
}

function parseMqttTopic(rawTopic) {
  const match = /^(.+?)(\d+)$/.exec(String(rawTopic || ""));
  if (!match) return { topic: String(rawTopic || ""), matchId: "", type: "unknown" };
  const topic = match[1];
  const known = {
    "/market/oddsUpdate/": "market.oddsUpdate",
    "/market/statusUpdate/": "market.statusUpdate",
    "/market/suspended/": "market.suspended",
    "/market/visible/": "market.visible",
    "/market/sortCodeUpdate/": "market.sortCodeUpdate",
    "/odd/insert/": "odd.insert",
    "/odd/statusUpdate/": "odd.statusUpdate",
    "/odd/visible/": "odd.visible",
    "/odd/suspended/": "odd.suspended",
  };
  return {
    topic,
    matchId: match[2],
    type: known[topic] || topic.replace(/^\/|\/$/g, "").replace(/\//g, "."),
  };
}

function stageIdsForBo(bo) {
  const n = Number(bo) || 1;
  if (n <= 1) return [0];
  return Array.from({ length: n + 1 }, (_, i) => i);
}

function pickWinMarket(markets, round = 0, marketCode, gameCode) {
  return obPickWinMarket(markets, round, marketCode, gameCode);
}

function buildOddsBaseline(markets) {
  const currentOdds = {};
  for (const mk of markets) {
    for (const o of mk.odds) {
      currentOdds[o.oddsId] = {
        oddsId: o.oddsId,
        marketId: mk.marketId,
        marketName: mk.marketName,
        matchId: mk.matchId,
        name: o.name,
        side: o.side,
        odd: o.odd,
        locked: mk.locked,
      };
    }
  }
  return currentOdds;
}

function applyMqttPayload(state, topicInfo, payload, receivedAt) {
  const changes = [];
  const items = Array.isArray(payload) ? payload : payload ? [payload] : [];
  const at = receivedAt || Date.now();

  if (topicInfo.type === "market.oddsUpdate") {
    items.forEach((item) => {
      const oddsId = String(item.id || item.odds_id || "");
      if (!oddsId || !state.currentOdds[oddsId]) return;
      const prev = state.currentOdds[oddsId].odd;
      const next = numberOrZero(item.odd ?? item.odds ?? prev);
      state.currentOdds[oddsId].odd = next;
      state.currentOdds[oddsId].updatedAt = at;
      changes.push({
        type: "oddsUpdate",
        oddsId,
        marketId: state.currentOdds[oddsId].marketId,
        marketName: state.currentOdds[oddsId].marketName,
        prev,
        odd: next,
        receivedAt: at,
      });
    });
    return changes;
  }

  if (topicInfo.type === "market.statusUpdate") {
    items.forEach((item) => {
      const marketId = String(item.market_id || item.id || "");
      const nextStatus = item.status;
      const locked =
        nextStatus !== undefined
          ? isMarketLocked({
              status: nextStatus,
              visible: item.visible,
              suspended: item.suspended,
            })
          : true;
      Object.values(state.currentOdds).forEach((row) => {
        if (row.marketId !== marketId) return;
        row.locked = locked;
        row.updatedAt = at;
      });
      changes.push({ type: "market.statusUpdate", marketId, locked, status: nextStatus, receivedAt: at });
    });
    return changes;
  }

  if (topicInfo.type === "market.visible") {
    items.forEach((item) => {
      const marketId = String(item.market_id || item.id || "");
      const locked = numberOrZero(item.visible) !== MARKET_VISIBLE_SHOW;
      Object.values(state.currentOdds).forEach((row) => {
        if (row.marketId !== marketId) return;
        row.locked = locked;
        row.updatedAt = at;
      });
      changes.push({ type: "market.visible", marketId, locked, visible: item.visible, receivedAt: at });
    });
    return changes;
  }

  if (topicInfo.type === "market.suspended") {
    items.forEach((item) => {
      const marketId = String(item.market_id || item.id || "");
      const locked = numberOrZero(item.suspended) === 1;
      Object.values(state.currentOdds).forEach((row) => {
        if (row.marketId !== marketId) return;
        row.locked = locked;
        row.updatedAt = at;
      });
      changes.push({ type: "market.suspended", marketId, locked, receivedAt: at });
    });
    return changes;
  }

  if (topicInfo.type === "odd.statusUpdate" || topicInfo.type === "odd.visible" || topicInfo.type === "odd.suspended") {
    items.forEach((item) => {
      const oddsId = String(item.id || item.odds_id || "");
      if (!oddsId || !state.currentOdds[oddsId]) return;
      const row = state.currentOdds[oddsId];
      if (item.status !== undefined) {
        row.locked = isMarketLocked({
          status: item.status,
          visible: item.visible ?? MARKET_VISIBLE_SHOW,
          suspended: item.suspended ?? MARKET_SUSPENDED_OFF,
        });
      } else if (topicInfo.type === "odd.visible" && item.visible !== undefined) {
        row.locked = numberOrZero(item.visible) !== MARKET_VISIBLE_SHOW;
      } else if (topicInfo.type === "odd.suspended" && item.suspended !== undefined) {
        row.locked = numberOrZero(item.suspended) === 1;
      }
      row.updatedAt = at;
      changes.push({ type: topicInfo.type, oddsId, locked: row.locked, receivedAt: at });
    });
    return changes;
  }

  if (items.length) {
    changes.push({
      type: topicInfo.type,
      matchId: topicInfo.matchId,
      payload: items,
      receivedAt: at,
    });
  }
  return changes;
}

export {
  MARKET_STATUS_OPEN,
  MARKET_VISIBLE_SHOW,
  MARKET_SUSPENDED_OFF,
  isMarketLocked,
  describeMarketStatus,
  parseScore,
  extractMatchFieldsFromIndex,
  describeMatchStatus,
  normalizeGetTimer,
  describeStageStatus,
  refreshStageStatuses,
  isMqttLockChange,
  parseObEntryUrl,
  normalizeGameIndex,
  normalizeGameView,
  buildGameIndexQuery,
  describeIndexSource,
  liveStatusLabel,
  stageIdsForBo,
  pickWinMarket,
  mqttTopicsForMatch,
  parseMqttTopic,
  buildOddsBaseline,
  applyMqttPayload,
};
