import { mergeOrderMarketIdentity } from "@changmen/shared/order_market_identity";
/** [changmen 扩展] 受理后建立同一张公共订单，已确认成交逐次更新原行。 */
import { getPgPool } from "../../common.js";
import { syncPmGtcSettledOrderFinancials } from "./pm_gtc_settlement.js";

export async function savePmGtcConfirmedResult(owner, result) {
  const pool = getPgPool();
  if (!pool) throw new Error("订单结果同步需要可用的 RDS");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [JSON.stringify([owner, result.orderId.toLowerCase()])]);
    const existing = await client.query("SELECT player_id,provider,order_id,status,raw FROM orders WHERE user_id=$1 AND lower(order_id)=lower($2) FOR UPDATE", [owner, result.orderId]);
    if (existing.rows.some(row => Number(row.player_id) !== result.playerId && row.provider === "Polymarket" && row.raw?.pmGtcExecutionId))
      throw new Error("GTC 原单结果已属于其他账号");
    const previous = existing.rows.find(row => Number(row.player_id) === result.playerId);
    if (previous && (previous.provider !== "Polymarket" || previous.raw?.pmSide === "sell"
      || (previous.raw?.pmGtcExecutionId && previous.raw.pmGtcExecutionId !== result.executionId)))
      throw new Error("GTC 原单结果身份冲突");
    const acceptedOrder = result.acceptedOrder ?? previous?.raw?.pmGtcAcceptedOrder;
    if (result.acceptedOrder && previous?.raw?.pmGtcAcceptedOrder
      && (Number(result.acceptedOrder.shares) !== Number(previous.raw.pmGtcAcceptedOrder.shares)
        || Number(result.acceptedOrder.price) !== Number(previous.raw.pmGtcAcceptedOrder.price)))
      throw new Error("GTC 受理原单数量或限价不可变更");
    const savedOrder = previous?.raw?.pmGtcAcceptedOrder;
    const savedRevision = Number(previous?.raw?.pmGtcResultRevision ?? -1);
    const enrichAcceptedOrder = savedRevision === result.revision && result.acceptedOrder && !savedOrder;
    const enrichReturnStatus = savedRevision === result.revision && result.status === "Return" && previous?.status === "None";
    if (savedRevision >= result.revision && !enrichAcceptedOrder && !enrichReturnStatus) {
      await client.query("COMMIT"); return true;
    }
    const oldShares = Number(previous?.raw?.pmGtcBuyShares) || 0;
    const oldFills = previous?.raw?.pmGtcConfirmedFills ?? [];
    if (oldFills.some(old => !result.fills.some(fill => fill.key === old.key)))
      throw new Error("GTC 已确认成交明细不可遗漏");
    const failed = result.fills.filter(fill => fill.status === "FAILED");
    for (const fill of result.fills) {
      const old = oldFills.find(old => old.key === fill.key);
      if (old && (old.tradeId !== fill.tradeId || old.role !== fill.role || old.shares !== fill.shares || old.price !== fill.price
        || (old.status === "FAILED" && fill.status !== "FAILED"))) throw new Error("GTC 已确认成交身份冲突或 FAILED 回退");
    }
    const reversed = failed.filter(fill => !oldFills.length || oldFills.some(old => old.key === fill.key && old.status === "CONFIRMED"))
      .reduce((sum, fill) => sum + Number(fill.shares), 0);
    if (result.financial.pmShares + 0.000001 < oldShares - reversed)
      throw new Error("GTC 成交量减少缺少已确认成交的 FAILED 证据");
    if (!previous && result.financial.pmShares === 0 && !acceptedOrder) { await client.query("COMMIT"); return true; }
    const financial = result.financial;
    const status = result.status ?? (financial.pmShares > 0 ? "None" : previous?.status === "Return" ? "Return" : "None");
    const clientMarket = mergeOrderMarketIdentity(previous?.raw?.clientMarket, result.clientMarket);
    const raw = { ...(clientMarket ? { clientMarket } : {}), pmOrderType: "GTC", pmGtcExecutionId: result.executionId, pmGtcResultRevision: result.revision,
      ...(acceptedOrder ? { pmGtcAcceptedOrder: acceptedOrder, pmSubmittedPrice: Number(acceptedOrder.price) } : {}),
      pmGtcConfirmedFills: result.fills, pmTokenId: result.tokenId, pmConditionId: result.conditionId,
      pmSide: "buy", pmOrigin: "changmen", pmShares: financial.pmShares, pmFillPrice: financial.pmFillPrice,
      pmStakeUsdc: financial.pmStakeUsdc, pmFeeUsdc: financial.pmFeeUsdc,
      pmGtcBuyShares: financial.pmShares, pmGtcBuyCost: financial.pmStakeUsdc, betMoney: financial.betMoney };
    await client.query(`INSERT INTO orders(user_id,player_id,order_id,link,provider,match,bet,item,odds,bet_money,money,status,create_at,raw)
      VALUES($1,$2,$3,$4,'Polymarket',$5,$6,$7,$8,$9,0,$14,$10,$11)
      ON CONFLICT(user_id,order_id,player_id) DO UPDATE SET odds=EXCLUDED.odds,bet_money=EXCLUDED.bet_money,
      status=CASE WHEN orders.status IN ('None','Return') THEN EXCLUDED.status ELSE orders.status END,
      link=CASE WHEN orders.raw->>'pmGtcExecutionId' IS NULL THEN EXCLUDED.link ELSE orders.link END,
      raw=(COALESCE(orders.raw,'{}'::jsonb) - ARRAY['pmGtcOrderSnapshot','pmGtcRevision']::text[]) || EXCLUDED.raw || jsonb_build_object(
        'pmShares',$12::float8,
        'pmStakeUsdc',CASE WHEN $12::float8>0 THEN greatest(0,$13-COALESCE((orders.raw->>'pmSellProceeds')::float8,0)+COALESCE((orders.raw->>'pmRealizedPnlUsdc')::float8,0)) ELSE 0 END)`,
    [owner, result.playerId, previous?.order_id ?? result.orderId, result.linkId, result.match, result.bet, result.item,
      financial.odds, financial.betMoney, result.createdAt, raw, financial.pmShares, financial.pmStakeUsdc, status]);
    await syncPmGtcSettledOrderFinancials(client, owner, result.playerId, result.orderId, result.executionId);
    await client.query("COMMIT"); return true;
  }
  catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
