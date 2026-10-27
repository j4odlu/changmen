type SwapField = "HomeID" | "AwayID" | "HomeOdds" | "AwayOdds" | "HomeMarketID" | "AwayMarketID";
type SourceFields = Partial<Record<SwapField, unknown>>;
type Field<T, K extends PropertyKey> = K extends keyof T ? T[K] : undefined;
type Coalesce<A, B> = Exclude<A, null | undefined>
  | (Extract<A, null | undefined> extends never ? never : B);

/** 保留额外字段；每个交换字段的类型来自对侧，marketId 沿用空值回退。 */
export type SwappedBetSource<T> = T extends ((...args: never[]) => unknown) | (abstract new (...args: never[]) => unknown)
  ? T : T extends object ? Omit<T, SwapField> & {
  HomeID: Field<T, "AwayID">;
  AwayID: Field<T, "HomeID">;
  HomeOdds: Field<T, "AwayOdds">;
  AwayOdds: Field<T, "HomeOdds">;
  HomeMarketID: Coalesce<Field<T, "AwayMarketID">, Field<T, "HomeMarketID">>;
  AwayMarketID: Coalesce<Field<T, "HomeMarketID">, Field<T, "AwayMarketID">>;
} : T;

/** 对调 Source 主客侧 */
export function swapBetSource<T>(src: T): SwappedBetSource<T>;
export function swapBetSource(src: unknown): unknown {
  if (!src || typeof src !== "object")
    return src;
  return {
    ...src,
    HomeID: (src as SourceFields).AwayID,
    AwayID: (src as SourceFields).HomeID,
    HomeOdds: (src as SourceFields).AwayOdds,
    AwayOdds: (src as SourceFields).HomeOdds,
    HomeMarketID: (src as SourceFields).AwayMarketID ?? (src as SourceFields).HomeMarketID,
    AwayMarketID: (src as SourceFields).HomeMarketID ?? (src as SourceFields).AwayMarketID,
  };
}
