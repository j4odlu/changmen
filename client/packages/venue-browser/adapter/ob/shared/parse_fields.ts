/** OB 赔率/盘口字段解析（HTTP game/view 与 MQTT 共用，无回传策略） */

export function num(v: unknown): number {
  if (typeof v === "number") return v;
  if (v && typeof (v as { toNumber?: () => number }).toNumber === "function") {
    return (v as { toNumber: () => number }).toNumber();
  }
  return Number(v) || 0;
}

function parseObOddValue(raw: unknown): number {
  if (raw === undefined || raw === null || raw === "") return 0;
  const n = num(raw);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** HTTP `odd`/`odds` 与 MQTT Decimal 字段统一解析 */
export function parseObOddField(odd: unknown): number {
  if (odd && typeof (odd as { toNumber?: () => number }).toNumber === "function") {
    const n = (odd as { toNumber: () => number }).toNumber();
    return Number.isFinite(n) && n > 0 ? n : 0;
  }
  if (typeof odd === "object" && odd !== null && ("odd" in odd || "odds" in odd)) {
    const row = odd as { odd?: unknown; odds?: unknown };
    return parseObOddValue(row.odd ?? row.odds);
  }
  return parseObOddValue(odd);
}

export function obBlockLabel(block: Record<string, unknown>): string {
  const round = num(block.round);
  const cn = String(block.cn_name ?? "").replace(/&nbsp;/g, "");
  return `[${round === 0 ? "全场" : `地图${round}`}]-${cn}`;
}
