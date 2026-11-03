/** [changmen 扩展] 下单时的合场盘口快照；与场馆原生赛事/市场身份分开。 */
export interface OrderMarketIdentity {
  matchId: number;
  betId: number;
  /** 0=全场，正数=地图序号，-1=特殊盘口；不从名称反推。 */
  round: number;
  game: string;
  matchTitle: string;
  betName: string;
  startAt?: number;
  marketCode?: string;
  line?: number;
}

/** 只接收明确身份并拷贝白名单；缺失的历史记录保持未知。 */
export function normalizeOrderMarketIdentity(value: unknown): OrderMarketIdentity | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const row = value as Record<string, unknown>;
  if (!Number.isSafeInteger(row.matchId) || Number(row.matchId) <= 0
    || !Number.isSafeInteger(row.betId) || Number(row.betId) <= 0
    || !Number.isSafeInteger(row.round) || Number(row.round) < -1
    || [row.game, row.matchTitle, row.betName].some(text => typeof text !== "string" || text.length > 10000))
    return undefined;
  return { matchId: Number(row.matchId), betId: Number(row.betId), round: Number(row.round),
    game: row.game as string, matchTitle: row.matchTitle as string, betName: row.betName as string,
    ...(typeof row.startAt === "number" && Number.isSafeInteger(row.startAt) && row.startAt > 0 ? { startAt: row.startAt } : {}),
    ...(typeof row.marketCode === "string" && row.marketCode.length <= 200 ? { marketCode: row.marketCode } : {}),
    ...(typeof row.line === "number" && Number.isFinite(row.line) ? { line: row.line } : {}) };
}

/** 已记录的策略身份不可被后续平台拉单覆盖，名称快照也保持首次记录。 */
export function mergeOrderMarketIdentity(previous: unknown, incoming: unknown): OrderMarketIdentity | undefined {
  return normalizeOrderMarketIdentity(previous) ?? normalizeOrderMarketIdentity(incoming);
}

/** 在持有合场对象时取快照，不要求有可下注的场馆 item。 */
export function captureOrderMarketIdentity(
  match: { id: number; game: string; title: string; startAt?: number },
  bet: { id: number; round: number; getBetName: () => string; marketCode?: string; line?: number | null },
): OrderMarketIdentity | undefined {
  // 旧队列/独立平台调用可能没有完整合场模型；旁路身份缺失不能阻断下单。
  if (typeof bet.getBetName !== "function") return undefined;
  return normalizeOrderMarketIdentity({ matchId: match.id, betId: bet.id, round: bet.round,
    game: match.game, matchTitle: match.title, betName: bet.getBetName(), startAt: match.startAt,
    marketCode: bet.marketCode, line: bet.line });
}
