import { getPmMarketWsSourceMode } from "./pmMarketWsMode";
import { resolvePmHttpMode, type PmHttpMode } from "./pmTransportMode";
import { resolvePmOrderSubmitHttpMode } from "./pmOrderSubmitMode";

export type PmBookSource = "direct-live" | "vps-live" | "vps-fallback" | "extension" | "unknown";
export type PmQuoteSource = "ws" | "http-seed" | "book-correct";
export type PmExecutionMetricKind = "submit_ack" | "clock_sample" | "outbound_prepare" | "prepared_wait" | "serial_wait" | "gamma" | "upstream_auth" | "upstream_post" | "runtime" | "guard" | "clock" | "pair_check" | "dispatch" | "quote_to_fo" | "book" | "check" | "sign" | "submit" | "betting";

export interface PmExecutionMetricEntry {
  at: number;
  kind: PmExecutionMetricKind;
  tokenId?: string;
  stage?: string;
  linkId?: number;
  requestCount?: number;
  directMs?: number;
  fallbackMs?: number;
  clockSource?: string;
  clockSampleAgeMs?: number;
  accountId?: number;
  wsSource: "changmen" | "official";
  httpMode: PmHttpMode;
  ms?: number;
  bookSource?: PmBookSource;
  quoteSource?: PmQuoteSource;
  quotePrice?: number;
  betId?: string;
  side?: "home" | "away";
  rejectReason?: string;
  success?: boolean;
  fallback?: boolean;
  error?: string;
  builderCodePresent?: boolean;
  apiCredsReady?: boolean;
  privateKeyReady?: boolean;
  signatureType?: number;
  funderPresent?: boolean;
  bookReuse?: boolean;
  bookAgeMs?: number;
  reuseRejectReason?: string;
  signWarm?: boolean;
  orderClientCacheHit?: boolean;
  detectionOdds?: number;
  detectionMaxPrice?: number;
  bookPrice?: number;
  fillPrice?: number;
  limitPrice?: number;
  tickSize?: number;
  apiBetMoney?: number;
  depthAvailableAtCap?: number;
  depthNeedUsdc?: number;
  minOrderSize?: number;
  submitStatus?: string;
}

export interface PmExecutionKindSummary {
  count: number;
  success: number;
  fail: number;
  p50Ms: number | null;
  p90Ms: number | null;
  p95Ms: number | null;
  maxMs: number | null;
}

export interface PmExecutionMetricsSummary {
  generatedAt: number;
  windowSize: number;
  total: number;
  byKind: Record<PmExecutionMetricKind, PmExecutionKindSummary>;
  book: {
    total: number;
    directLive: number;
    vpsLive: number;
    vpsFallback: number;
    extension: number;
    unknown: number;
    directLiveRate: number | null;
    fallbackRate: number | null;
  };
  bookReuse: {
    observed: number;
    hit: number;
    miss: number;
    hitRate: number | null;
    ageP50Ms: number | null;
    ageP90Ms: number | null;
    ageP95Ms: number | null;
    rejectReasons: Record<string, number>;
  };
  execution: {
    observed: number;
    detectionMaxPriceP50: number | null;
    bookPriceP50: number | null;
    fillPriceP50: number | null;
    limitPriceP50: number | null;
    apiBetMoneyP50: number | null;
    depthAvailableAtCapP50: number | null;
    depthNeedUsdcP50: number | null;
    submitStatuses: Record<string, number>;
  };
  sign: {
    observed: number;
    warm: number;
    cacheHit: number;
    warmRate: number | null;
    cacheHitRate: number | null;
  };
  quoteToFo: {
    total: number;
    success: number;
    fail: number;
    successRate: number | null;
    sources: Record<string, number>;
    rejectReasons: Record<string, number>;
  };
  recentErrors: Array<{
    at: number;
    kind: PmExecutionMetricKind;
    tokenId?: string;
    error?: string;
    rejectReason?: string;
    reuseRejectReason?: string;
  }>;
}

const MAX_ENTRIES = 300;
const entries: PmExecutionMetricEntry[] = [];
const quoteEntries: PmExecutionMetricEntry[] = [];

function errorText(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err ?? "");
  return raw.slice(0, 240);
}

export function recordPmExecutionMetric(
  entry: Omit<PmExecutionMetricEntry, "at" | "wsSource" | "httpMode"> & { httpMode?: PmHttpMode },
): void {
  const { httpMode, ...fields } = entry;
  const target = entry.kind === "quote_to_fo" ? quoteEntries : entries;
  target.push({
    at: Date.now(),
    wsSource: getPmMarketWsSourceMode(),
    httpMode: httpMode ?? (entry.kind === "submit" ? resolvePmOrderSubmitHttpMode() : resolvePmHttpMode()),
    ...fields,
  });
  if (target.length > MAX_ENTRIES)
    target.splice(0, target.length - MAX_ENTRIES);
}

