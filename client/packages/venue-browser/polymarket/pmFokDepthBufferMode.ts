/** [changmen 扩展] Extensions `pmFokDepthBuffer` 运行时镜像（web userStore 同步） */
export interface PmFokDepthBufferPrefs {
  enabled: boolean;
  /** 成交价及更优档须 ≥ 本金 × multiplier；默认 1.5 */
  multiplier: number;
}

const DEFAULT_MULTIPLIER = 1.5;

let runtimePrefs: PmFokDepthBufferPrefs = {
  enabled: false,
  multiplier: DEFAULT_MULTIPLIER,
};

export function setPmFokDepthBufferPrefs(prefs: PmFokDepthBufferPrefs | null | undefined): void {
  runtimePrefs = {
    enabled: prefs?.enabled === true,
    multiplier: normalizePmFokDepthBufferMultiplier(prefs?.multiplier),
  };
}

export function getPmFokDepthBufferPrefs(): PmFokDepthBufferPrefs {
  return { ...runtimePrefs };
}

export function resetPmFokDepthBufferPrefsForTests(): void {
  runtimePrefs = { enabled: false, multiplier: DEFAULT_MULTIPLIER };
}

export function normalizePmFokDepthBufferMultiplier(raw: unknown): number {
  const n = Number(raw);
  if (Number.isFinite(n) && n >= 1.1 && n <= 10)
    return Math.round(n * 10) / 10;
  return DEFAULT_MULTIPLIER;
}

/** 关（默认）时 caller 必须走原 1× 路径。 */
export function isPmFokDepthBufferActive(prefs: PmFokDepthBufferPrefs = runtimePrefs): boolean {
  return prefs.enabled === true && prefs.multiplier > 1;
}

/** 预检缓存比对：关=1，开=倍数。 */
export function pmFokDepthReuseMultiplier(prefs: PmFokDepthBufferPrefs = runtimePrefs): number {
  return isPmFokDepthBufferActive(prefs) ? prefs.multiplier : 1;
}

/** 成交价 P 及更优档的名义金额（USDC）。关开关时 caller 不调用。 */
export function pmFokFillPriceDepthUsdc(
  asks: Array<{ price: number; size: number }>,
  fillPrice: number,
): number {
  let sum = 0;
  for (const level of asks) {
    if (!(level.price <= fillPrice + 1e-9))
      continue;
    sum += level.price * level.size;
  }
  return sum;
}

/** 开：本金 × 倍数；关：null（caller 跳过）。 */
export function pmFokDepthBufferNeedUsdc(
  amountUsdc: number,
  prefs: PmFokDepthBufferPrefs = runtimePrefs,
): number | null {
  if (!isPmFokDepthBufferActive(prefs))
    return null;
  return amountUsdc * prefs.multiplier;
}
