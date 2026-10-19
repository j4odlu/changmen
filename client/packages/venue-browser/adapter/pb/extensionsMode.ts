/**
 * [changmen 扩展] PB 采集模式。
 * 默认关 = A8 `YY`/`mHe`（仅 live 写 fo，不上报 RotNum，不启 WS 观测）。
 * 开 = 双循环 + 赛前写 fo + SaveMatch.RotNum + WS 影子。
 */
let changmenExtensions = false;

export function setPbChangmenExtensions(on: boolean): void {
  changmenExtensions = on === true;
}

export function isPbChangmenExtensions(): boolean {
  return changmenExtensions;
}

/** A8 `mHe`：仅 live 写 fo / refreshOddsOnBets */
export function isPbLiveFoOnly(): boolean {
  return !changmenExtensions;
}

/** changmen 才拉 prematch euro/odds（A8 无此路径） */
export function isPbPrematchCollectEnabled(): boolean {
  return changmenExtensions;
}

/** @deprecated 用 setPbChangmenExtensions；保留以免旧调用方炸 */
export function setPbLiveFoOnly(on: boolean): void {
  changmenExtensions = on !== true;
}
