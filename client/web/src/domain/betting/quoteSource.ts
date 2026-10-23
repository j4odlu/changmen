import type { PlatformId } from "@/types/esport";

/** [changmen 扩展] 只读行情端口；实现由应用层提供，规则在原有分支内按需取数。 */
export interface DetectionQuoteSource {
  getEntry(provider: PlatformId, itemId: string): Readonly<{
    clobPrice?: number;
    marketId?: string;
  }> | undefined;
  getPmQuoteEntry(itemId: string): Readonly<{
    clobPrice?: number;
    odds?: number;
    isLock?: boolean;
  }> | undefined;
}
