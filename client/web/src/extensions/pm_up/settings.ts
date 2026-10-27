/** [changmen 扩展] pm_up 仅检测、展示；不参与选号、下单或 POD。 */
export interface PmUpPrefs {
  enabled: boolean;
  minRisePct: number;
  minArbPct: number;
  windowMs: number;
  cooldownMs: number;
}

export function createDefaultPmUpPrefs(): PmUpPrefs {
  return { enabled: false, minRisePct: 0, minArbPct: 1, windowMs: 5_000, cooldownMs: 10_000 };
}

export function normalizePmUpPrefs(raw: unknown): PmUpPrefs {
  const defaults = createDefaultPmUpPrefs();
  const row = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const number = (key: keyof PmUpPrefs, min: number, max: number): number => {
    const value = row[key];
    return typeof value === "number" && Number.isFinite(value)
      ? Math.min(max, Math.max(min, value)) : defaults[key] as number;
  };
  return {
    enabled: row.enabled === true,
    minRisePct: number("minRisePct", 0, 1_000),
    minArbPct: number("minArbPct", 0, 100),
    windowMs: number("windowMs", 500, 60_000),
    cooldownMs: number("cooldownMs", 0, 300_000),
  };
}
