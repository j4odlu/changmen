<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { fetchRayLiveStream, type RayLiveSource } from "@changmen/venue-browser/adapter/ray/liveStream";
import { attachLiveHls } from "./hlsPlayer";

const title = ref("RAY 比赛直播");
const source = ref<RayLiveSource | null>(null);
const video = ref<HTMLVideoElement | null>(null);
const loading = ref(false);
const buffering = ref(false);
const error = ref("");
const autoplayBlocked = ref(false);
let sequence = 0;
let stopPlayer: (() => void) | undefined;

function stop() {
  sequence++;
  stopPlayer?.();
  stopPlayer = undefined;
}

async function reload() {
  stop();
  const current = sequence;
  source.value = null;
  error.value = "";
  autoplayBlocked.value = false;
  buffering.value = false;
  loading.value = true;
  try {
    const matchId = new URLSearchParams(location.search).get("matchId") || "";
    const result = await fetchRayLiveStream(matchId);
    if (current !== sequence) return;
    title.value = result.title;
    document.title = `${result.title} · RAY 直播`;
    source.value = result.source;
    await nextTick();
    if (current !== sequence) return;
    if (result.source.kind === "hls" && video.value) {
      stopPlayer = attachLiveHls(video.value, result.source.url, {
        onBuffering: value => { buffering.value = value; },
        onError: message => { error.value = message; },
        onAutoplayBlocked: () => { autoplayBlocked.value = true; },
      });
    }
  }
  catch (reason) {
    if (current === sequence) error.value = reason instanceof Error ? reason.message : "获取直播失败，请重试。";
  }
  finally {
    if (current === sequence) loading.value = false;
  }
}

function restore(event: PageTransitionEvent) {
  if (event.persisted) void reload();
}

onMounted(() => {
  void reload();
  window.addEventListener("pagehide", stop);
  window.addEventListener("pageshow", restore);
});
onBeforeUnmount(() => {
  stop();
  window.removeEventListener("pagehide", stop);
  window.removeEventListener("pageshow", restore);
});
</script>

<template>
  <main class="live-page">
    <header>
      <div>
        <p class="eyebrow">changmen <span>· RAY 直播</span></p>
        <h1>{{ title }}</h1>
      </div>
      <button type="button" :disabled="loading" @click="reload">重新加载直播</button>
    </header>
    <section class="player" aria-label="比赛直播播放器">
      <iframe
        v-if="source?.kind === 'iframe'"
        :src="source.url"
        title="RAY 比赛直播"
        allow="autoplay; fullscreen; picture-in-picture"
        allowfullscreen
        @error="error = '直播页面加载失败，请重新加载直播。'"
      />
      <video
        v-else-if="source?.kind === 'hls'"
        ref="video"
        controls
        autoplay
        playsinline
        @playing="autoplayBlocked = false"
      />
      <div v-if="loading || error || !source" class="player-message" :role="error ? 'alert' : 'status'">
        <span>{{ loading ? "正在获取直播…" : error || "等待直播地址" }}</span>
      </div>
      <span v-else-if="buffering" class="buffering" role="status">正在缓冲…</span>
    </section>
    <p v-if="autoplayBlocked" role="status">浏览器已暂停自动播放，请点击视频中的播放按钮。</p>
    <p class="hint">视频由 RAY 提供。可使用播放器控制音量、暂停或全屏观看。</p>
  </main>
</template>

<style>
:root { color-scheme: dark; font-family: system-ui, "Microsoft YaHei", sans-serif; color: #e5eaf3; background: #10141d; }
body { margin: 0; }
* { box-sizing: border-box; }
.live-page { max-width: 1440px; margin: 0 auto; padding: 28px; }
header { display: flex; align-items: center; justify-content: space-between; gap: 20px; margin-bottom: 22px; }
.eyebrow { margin: 0 0 8px; color: #8c9bb3; font-size: 13px; }
.eyebrow span { color: #6dd9c3; }
h1 { margin: 0; font-size: clamp(18px, 3vw, 26px); overflow-wrap: anywhere; }
button { flex-shrink: 0; border: 1px solid #40526e; border-radius: 6px; padding: 10px 14px; color: #e5eaf3; background: #1d293c; cursor: pointer; }
button:hover { background: #293b55; }
button:disabled { opacity: .5; cursor: wait; }
.player { position: relative; width: 100%; aspect-ratio: 16 / 9; background: #000; border: 1px solid #263247; border-radius: 8px; overflow: hidden; }
.player video, .player iframe { display: block; width: 100%; height: 100%; border: 0; }
.player-message { position: absolute; inset: 0; display: grid; place-content: center; padding: 24px; text-align: center; background: #0b101a; color: #aab8cf; }
.buffering { position: absolute; top: 14px; left: 14px; padding: 6px 10px; border-radius: 4px; background: #10141dcc; pointer-events: none; }
.hint { color: #8c9bb3; font-size: 13px; line-height: 1.6; }
@media (max-width: 600px) { .live-page { padding: 16px; } header { align-items: flex-start; flex-direction: column; gap: 14px; } }
</style>
