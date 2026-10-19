/** 预检/下单：book best ask 高于检测限价时抛出，便于 catch 回写 fo */
export class PolymarketPriceAboveDetectionError extends Error {
  readonly bestAskPrice: number;
  readonly detectionMaxPrice: number;

  constructor(message: string, bestAskPrice: number, detectionMaxPrice: number) {
    super(message);
    this.name = "PolymarketPriceAboveDetectionError";
    this.bestAskPrice = bestAskPrice;
    this.detectionMaxPrice = detectionMaxPrice;
  }
}

export function isPolymarketPriceAboveDetectionError(
  err: unknown,
): err is PolymarketPriceAboveDetectionError {
  return err instanceof PolymarketPriceAboveDetectionError;
}
