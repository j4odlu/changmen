import { getPmMarketWsSourceMode, type PmMarketWsSourceMode } from "./pmMarketWsMode";

export interface PmMarketClientMetricsSnapshot {
  mode: PmMarketWsSourceMode;
  connectStartedAt: number;
  connectedAt: number;
  subscribedAt: number;
  lastFrameAt: number;
  lastQuoteAt: number;
  connectMs: number | null;
  firstFrameMs: number | null;
  firstQuoteMs: number | null;
  quoteFreshMs: number | null;
  assetCount: number;
  connectionAttemptCount: number;
  reconnectCount: number;
  emptyBookCount: number;
  fallbackReason: string;
  lastReason: string;
  lastError: string;
}

const metrics: PmMarketClientMetricsSnapshot = {
  mode: getPmMarketWsSourceMode(),
  connectStartedAt: 0,
  connectedAt: 0,
  subscribedAt: 0,
  lastFrameAt: 0,
  lastQuoteAt: 0,
  connectMs: null,
  firstFrameMs: null,
  firstQuoteMs: null,
  quoteFreshMs: null,
  assetCount: 0,
  connectionAttemptCount: 0,
  reconnectCount: 0,
  emptyBookCount: 0,
  fallbackReason: "",
  lastReason: "",
  lastError: "",
};

function nowMs(): number {
  return Date.now();
}

function syncMode(): void {
  metrics.mode = getPmMarketWsSourceMode();
}

export function notePmMarketClientConnectStart(reason = "connect_start"): void {
  syncMode();
  metrics.connectStartedAt = nowMs();
  metrics.connectedAt = 0;
  metrics.subscribedAt = 0;
  metrics.lastFrameAt = 0;
  metrics.lastQuoteAt = 0;
  metrics.connectMs = null;
  metrics.firstFrameMs = null;
  metrics.firstQuoteMs = null;
  metrics.quoteFreshMs = null;
  metrics.assetCount = 0;
  metrics.lastReason = reason;
  metrics.lastError = "";
  metrics.connectionAttemptCount += 1;
  if (metrics.connectionAttemptCount > 1)
    metrics.reconnectCount += 1;
}

export function notePmMarketClientConnected(reason = "connected"): void {
  syncMode();
  const now = nowMs();
  metrics.connectedAt = now;
  metrics.connectMs = metrics.connectStartedAt ? Math.max(0, now - metrics.connectStartedAt) : null;
  metrics.lastReason = reason;
  metrics.lastError = "";
}

export function notePmMarketClientSubscription(assetCount: number): void {
  syncMode();
  metrics.assetCount = Math.max(0, Number(assetCount) || 0);
  metrics.subscribedAt = metrics.assetCount ? nowMs() : 0;
  metrics.firstFrameMs = null;
  metrics.firstQuoteMs = null;
  metrics.quoteFreshMs = null;
  if (!metrics.assetCount)
    metrics.emptyBookCount = 0;
  metrics.lastReason = metrics.assetCount ? "subscribed_assets" : "no_assets";
}

export function notePmMarketClientFrame(): void {
  const now = nowMs();
  metrics.lastFrameAt = now;
  if (metrics.firstFrameMs == null) {
    const start = metrics.subscribedAt || metrics.connectedAt || metrics.connectStartedAt;
    metrics.firstFrameMs = start ? Math.max(0, now - start) : null;
  }
}

export function notePmMarketClientQuote(quoteTimestamp?: number): void {
  const now = nowMs();
  metrics.lastQuoteAt = now;
  if (metrics.firstQuoteMs == null) {
    const start = metrics.subscribedAt || metrics.connectedAt || metrics.connectStartedAt;
    metrics.firstQuoteMs = start ? Math.max(0, now - start) : null;
  }
  const ts = Number(quoteTimestamp || 0);
  metrics.quoteFreshMs = ts > 0 ? Math.max(0, now - ts) : 0;
  metrics.lastReason = "quote";
  metrics.lastError = "";
}

export function notePmMarketClientFallback(reason: string, error = ""): void {
  syncMode();
  metrics.fallbackReason = reason;
  metrics.lastReason = reason;
  metrics.lastError = error;
}

export function notePmMarketClientEmptyBook(reason: string, error = ""): void {
  metrics.emptyBookCount += 1;
  metrics.lastReason = reason;
  metrics.lastError = error;
}

export function notePmMarketClientError(reason: string, error = ""): void {
  metrics.lastReason = reason;
  metrics.lastError = error;
}

export function getPmMarketClientMetricsSnapshot(): PmMarketClientMetricsSnapshot {
  syncMode();
  return { ...metrics };
}

export function resetPmMarketClientMetricsForTests(): void {
  metrics.mode = getPmMarketWsSourceMode();
  metrics.connectStartedAt = 0;
  metrics.connectedAt = 0;
  metrics.subscribedAt = 0;
  metrics.lastFrameAt = 0;
  metrics.lastQuoteAt = 0;
  metrics.connectMs = null;
  metrics.firstFrameMs = null;
  metrics.firstQuoteMs = null;
  metrics.quoteFreshMs = null;
  metrics.assetCount = 0;
  metrics.connectionAttemptCount = 0;
  metrics.reconnectCount = 0;
  metrics.emptyBookCount = 0;
  metrics.fallbackReason = "";
  metrics.lastReason = "";
  metrics.lastError = "";
}
