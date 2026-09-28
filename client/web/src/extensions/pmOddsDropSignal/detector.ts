export interface PmOddsDropDetectorConfig {
  windowMs: number;
  thresholdPct: number;
  cooldownMs: number;
}

export interface PmOddsDropQuote {
  assetId: string;
  bestAsk: number;
  receivedAt: number;
}

export interface PmOddsDropSignal {
  id: string;
  assetId: string;
  beforeBestAsk: number;
  currentBestAsk: number;
  beforeOdds: number;
  currentOdds: number;
  dropPct: number;
  windowMs: number;
  baselineAt: number;
  detectedAt: number;
}

interface QuoteSample {
  bestAsk: number;
  decimalOdds: number;
  receivedAt: number;
}

interface AssetState {
  samples: QuoteSample[];
  lastSignalAt: number;
}

const MAX_SAMPLES_PER_ASSET = 512;
const MAX_TRACKED_ASSETS = 4_096;

export const DEFAULT_PM_ODDS_DROP_CONFIG: PmOddsDropDetectorConfig = {
  windowMs: 5_000,
  thresholdPct: 5,
  cooldownMs: 10_000,
};

function normalizeConfig(config: PmOddsDropDetectorConfig): PmOddsDropDetectorConfig {
  return {
    windowMs: Math.min(Math.max(500, Number(config.windowMs) || 0), 60_000),
    thresholdPct: Math.min(Math.max(0.1, Number(config.thresholdPct) || 0), 90),
    cooldownMs: Math.min(Math.max(0, Number(config.cooldownMs) || 0), 5 * 60_000),
  };
}

/**
 * PM 降赔率纯检测器。
 * bestAsk 是概率价；bestAsk 上升时十进制赔率 1 / bestAsk 下降。
 * 模块不读取比赛、账号或套利状态，也不执行下注。
 */
export class PmOddsDropDetector {
  private config: PmOddsDropDetectorConfig;
  private readonly byAsset = new Map<string, AssetState>();
  private sequence = 0;

  constructor(config: PmOddsDropDetectorConfig = DEFAULT_PM_ODDS_DROP_CONFIG) {
    this.config = normalizeConfig(config);
  }

  updateConfig(config: PmOddsDropDetectorConfig): void {
    this.config = normalizeConfig(config);
  }

  reset(): void {
    this.byAsset.clear();
    this.sequence = 0;
  }

  push(
    quote: PmOddsDropQuote,
    shouldEmit: (currentOdds: number) => boolean = () => true,
  ): PmOddsDropSignal | null {
    const assetId = String(quote.assetId || "").trim();
    const bestAsk = Number(quote.bestAsk);
    const receivedAt = Number(quote.receivedAt);
    if (!assetId || !Number.isFinite(bestAsk) || bestAsk <= 0 || bestAsk >= 1)
      return null;
    if (!Number.isFinite(receivedAt) || receivedAt <= 0)
      return null;

    const decimalOdds = 1 / bestAsk;
    let state = this.byAsset.get(assetId);
    if (!state) {
      if (this.byAsset.size >= MAX_TRACKED_ASSETS) {
        const oldestAssetId = this.byAsset.keys().next().value as string | undefined;
        if (oldestAssetId)
          this.byAsset.delete(oldestAssetId);
      }
      state = { samples: [], lastSignalAt: 0 };
    }
    const cutoff = receivedAt - this.config.windowMs;
    state.samples = state.samples.filter(sample => sample.receivedAt >= cutoff && sample.receivedAt <= receivedAt);
    if (state.samples.length >= MAX_SAMPLES_PER_ASSET)
      state.samples = state.samples.slice(-(MAX_SAMPLES_PER_ASSET - 1));

    let baseline: QuoteSample | null = null;
    for (const sample of state.samples) {
      if (!baseline || sample.decimalOdds > baseline.decimalOdds)
        baseline = sample;
    }

    state.samples.push({ bestAsk, decimalOdds, receivedAt });
    // Map 同时作为 LRU：活跃 asset 移到末尾，满额时优先淘汰长期无行情的 asset。
    this.byAsset.delete(assetId);
    this.byAsset.set(assetId, state);

    if (!baseline || decimalOdds >= baseline.decimalOdds)
      return null;

    const dropPct = ((baseline.decimalOdds - decimalOdds) / baseline.decimalOdds) * 100;
    if (dropPct + Number.EPSILON < this.config.thresholdPct)
      return null;
    // 范围外样本仍作为滚动基线，但不占用 cooldown，避免压制随后进入范围的信号。
    if (!shouldEmit(decimalOdds))
      return null;
    if (state.lastSignalAt > 0 && receivedAt - state.lastSignalAt < this.config.cooldownMs)
      return null;

    state.lastSignalAt = receivedAt;
    this.sequence += 1;
    return {
      id: `${assetId}:${receivedAt}:${this.sequence}`,
      assetId,
      beforeBestAsk: baseline.bestAsk,
      currentBestAsk: bestAsk,
      beforeOdds: baseline.decimalOdds,
      currentOdds: decimalOdds,
      dropPct,
      windowMs: receivedAt - baseline.receivedAt,
      baselineAt: baseline.receivedAt,
      detectedAt: receivedAt,
    };
  }
}
