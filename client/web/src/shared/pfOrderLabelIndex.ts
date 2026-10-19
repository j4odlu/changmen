/**
 * 订单侧栏：确保 PredictFun MarketIndex 已灌入内存，供裸 ID → 队名升级。
 * 采集器未跑时 OrderList 仍能靠这一次 GetCollectPlatform 对齐 PM 可读文案。
 */
import { getCollectPlatform } from "@/api/platform";
import {
  isPredictFunMarketIndex,
  rememberPredictFunTokenMarketIds,
} from "@changmen/venue-browser/adapter/predictfun";

let inflight: Promise<boolean> | null = null;
let lastOkAt = 0;
const COOLDOWN_MS = 15_000;

export async function ensurePfOrderLabelIndex(force = false): Promise<boolean> {
  if (!force && Date.now() - lastOkAt < COOLDOWN_MS && inflight == null)
    return lastOkAt > 0;
  if (inflight)
    return inflight;

  inflight = (async () => {
    try {
      const platform = await getCollectPlatform("PredictFun");
      const index = platform?.MarketIndex;
      if (!isPredictFunMarketIndex(index))
        return false;
      rememberPredictFunTokenMarketIds(index);
      lastOkAt = Date.now();
      return true;
    }
    catch {
      return false;
    }
    finally {
      inflight = null;
    }
  })();

  return inflight;
}

/** 测试用 */
export function __resetPfOrderLabelIndexForTests(): void {
  inflight = null;
  lastOkAt = 0;
}
