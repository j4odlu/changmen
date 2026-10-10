/** [changmen 扩展] 仅供明确幂等的会话读取/续活；绝不包裹下注、事务或普通订单写入。 */
export function isDisconnectedConnection(error) {
  return ["ECONNRESET", "EPIPE", "ETIMEDOUT", "57P01", "57P02", "57P03", "08003", "08006"].includes(error?.code)
    || /^(?:Connection terminated(?: unexpectedly)?|Client has encountered a connection error and is not queryable)$/.test(String(error?.message));
}

export async function querySessionWithReconnect(pool, sql, values, label) {
  try { return await pool.query(sql, values); }
  catch (error) {
    if (!isDisconnectedConnection(error)) throw error;
    // pg-pool.query 会以 release(error) 淘汰失效连接；下一次从池重新取连接。
    console.warn("[db] session connection retry", JSON.stringify({ at: new Date().toISOString(), label,
      code: error.code || "CONNECTION_TERMINATED", message: error.message,
      total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount }));
    return pool.query(sql, values);
  }
}
