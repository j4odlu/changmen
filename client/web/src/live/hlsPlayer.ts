import type Hls from "hls.js";

type PlayerCallbacks = {
  onBuffering: (value: boolean) => void;
  onError: (message: string) => void;
  onAutoplayBlocked: () => void;
};

/** 返回同步清理函数，异步加载引擎时关闭/重试也不会遗留播放器。 */
export function attachLiveHls(video: HTMLVideoElement, url: string, callbacks: PlayerCallbacks): () => void {
  let disposed = false;
  let failedOnce = false;
  let engine: Hls | null = null;
  let networkRecoveries = 0;
  let mediaRecoveries = 0;
  const buffering = () => callbacks.onBuffering(video.readyState < 3);
  const playing = () => callbacks.onBuffering(false);
  const progress = () => {
    if (!video.paused && video.readyState >= 3) playing();
  };
  const failed = () => {
    if (disposed || failedOnce) return;
    failedOnce = true;
    engine?.destroy();
    engine = null;
    callbacks.onBuffering(false);
    callbacks.onError("直播连接中断或视频无法播放，请重新加载直播。");
  };
  const autoplay = async () => {
    if (disposed || failedOnce) return;
    try {
      await video.play();
    }
    catch (error) {
      if (disposed || failedOnce || (error as Error).name === "AbortError") return;
      if ((error as Error).name !== "NotAllowedError") return failed();
      video.muted = true;
      try { await video.play(); }
      catch {
        if (!disposed && !failedOnce) {
          callbacks.onBuffering(false);
          callbacks.onAutoplayBlocked();
        }
      }
    }
  };
  const listeners: [string, EventListener][] = [
    ["waiting", buffering], ["stalled", buffering], ["playing", playing],
    ["canplay", playing], ["timeupdate", progress], ["pause", playing],
    ["error", () => { if (!engine) failed(); }],
  ];
  for (const [event, listener] of listeners) video.addEventListener(event, listener);
  callbacks.onBuffering(true);

  void (async () => {
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = url;
      await autoplay();
      return;
    }
    const { default: HlsEngine } = await import("hls.js");
    if (disposed || failedOnce) return;
    if (!HlsEngine.isSupported()) {
      callbacks.onBuffering(false);
      callbacks.onError("当前浏览器不支持此直播，请使用新版 Chrome、Edge 或 Safari。");
      return;
    }
    const hls = engine = new HlsEngine({ enableWorker: true, lowLatencyMode: true, backBufferLength: 30 });
    hls.on(HlsEngine.Events.MANIFEST_PARSED, () => { void autoplay(); });
    hls.on(HlsEngine.Events.ERROR, (_event, data) => {
      if (disposed || failedOnce || !data.fatal) return;
      if (data.type === HlsEngine.ErrorTypes.NETWORK_ERROR && networkRecoveries++ < 2) hls.startLoad();
      else if (data.type === HlsEngine.ErrorTypes.MEDIA_ERROR && mediaRecoveries++ < 2) hls.recoverMediaError();
      else failed();
    });
    hls.loadSource(url);
    hls.attachMedia(video);
  })().catch(failed);

  return () => {
    disposed = true;
    for (const [event, listener] of listeners) video.removeEventListener(event, listener);
    engine?.destroy();
    engine = null;
    video.pause();
    video.removeAttribute("src");
    video.load();
  };
}
