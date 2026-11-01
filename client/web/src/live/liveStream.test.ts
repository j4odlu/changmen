import { beforeEach, describe, expect, it, vi } from "vitest";
import { directGet } from "@changmen/client-core/shared/http";
import { fetchRayLiveStream, parseRayLiveSource } from "@changmen/venue-browser/adapter/ray/liveStream";

vi.mock("@changmen/client-core/shared/http", () => ({ directGet: vi.fn() }));
beforeEach(() => vi.resetAllMocks());

describe("RAY live source", () => {
  it("preserves signed HLS URLs and iframe embeds, rejecting executable and unsupported addresses", () => {
    expect(parseRayLiveSource("https://video.example/live.m3u8?sign=abc%2F123&expires=99"))
      .toEqual({ kind: "hls", url: "https://video.example/live.m3u8?sign=abc%2F123&expires=99" });
    expect(parseRayLiveSource("iframe:https://video.example/embed?id=123"))
      .toEqual({ kind: "iframe", url: "https://video.example/embed?id=123" });
    for (const value of [null, "", "https://example.org/clip.mp4", "iframe:javascript:alert(1)", "iframe:data:text/html,hello", "https://user:password@example.org/a.m3u8"])
      expect(parseRayLiveSource(value)).toBeNull();
  });

  it("loads the requested RAY match and returns only a playable live source", async () => {
    vi.mocked(directGet).mockResolvedValue({ code: 200, result: {
      status: 2, match_name: "A vs B", live_url: "https://video.example/live.m3u8?token=signed",
    } });
    expect(await fetchRayLiveStream("ray/123&x=1")).toEqual({ title: "A vs B", source: {
      kind: "hls", url: "https://video.example/live.m3u8?token=signed",
    } });
    expect(vi.mocked(directGet).mock.calls[0][0]).toContain("/v2/odds?match_id=ray%2F123%26x%3D1");
  });

  it("distinguishes missing IDs, inactive matches, absent streams and API failures", async () => {
    await expect(fetchRayLiveStream(" ")).rejects.toThrow("缺少 RAY 比赛 ID");
    expect(directGet).not.toHaveBeenCalled();
    for (const [response, message] of [
      [{ code: 500 }, "获取 RAY 直播失败"],
      [{ code: 200, result: { status: 1, live_url: "https://v.example/live.m3u8" } }, "当前未在直播"],
      [{ code: 200, result: { status: 2 } }, "暂未提供"],
      [{ code: 200, result: { status: 2, live_url: "javascript:alert(1)" } }, "格式暂不支持"],
    ] as const) {
      vi.mocked(directGet).mockResolvedValue(response);
      await expect(fetchRayLiveStream("123")).rejects.toThrow(message);
    }
  });
});