export function recordPmQuoteToFoMetric(entry: {
  tokenId?: string;
  betId?: string;
  side?: "home" | "away";
  quotePrice?: number;
  quoteSource: PmQuoteSource;
  success: boolean;
  rejectReason?: string;
  error?: string;
}): void {
  recordPmExecutionMetric({
    kind: "quote_to_fo",
    ...entry,
  });
}

export async function measurePmExecution<T>(
  kind: PmExecutionMetricKind,
  fields: Omit<PmExecutionMetricEntry, "at" | "kind" | "wsSource" | "httpMode" | "ms" | "success" | "error">,
  fn: () => Promise<T>,
): Promise<T> {
  const startedAt = performanceNow();
  const httpMode = kind === "submit" ? resolvePmOrderSubmitHttpMode() : resolvePmHttpMode();
  try {
    const value = await fn();
    recordPmExecutionMetric({
      ...fields,
      kind,
      httpMode,
      ms: elapsedMs(startedAt),
      success: true,
    });
    return value;
  }
  catch (err) {
    recordPmExecutionMetric({
      ...fields,
      kind,
      httpMode,
      ms: elapsedMs(startedAt),
      success: false,
      error: errorText(err),
    });
    throw err;
  }
}

function performanceNow(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

function elapsedMs(startedAt: number): number {
  return Math.round(performanceNow() - startedAt);
}

export function getPmExecutionMetrics(): readonly PmExecutionMetricEntry[] {
  return [...entries, ...quoteEntries].sort((a, b) => a.at - b.at);
}

function emptyKindSummary(): PmExecutionKindSummary {
  return {
    count: 0,
    success: 0,
    fail: 0,
    p50Ms: null,
    p90Ms: null,
    p95Ms: null,
    maxMs: null,
  };
}

function metricKinds(): PmExecutionMetricKind[] {
  return ["submit_ack", "clock_sample", "outbound_prepare", "prepared_wait", "serial_wait", "gamma", "upstream_auth", "upstream_post", "runtime", "guard", "clock", "pair_check", "dispatch", "quote_to_fo", "book", "check", "sign", "submit", "betting"];
}

function percentile(values: number[], pct: number): number | null {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length)
    return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((pct / 100) * sorted.length) - 1));
  return sorted[index]!;
}

function rate(part: number, total: number): number | null {
  return total > 0 ? Number((part / total).toFixed(4)) : null;
}

function increment(map: Record<string, number>, key: string | undefined): void {
  const safeKey = key || "unknown";
  map[safeKey] = (map[safeKey] ?? 0) + 1;
}

