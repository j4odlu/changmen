import type { ClientMatchDto } from "@/types/esport";
import {
  fetchPmFootballDirect,
  getPmMarketWsSourceMode,
} from "@changmen/venue-adapter/polymarket";
import { fetchRayFootballAsClientMatchDtos } from "@changmen/venue-adapter/ray";
import { getFootballMatchs } from "@/api/esport";
import { collectIndependentFootballVenueRows } from "@/runtime/footballVenueLists";
import { fetchObFootballAsClientMatchDtos } from "@/runtime/obSportFootballFetch";
import { readLocalSportObSession } from "@/runtime/obSportSessionLocal";
import { createSportListStore } from "@/stores/createSportListStore";

async function fetchObRows() {
  try {
    return await fetchObFootballAsClientMatchDtos();
  }
  catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[football] OB client fetch skipped", msg);
    if (readLocalSportObSession()?.token)
      throw err;
    return [];
  }
}

async function fetchFootballCombined(userName: string) {
  return collectIndependentFootballVenueRows(
    fetchPmFootballRows(userName),
    fetchObRows(),
    fetchRayFootballAsClientMatchDtos(),
  );
}

interface PmFootballFetchDeps {
  sourceMode: () => "official" | "changmen";
  direct: () => Promise<ClientMatchDto[]>;
  vps: (userName: string) => Promise<ClientMatchDto[]>;
}

export async function fetchPmFootballRows(userName: string, deps: PmFootballFetchDeps = {
  sourceMode: getPmMarketWsSourceMode,
  direct: fetchPmFootballDirect,
  vps: getFootballMatchs,
}) {
  if (deps.sourceMode() !== "official")
    return deps.vps(userName);
  try {
    const direct = await deps.direct();
    if (direct.length)
      return direct;
    console.warn("[football] PM official discovery empty; fallback to VPS");
  }
  catch (err) {
    console.warn("[football] PM official discovery failed; fallback to VPS", err);
  }
  return deps.vps(userName);
}

/** 足球列表：独立于 matchStore；不参与电竞套利主循环 */
export const useFootballStore = createSportListStore({
  id: "football",
  fetchList: fetchFootballCombined,
  pollMs: 8_000,
  minFetchGapMs: 3_000,
});
