import type { PlatformId } from "@changmen/api-contract";
import type { BetSide } from "@changmen/client-core/models/match";
import type { PmUpPrefs } from "./upSettings";
import { normalizePmUpPrefs } from "./upSettings";

export interface PmUpTarget {
  provider: PlatformId;
  itemId: string;
  odds: number;
}

export interface PmUpMarket {
  key: string;
  assetId: string;
  matchId: number;
  betId: number;
  matchTitle: string;
  marketTitle: string;
  pmSide: BetSide;
  pmSideLabel: string;
  targetSide: BetSide;
  targetSideLabel: string;
  targets: PmUpTarget[];
}

export interface PmUpObservation extends PmUpMarket {
  bestAsk: number;
  receivedAt: number;
}

export interface PmUpSignal extends Omit<PmUpMarket, "targets"> {
  id: string;
  beforeOdds: number;
  pmOdds: number;
  risePct: number;
  baselineAt: number;
  detectedAt: number;
  target: PmUpTarget;
  arbPct: number;
}

interface Sample { odds: number; at: number }
interface State {
  samples: Sample[];
  last: Sample;
  emitted: Map<string, number>;
}

/** 原始 PM ask 下降 = 十进制赔率上涨；只在新涨价事件检查对侧场馆。 */
export class PmUpDetector {
  private readonly states = new Map<string, State>();
  private readonly config: PmUpPrefs;
  private sequence = 0;

  constructor(config: PmUpPrefs) {
    this.config = normalizePmUpPrefs(config);
  }

  retain(keys: ReadonlySet<string>): void {
    for (const key of this.states.keys()) {
      if (!keys.has(key)) this.states.delete(key);
    }
  }

  forget(key: string): void {
    this.states.delete(key);
  }

  push(quote: PmUpObservation): PmUpSignal[] {
    const { key, bestAsk, receivedAt } = quote;
    if (!key || !Number.isFinite(receivedAt) || receivedAt <= 0) return [];
    let state = this.states.get(key);
    if (state && receivedAt < state.last.at) return [];
    if (!Number.isFinite(bestAsk) || bestAsk <= 0 || bestAsk >= 1) {
      this.forget(key);
      return [];
    }
    const odds = 1 / bestAsk;
    const cutoff = receivedAt - this.config.windowMs;
    if (!state || state.last.at < cutoff) {
      if (this.states.size >= 4_096) this.states.delete(this.states.keys().next().value!);
      // 行情断档只重建价格基线；场馆信号冷却仍按最后一次真实触发计时。
      state = { samples: [], last: { odds, at: receivedAt }, emitted: state?.emitted ?? new Map() };
    }
    const rising = odds > state.last.odds;
    state.samples = state.samples.filter(sample => sample.at >= cutoff).slice(-511);
    const baseline = state.samples.reduce<Sample | undefined>((best, sample) => (
      !best || sample.odds < best.odds ? sample : best
    ), undefined);
    state.samples.push({ odds, at: receivedAt });
    state.last = { odds, at: receivedAt };
    this.states.delete(key);
    this.states.set(key, state);
    if (!rising || !baseline) return [];
    const risePct = (odds / baseline.odds - 1) * 100;
    if (risePct + 1e-9 < this.config.minRisePct) return [];

    const { targets, bestAsk: _ask, receivedAt: _at, ...market } = quote;
    const signals: PmUpSignal[] = [];
    for (const target of targets) {
      if (target.provider === "Polymarket" || !Number.isFinite(target.odds) || target.odds <= 1) continue;
      const arbPct = (1 / (1 / odds + 1 / target.odds) - 1) * 100;
      // 即使阈值为 0，也必须有正套利空间。
      if (arbPct <= 0 || arbPct + 1e-9 < this.config.minArbPct) continue;
      const targetKey = `${target.provider}:${target.itemId}`;
      const lastAt = state.emitted.get(targetKey);
      if (lastAt !== undefined && receivedAt - lastAt < this.config.cooldownMs) continue;
      state.emitted.set(targetKey, receivedAt);
      signals.push({
        ...market,
        id: `${key}:${targetKey}:${receivedAt}:${++this.sequence}`,
        beforeOdds: baseline.odds,
        pmOdds: odds,
        risePct,
        baselineAt: baseline.at,
        detectedAt: receivedAt,
        target: { ...target },
        arbPct,
      });
    }
    return signals;
  }
}
