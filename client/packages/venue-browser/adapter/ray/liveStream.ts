import { directGet } from "@changmen/client-core/shared/http";
import { RAY_A8_COLLECT } from "./a8Collect";

export type RayLiveSource = { kind: "iframe" | "hls"; url: string };

/** RAY 官网 live_url：iframe: 标记优先，其余只接受 HLS。 */
export function parseRayLiveSource(value: unknown): RayLiveSource | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const raw = value.trim();
  const iframeAt = raw.indexOf("iframe:");
  const kind = iframeAt >= 0 ? "iframe" : "hls";
  try {
    const url = new URL(iframeAt >= 0 ? raw.slice(iframeAt + 7).trim() : raw);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return null;
    if (kind === "hls" && !/\.m3u8$/i.test(url.pathname)) return null;
    return { kind, url: url.href };
  }
  catch {
    return null;
  }
}

/** 独立播放页按需读取，不启动赔率采集器，也不读取投注账号。 */
export async function fetchRayLiveStream(matchId: string): Promise<{ title: string; source: RayLiveSource }> {
  if (!matchId.trim()) throw new Error("缺少 RAY 比赛 ID，请从比赛列表重新打开直播。");
  const base = RAY_A8_COLLECT.gateway.replace(/\/+$/, "");
  const res = await directGet<{
    code: number;
    result?: { status?: number; live_url?: unknown; match_name?: string; match_short_name?: string };
  }>(`${base}/v2/odds?match_id=${encodeURIComponent(matchId)}`, {
    authorization: RAY_A8_COLLECT.token,
    Accept: "application/json, text/plain, */*",
  });
  if (res.code !== 200 || !res.result) throw new Error("获取 RAY 直播失败，请稍后重试。");
  if (res.result.status !== 2) throw new Error("该比赛当前未在直播，开赛后可重新加载。");
  if (!res.result.live_url) throw new Error("RAY 暂未提供这场比赛的视频直播，可稍后重试。");
  const source = parseRayLiveSource(res.result.live_url);
  if (!source) throw new Error("RAY 返回的直播地址格式暂不支持。");
  return { title: res.result.match_name || res.result.match_short_name || "RAY 比赛直播", source };
}
