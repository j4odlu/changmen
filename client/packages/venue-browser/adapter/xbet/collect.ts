import { startA8BetsCollector } from "../shared/socket/collector";
import { PLATFORMS } from "../shared/platforms";

/** 对齐 A8 KQe — A8 聚合频道 XBet（主客 suffix 1/3）；地图小分改由 MatchCard pm_sport 展示 */
export function startXbetCollector(): () => void {
  return startA8BetsCollector({
    platform: PLATFORMS.XBet,
    channel: "XBet",
    homeSuffix: "1",
    awaySuffix: "3",
    reportToServer: false,
  });
}
