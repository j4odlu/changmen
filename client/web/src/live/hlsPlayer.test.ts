import { beforeEach, expect, it, vi } from "vitest";
import { attachLiveHls } from "./hlsPlayer";

const mock = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => void>();
  const engine = { on: vi.fn((event, callback) => handlers.set(event, callback)), destroy: vi.fn(),
    loadSource: vi.fn(), attachMedia: vi.fn(), startLoad: vi.fn(), recoverMediaError: vi.fn() };
  const constructor = vi.fn(function () { return engine; });
  return { handlers, engine, constructor, supported: vi.fn(() => true) };
});
vi.mock("hls.js", () => ({ default: Object.assign(mock.constructor, {
  isSupported: mock.supported, Events: { MANIFEST_PARSED: "manifest", ERROR: "error" },
  ErrorTypes: { NETWORK_ERROR: "network", MEDIA_ERROR: "media" },
}) }));

function setup(native = false) {
  const element = Object.assign(new EventTarget(), { src: "", muted: false, readyState: 0, paused: false,
    canPlayType: vi.fn(() => native ? "probably" : ""), play: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn(), removeAttribute: vi.fn(), load: vi.fn() });
  const callbacks = { onError: vi.fn(), onBuffering: vi.fn(), onAutoplayBlocked: vi.fn() };
  return { element, video: element as unknown as HTMLVideoElement, callbacks };
}
const flush = () => new Promise(resolve => setTimeout(resolve, 0));
beforeEach(() => { vi.clearAllMocks(); mock.handlers.clear(); mock.supported.mockReturnValue(true); });

it("uses native HLS and retries muted when sound autoplay is blocked, then cleans up", async () => {
  const { video, element, callbacks } = setup(true);
  element.play.mockRejectedValueOnce(Object.assign(new Error(), { name: "NotAllowedError" }));
  const stop = attachLiveHls(video, "https://video.example/live.m3u8", callbacks);
  await flush();
  expect(element.src).toBe("https://video.example/live.m3u8");
  expect(element.muted).toBe(true); expect(element.play).toHaveBeenCalledTimes(2);
  expect(mock.constructor).not.toHaveBeenCalled();
  stop();
  expect(element.pause).toHaveBeenCalled(); expect(element.removeAttribute).toHaveBeenCalledWith("src");
  element.dispatchEvent(new Event("error"));
  expect(callbacks.onError).not.toHaveBeenCalled();
});

it("attaches hls.js, bounds fatal error recovery, and destroys the engine", async () => {
  const { video, callbacks } = setup();
  const stop = attachLiveHls(video, "https://video.example/live.m3u8", callbacks);
  await flush();
  expect(mock.engine.loadSource).toHaveBeenCalledWith("https://video.example/live.m3u8");
  expect(mock.engine.attachMedia).toHaveBeenCalledWith(video);
  mock.handlers.get("manifest")?.(); await flush();
  expect(video.play).toHaveBeenCalled();
  mock.handlers.get("error")?.("error", { fatal: false, type: "network" });
  expect(mock.engine.startLoad).not.toHaveBeenCalled();
  for (let i = 0; i < 3; i++) mock.handlers.get("error")?.("error", { fatal: true, type: "network" });
  expect(mock.engine.startLoad).toHaveBeenCalledTimes(2);
  expect(callbacks.onError).toHaveBeenCalledTimes(1);
  expect(mock.engine.destroy).toHaveBeenCalledTimes(1);
  stop(); expect(mock.engine.destroy).toHaveBeenCalledTimes(1);
});

it("cancels pending engine initialization and reports unsupported browsers", async () => {
  const first = setup();
  attachLiveHls(first.video, "https://video.example/live.m3u8", first.callbacks)();
  await flush(); expect(mock.constructor).not.toHaveBeenCalled();
  mock.supported.mockReturnValue(false);
  const second = setup();
  const stop = attachLiveHls(second.video, "https://video.example/live.m3u8", second.callbacks);
  await flush(); expect(second.callbacks.onError).toHaveBeenCalledWith(expect.stringContaining("不支持"));
  stop();
});

it("does not show buffering for a stalled download while buffered video continues playing", async () => {
  const { video, element, callbacks } = setup(true);
  const stop = attachLiveHls(video, "https://video.example/live.m3u8", callbacks);
  await flush();
  element.readyState = 4;
  element.dispatchEvent(new Event("stalled"));
  expect(callbacks.onBuffering).toHaveBeenLastCalledWith(false);
  element.readyState = 2;
  element.dispatchEvent(new Event("waiting"));
  expect(callbacks.onBuffering).toHaveBeenLastCalledWith(true);
  element.readyState = 4;
  element.dispatchEvent(new Event("timeupdate"));
  expect(callbacks.onBuffering).toHaveBeenLastCalledWith(false);
  stop();
});