export function getPmExecutionMetricsSummary(): PmExecutionMetricsSummary {
  const snapshot = [...getPmExecutionMetrics()];
  const byKind = Object.fromEntries(metricKinds().map(kind => [kind, emptyKindSummary()])) as Record<PmExecutionMetricKind, PmExecutionKindSummary>;
  const durations = Object.fromEntries(metricKinds().map(kind => [kind, [] as number[]])) as Record<PmExecutionMetricKind, number[]>;
  const book = {
    total: 0,
    directLive: 0,
    vpsLive: 0,
    vpsFallback: 0,
    extension: 0,
    unknown: 0,
    directLiveRate: null as number | null,
    fallbackRate: null as number | null,
  };
  const bookReuse = {
    observed: 0,
    hit: 0,
    miss: 0,
    hitRate: null as number | null,
    ageP50Ms: null as number | null,
    ageP90Ms: null as number | null,
    ageP95Ms: null as number | null,
    rejectReasons: {} as Record<string, number>,
  };
  const sign = {
    observed: 0,
    warm: 0,
    cacheHit: 0,
    warmRate: null as number | null,
    cacheHitRate: null as number | null,
  };
  const execution = {
    observed: 0,
    detectionMaxPriceP50: null as number | null,
    bookPriceP50: null as number | null,
    fillPriceP50: null as number | null,
    limitPriceP50: null as number | null,
    apiBetMoneyP50: null as number | null,
    depthAvailableAtCapP50: null as number | null,
    depthNeedUsdcP50: null as number | null,
    submitStatuses: {} as Record<string, number>,
  };
  const quoteToFo = {
    total: 0,
    success: 0,
    fail: 0,
    successRate: null as number | null,
    sources: {} as Record<string, number>,
    rejectReasons: {} as Record<string, number>,
  };
  const bookAgeMs: number[] = [];
  const detectionMaxPrices: number[] = [];
  const bookPrices: number[] = [];
  const fillPrices: number[] = [];
  const limitPrices: number[] = [];
  const apiBetMoneys: number[] = [];
  const depthAvailableAtCaps: number[] = [];
  const depthNeedUsdcs: number[] = [];

  for (const row of snapshot) {
    const kindSummary = byKind[row.kind];
    kindSummary.count += 1;
    if (row.success === true)
      kindSummary.success += 1;
    else if (row.success === false)
      kindSummary.fail += 1;
    if (typeof row.ms === "number" && Number.isFinite(row.ms))
      durations[row.kind].push(row.ms);

    if (row.kind === "book") {
      book.total += 1;
      if (row.bookSource === "direct-live")
        book.directLive += 1;
      else if (row.bookSource === "vps-live")
        book.vpsLive += 1;
      else if (row.bookSource === "vps-fallback")
        book.vpsFallback += 1;
      else if (row.bookSource === "extension")
        book.extension += 1;
      else
        book.unknown += 1;
    }

    if (row.bookReuse !== undefined) {
      bookReuse.observed += 1;
      if (row.bookReuse)
        bookReuse.hit += 1;
      else
        bookReuse.miss += 1;
      if (typeof row.bookAgeMs === "number" && Number.isFinite(row.bookAgeMs))
        bookAgeMs.push(row.bookAgeMs);
      if (row.reuseRejectReason)
        increment(bookReuse.rejectReasons, row.reuseRejectReason);
    }

    if (row.kind === "sign") {
      sign.observed += 1;
      if (row.signWarm)
        sign.warm += 1;
      if (row.orderClientCacheHit)
        sign.cacheHit += 1;
    }

    if (
      row.detectionMaxPrice !== undefined ||
      row.bookPrice !== undefined ||
      row.fillPrice !== undefined ||
      row.limitPrice !== undefined ||
      row.apiBetMoney !== undefined ||
      row.depthAvailableAtCap !== undefined
    ) {
      execution.observed += 1;
      if (typeof row.detectionMaxPrice === "number" && Number.isFinite(row.detectionMaxPrice))
        detectionMaxPrices.push(row.detectionMaxPrice);
      if (typeof row.bookPrice === "number" && Number.isFinite(row.bookPrice))
        bookPrices.push(row.bookPrice);
      if (typeof row.fillPrice === "number" && Number.isFinite(row.fillPrice))
        fillPrices.push(row.fillPrice);
      if (typeof row.limitPrice === "number" && Number.isFinite(row.limitPrice))
        limitPrices.push(row.limitPrice);
      if (typeof row.apiBetMoney === "number" && Number.isFinite(row.apiBetMoney))
        apiBetMoneys.push(row.apiBetMoney);
      if (typeof row.depthAvailableAtCap === "number" && Number.isFinite(row.depthAvailableAtCap))
        depthAvailableAtCaps.push(row.depthAvailableAtCap);
      if (typeof row.depthNeedUsdc === "number" && Number.isFinite(row.depthNeedUsdc))
        depthNeedUsdcs.push(row.depthNeedUsdc);
    }

    if (row.submitStatus)
      increment(execution.submitStatuses, row.submitStatus);

    if (row.kind === "quote_to_fo") {
      quoteToFo.total += 1;
      if (row.success)
        quoteToFo.success += 1;
      else
        quoteToFo.fail += 1;
      increment(quoteToFo.sources, row.quoteSource);
      if (row.rejectReason)
        increment(quoteToFo.rejectReasons, row.rejectReason);
    }
  }

  for (const kind of metricKinds()) {
    const values = durations[kind];
    byKind[kind].p50Ms = percentile(values, 50);
    byKind[kind].p90Ms = percentile(values, 90);
    byKind[kind].p95Ms = percentile(values, 95);
    byKind[kind].maxMs = values.length ? Math.max(...values) : null;
  }

  book.directLiveRate = rate(book.directLive, book.total);
  book.fallbackRate = rate(book.vpsFallback, book.total);
  bookReuse.hitRate = rate(bookReuse.hit, bookReuse.observed);
  bookReuse.ageP50Ms = percentile(bookAgeMs, 50);
  bookReuse.ageP90Ms = percentile(bookAgeMs, 90);
  bookReuse.ageP95Ms = percentile(bookAgeMs, 95);
  sign.warmRate = rate(sign.warm, sign.observed);
  sign.cacheHitRate = rate(sign.cacheHit, sign.observed);
  execution.detectionMaxPriceP50 = percentile(detectionMaxPrices, 50);
  execution.bookPriceP50 = percentile(bookPrices, 50);
  execution.fillPriceP50 = percentile(fillPrices, 50);
  execution.limitPriceP50 = percentile(limitPrices, 50);
  execution.apiBetMoneyP50 = percentile(apiBetMoneys, 50);
  execution.depthAvailableAtCapP50 = percentile(depthAvailableAtCaps, 50);
  execution.depthNeedUsdcP50 = percentile(depthNeedUsdcs, 50);
  quoteToFo.successRate = rate(quoteToFo.success, quoteToFo.total);

  return {
    generatedAt: Date.now(),
    windowSize: MAX_ENTRIES,
    total: snapshot.length,
    byKind,
    book,
    bookReuse,
    execution,
    sign,
    quoteToFo,
    recentErrors: snapshot
      .filter(row => row.success === false || row.error || row.rejectReason || row.reuseRejectReason)
      .slice(-8)
      .reverse()
      .map(row => ({
        at: row.at,
        kind: row.kind,
        tokenId: row.tokenId,
        error: row.error,
        rejectReason: row.rejectReason,
        reuseRejectReason: row.reuseRejectReason,
      })),
  };
}

export function clearPmExecutionMetrics(): void {
  entries.length = 0;
  quoteEntries.length = 0;
}
