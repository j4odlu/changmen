import type { CollectBetDto, CollectMatchDto } from "@changmen/client-core/types/collect";
import type { ClientMatchDto } from "@/types/esport";
import { isVpsOwnedPlatformCollect } from "@changmen/venue-browser/adapter/registry";
import { post, postForm, unwrap } from "@/api/client";
import {
  toA8LiveTimerRow,
  toA8SaveBetRow,
  toA8SaveMatchRow,
} from "@/api/collectWire";

/** [A8 可证实] `Ar.post`：application/x-www-form-urlencoded，失败不抛错，以 success===1 为准 */
async function postCollectApi(action: string, fields: Record<string, string>): Promise<boolean> {
  try {
    const data = await postForm<boolean>(action, fields);
    return data.success === 1;
  }
  catch {
    return false;
  }
}

export async function saveMatchSource(provider: string, matchs: unknown[]) {
  // [changmen 扩展] vps_http_ws 馆由 VPS collector 独占写；浏览器不得 SaveMatch
  if (isVpsOwnedPlatformCollect(provider))
    return false;
  const wire = (matchs as CollectMatchDto[]).map(toA8SaveMatchRow);
  return postCollectApi(`API_SaveMatch?${provider}`, {
    provider,
    matchs: JSON.stringify(wire),
  });
}

export async function saveBetSource(provider: string, matchId: string | number, bets: unknown[], matchResult?: Record<string, unknown>) {
  // [changmen 扩展] vps_http_ws 馆由 VPS collector 独占写；浏览器不得 SaveBet（会抹局盘）
  if (isVpsOwnedPlatformCollect(provider))
    return false;
  const wire = (bets as CollectBetDto[]).map(toA8SaveBetRow);
  return postCollectApi(`API_SaveBet?${provider}`, {
    provider,
    matchId: String(matchId),
    bets: JSON.stringify(wire),
    ...(provider === "RAY" && matchResult !== undefined ? { matchResult: JSON.stringify(matchResult) } : {}),
  });
}

/** [A8 可证实] `Ut.saveLiveTimer` → POST `API_SaveLiveTimer?{provider}` form: provider + timer */
export async function saveLiveTimer(provider: string, timer: unknown[]) {
  // [changmen 扩展] vps_http_ws 馆由 VPS collector 独占写；浏览器不得 SaveLiveTimer
  if (isVpsOwnedPlatformCollect(provider))
    return false;
  const wire = (timer as Array<{ MatchID: string | number; Round: number; StartTime: number }>).map(
    toA8LiveTimerRow,
  );
  return postCollectApi(`API_SaveLiveTimer?${provider}`, {
    provider,
    timer: JSON.stringify(wire),
  });
}

export async function saveScore(body: Record<string, unknown>) {
  return unwrap(await post<boolean>("API_SaveScore", body));
}

export async function getMatchs(userName: string) {
  const data = await post<ClientMatchDto[]>(
    "Client_GetMatchs",
    {},
    `?user=${encodeURIComponent(userName)}`,
  );
  if (data.success !== 1 || !Array.isArray(data.info))
    return [];
  return data.info;
}

/** 棒球列表（独立 action；不进电竞 GetMatchs / 套利主循环） */
export async function getBaseballMatchs(userName: string) {
  const data = await post<ClientMatchDto[]>(
    "Client_GetBaseballMatchs",
    {},
    `?user=${encodeURIComponent(userName)}`,
  );
  if (data.success !== 1)
    throw new Error(data.msg || "Client_GetBaseballMatchs failed");
  if (!Array.isArray(data.info))
    throw new Error("Invalid baseball match list");
  return data.info;
}

/** 足球列表（独立 action；不进电竞 GetMatchs / 套利主循环） */
export async function getFootballMatchs(userName: string) {
  const data = await post<ClientMatchDto[]>(
    "Client_GetFootballMatchs",
    {},
    `?user=${encodeURIComponent(userName)}`,
  );
  if (data.success !== 1)
    throw new Error(data.msg || "Client_GetFootballMatchs failed");
  if (!Array.isArray(data.info))
    throw new Error("Invalid football match list");
  return data.info;
}

/** 足球 OB 单场全玩法（展开用；不进电竞 GetMatchs） */
export async function getFootballMatchMarkets(mid: string) {
  const data = await post<unknown[]>(
    "Client_GetFootballMatchMarkets",
    { mid },
  );
  if (data.success !== 1)
    throw new Error(data.msg || "Client_GetFootballMatchMarkets failed");
  return Array.isArray(data.info) ? data.info : [];
}

export type SportObSessionInfo = {
  configured: boolean;
  token?: string;
  sessionId?: string;
  gateway?: string;
  referer?: string;
  wsUrl?: string;
  tokenMasked?: string;
  sessionIdMasked?: string;
  updatedAt?: number;
};

export async function getSportObSession() {
  const data = await post<SportObSessionInfo>("Client_GetSportObSession", {});
  if (data.success !== 1)
    throw new Error(data.msg || "Client_GetSportObSession failed");
  return data.info ?? { configured: false };
}

export async function updateSportObSession(body: Record<string, unknown>) {
  const data = await post<SportObSessionInfo>("API_UpdateSportObSession", body);
  if (data.success !== 1)
    throw new Error(data.msg || "API_UpdateSportObSession failed");
  return data.info ?? { configured: false };
}

/** 网球列表（独立 action；不进电竞 GetMatchs / 套利主循环） */
export async function getTennisMatchs(userName: string) {
  const data = await post<ClientMatchDto[]>(
    "Client_GetTennisMatchs",
    {},
    `?user=${encodeURIComponent(userName)}`,
  );
  if (data.success !== 1)
    throw new Error(data.msg || "Client_GetTennisMatchs failed");
  if (!Array.isArray(data.info))
    throw new Error("Invalid tennis match list");
  return data.info;
}

/** 篮球列表（独立 action；不进电竞 GetMatchs / 套利主循环） */
export async function getBasketballMatchs(userName: string) {
  const data = await post<ClientMatchDto[]>(
    "Client_GetBasketballMatchs",
    {},
    `?user=${encodeURIComponent(userName)}`,
  );
  if (data.success !== 1)
    throw new Error(data.msg || "Client_GetBasketballMatchs failed");
  if (!Array.isArray(data.info))
    throw new Error("Invalid basketball match list");
  return data.info;
}

