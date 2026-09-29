import { getPgPool } from "./common.js";

/** 原始提交日志只在所属用户内检索；不返回给客户端。 */
export async function fetchPmSubmissionLogs(userId, orderId) {
  if (!userId || !/^0x[0-9a-f]{64}$/i.test(orderId))
    return [];
  const pool = getPgPool();
  if (!pool)
    throw new Error("数据库不可用，无法恢复原单金额");
  const { rows } = await pool.query(
    `SELECT title, data FROM user_logs
     WHERE user_id = $1 AND title LIKE '[Polymarket]%下注 =>%'
       AND data LIKE $2 ORDER BY create_at DESC LIMIT 21`,
    [userId, `%${orderId}%`],
  );
  return rows;
}
