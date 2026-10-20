/** [changmen 扩展] 旁路事件只写独立表，不查询场馆、不写 orders。 */
import { getPgPool } from "./common.js";

export async function insertOrderObservations(userId, events) {
  const pool = getPgPool();
  if (!pool)
    throw new Error("观察数据库不可用");
  const receivedAt = Date.now();
  await pool.query(
    `INSERT INTO order_observations (user_id,event_id,link_id,attempt_id,queue_id,occurred_at,received_at,event)
     SELECT $1::uuid,e->>'eventId',(e->>'linkId')::bigint,e->>'attemptId',e->>'queueId',
       (e->>'occurredAt')::bigint,$3::bigint,e
     FROM jsonb_array_elements($2::jsonb) e
     ON CONFLICT (user_id,event_id) DO NOTHING`,
    [userId, JSON.stringify(events), receivedAt],
  );
  // 完成 INSERT 后才确认；重传保持原 eventId 和首次接收时间。
  const confirmed = await pool.query(
    `SELECT o.event_id FROM order_observations o JOIN jsonb_array_elements($2::jsonb) e
       ON o.event_id=e->>'eventId' WHERE o.user_id=$1 AND o.event=e`,
    [userId, JSON.stringify(events)],
  );
  return confirmed.rows.map(row => row.event_id);
}

export async function fetchOrderObservations(userId, linkId, limit = 2000, orderRefs = [], selector = {}) {
  const pool = getPgPool();
  if (!pool)
    return { status: "unavailable", events: [], truncated: false };
  try {
    const cap = Math.min(Math.max(Math.floor(Number(limit) || 2000), 1), 5000);
    const result = await pool.query(
      `WITH anchors AS (SELECT attempt_id,queue_id,event->>'executionId' AS execution_id FROM order_observations
       WHERE user_id=$1 AND (($2::bigint <> 0 AND link_id=$2)
         OR ($7::text IS NOT NULL AND event_id=$7)
         OR ($5::text IS NOT NULL AND event->>'executionId'=$5)
         OR ($6::text IS NOT NULL AND attempt_id=$6)
         OR EXISTS (SELECT 1 FROM jsonb_array_elements($4::jsonb) ref
           WHERE event->>'provider'=ref->>'provider' AND event->>'accountId'=ref->>'accountId'
             AND event->>'orderId'=ref->>'orderId')))
       SELECT event,received_at FROM order_observations
       WHERE user_id=$1 AND (($2::bigint <> 0 AND link_id=$2)
         OR ($7::text IS NOT NULL AND event_id=$7)
         OR ($5::text IS NOT NULL AND event->>'executionId'=$5)
         OR ($6::text IS NOT NULL AND attempt_id=$6)
         OR event->>'executionId' IN (SELECT execution_id FROM anchors WHERE execution_id IS NOT NULL)
         OR attempt_id IN (SELECT attempt_id FROM anchors WHERE attempt_id IS NOT NULL)
         OR queue_id IN (SELECT queue_id FROM anchors WHERE queue_id IS NOT NULL)
         OR EXISTS (SELECT 1 FROM jsonb_array_elements($4::jsonb) ref
           WHERE event->>'provider'=ref->>'provider' AND event->>'accountId'=ref->>'accountId'
             AND event->>'orderId'=ref->>'orderId'))
       ORDER BY CASE WHEN event_id=$7 THEN 0 ELSE 1 END,received_at,event_id LIMIT $3`,
      [userId, linkId, cap + 1, JSON.stringify(orderRefs), selector.executionId || null, selector.attemptId || null, selector.eventId || null],
    );
    return {
      status: "available",
      events: result.rows.slice(0, cap).map(row => ({ ...row.event, receivedAt: Number(row.received_at) })),
      truncated: result.rows.length > cap,
    };
  }
  catch {
    // 尚未迁移/观察表故障不能阻断已有订单诊断。
    return { status: "unavailable", events: [], truncated: false };
  }
}
