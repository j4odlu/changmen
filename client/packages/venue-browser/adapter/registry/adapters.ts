import type { PlatformAccount } from "@changmen/client-core/models/platformAccount";
import type { CollectorFactory, PlatformAdapter, PlatformProvider } from "../contract";
import type { PlatformId } from "@changmen/api-contract";
import { withA8ResolveLegOutcome } from "../adaptation/a8LegOutcome";
import { azuroAdapter } from "../azuro";
import { predictFunAdapter } from "../predictfun";
import { dexAdapter } from "../dex";
import { hgAdapter } from "../hg";
import { iaAdapter } from "../ia";
import { imAdapter } from "../im";
import { imtAdapter } from "../imt";
import { limitlessAdapter } from "../limitless";
import { obAdapter } from "../ob";
import { pbAdapter } from "../pb";
import { polymarketAdapter } from "../polymarket";
import { rayAdapter } from "../ray";
import { sabaAdapter } from "../saba";
import { sxbetAdapter } from "../sxbet";
import { stakeAdapter } from "../stake";
import { tfAdapter } from "../tf";
import { xbetAdapter } from "../xbet";
import {
  betPlatformIds,
  collectPlatformIds,
  getPlatformMeta,
  platformSupportsBet,
} from "./meta";

/** 全平台适配器 — 对齐 A8 `bf.GetProvider` 注册表 */
export const PLATFORM_ADAPTERS: PlatformAdapter[] = [
  obAdapter,
  imAdapter,
  rayAdapter,
  tfAdapter,
  iaAdapter,
  sabaAdapter,
  xbetAdapter,
  pbAdapter,
  imtAdapter,
  hgAdapter,
  stakeAdapter,
  dexAdapter,
  polymarketAdapter,
  limitlessAdapter,
  sxbetAdapter,
  azuroAdapter,
  predictFunAdapter,
];

const adapterById = new Map<PlatformId, PlatformAdapter>(
  PLATFORM_ADAPTERS.map(a => [a.id, a]),
);

export function getAdapter(id: PlatformId): PlatformAdapter | undefined {
  return adapterById.get(id);
}

/** 对齐 A8 `bf.GetProvider(account)`：只返回支持下注的 provider。 */
export function getProvider(account: PlatformAccount): PlatformProvider | undefined {
  if (!account.provider || !platformSupportsBet(account.provider))
    return undefined;
  const provider = adapterById.get(account.provider)?.provider;
  if (!provider)
    return undefined;
  return withA8ResolveLegOutcome(provider);
}

export function getCollectorFactory(id: PlatformId): CollectorFactory | undefined {
  return adapterById.get(id)?.collector;
}

export function buildCollectorFactories(): Partial<Record<PlatformId, CollectorFactory>> {
  const map: Partial<Record<PlatformId, CollectorFactory>> = {};
  for (const id of collectPlatformIds()) {
    const factory = getCollectorFactory(id);
    if (factory)
      map[id] = factory;
  }
  return map;
}

export function supportedBetProviders(): PlatformId[] {
  return betPlatformIds();
}

if (import.meta.env.DEV) {
  const expectedCollect = new Set(collectPlatformIds());
  for (const adapter of PLATFORM_ADAPTERS) {
    if (adapter.collector && !expectedCollect.has(adapter.id)) {
      console.warn(`[platform_adapter] 未在 manifest 声明采集: ${adapter.id}`);
    }
  }
  for (const id of collectPlatformIds()) {
    if (!getCollectorFactory(id)) {
      console.warn(`[platform_adapter] manifest 声明采集但未注册 collector: ${id}`);
    }
  }
  for (const adapter of PLATFORM_ADAPTERS) {
    if (platformSupportsBet(adapter.id) && !adapter.provider) {
      console.warn(`[platform_adapter] manifest bet:true 但缺少 provider: ${adapter.id}`);
    }
  }
  for (const adapter of PLATFORM_ADAPTERS) {
    const meta = getPlatformMeta(adapter.id);
    if (!meta) {
      console.warn(`[platform_adapter] adapter 未在 manifest 中: ${adapter.id}`);
    }
  }
}
