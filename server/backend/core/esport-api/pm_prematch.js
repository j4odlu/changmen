/** [changmen 扩展] 批量附加 VPS 已保存的 C 行结果，API 不查询 PM。 */
import { fetchPmPrematchPrices } from "@changmen/db";

export async function attachPmPrematchPrices(matches, load = fetchPmPrematchPrices) {
  const tokensByMatch = matches.map(match => [...new Set((match.Bets || []).flatMap(bet => {
    const source = bet.Sources?.Polymarket;
    return source ? [String(source.HomeID || ""), String(source.AwayID || "")].filter(Boolean) : [];
  }))]);
  const snapshots = await load(tokensByMatch.flat());
  return matches.map((match, i) => ({ ...match,
    PmPrematch: Object.fromEntries(tokensByMatch[i].filter(id => snapshots[id]).map(id => [id, snapshots[id]])),
  }));
}
