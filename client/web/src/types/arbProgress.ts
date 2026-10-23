export interface ArbProgressPolymarketMeta {
  tokenId: string;
  tokenShort: string;
  detectionOdds: number;
  detectionMaxPrice: number;
  foClobPrice?: number;
  bookPrice?: number;
  apiBetMoney?: number;
  capSource: "clob" | "odds" | "locked";
}
