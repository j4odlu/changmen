import type { PodDropAlert } from "@/runtime/podAlerts";
import { podAlertBetFailReason, podAlertLineKind, type PodBetSettings, type PodBetGateFail } from "@/runtime/podBetSettings";
import type { PodVenueMatchResult } from "@/runtime/podVenueMatchPlugins";

const GATE_LABELS: Record<PodBetGateFail, string> = {
  disabled: "跟单筛选已关闭", age: "警报已过期", sport: "非足球警报", live: "仅跟未开赛",
  period: "该时段未启用", market: "该玩法未启用", drop: "降幅未达门槛", odds: "赔率不在跟单范围",
};

/** [changmen 扩展] 匹配事实与跟单资格分别显示，设置过滤不冒充赛事缺失。 */
export function describePodAlertMatch(
  alert: PodDropAlert,
  results: Iterable<PodVenueMatchResult>,
  settings: PodBetSettings,
  now = Date.now(),
) {
  const venues = [...results];
  const gate = podAlertBetFailReason(alert, { ...settings, maxAgeSec: 0 }, now);
  const matched = venues.filter(row => row.fixture.status === "matched" && row.market.status === "matched");
  const found = venues.filter(row => row.fixture.status === "matched");
  const pending = venues.filter(row => row.fixture.status === "pending");
  const ids = (rows: PodVenueMatchResult[]) => rows.map(row => row.plugin.id === "Polymarket" ? "PM" : row.plugin.id).join("/");
  return {
    matched: matched.length > 0,
    label: matched.length ? `${ids(matched)} 已匹配`
      : found.length ? `${ids(found)} 已找到比赛 · 盘口未对上`
        : pending.length ? `${ids(pending)} 赛事待确认` : "赛事未找到",
    gateLabel: gate === "market" && podAlertLineKind(alert) === "spreads" && !settings.spreads
      ? "让球跟单未启用" : gate ? GATE_LABELS[gate] : "",
  };
}

/** 补搜/补盘只服务近期足球警报，不依赖自动下单开关，不延长下注时限。 */
export function shouldDiscoverPodObAlert(alert: PodDropAlert, now = Date.now()): boolean {
  return (alert.sportId === 1 || /football|soccer/i.test(alert.sport))
    && alert.starts > now
    && alert.alertedAt > 0 && now - alert.alertedAt >= 0 && now - alert.alertedAt < 60_000
    && (alert.period === 0 || alert.period === 1)
    && podAlertLineKind(alert) !== "other";
}
