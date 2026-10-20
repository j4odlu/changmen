/** [changmen 扩展] 一次性客户端迁移读取完整旧历史，盘口计次不能被旧 500 条窗口截断。 */
import { getPgPool } from "../../common.js";
export async function listPmGtcClientImport(owner) {
  const pool = getPgPool();
  if (!pool) throw new Error("GTC 旧成交历史导入需要可用的 RDS");
  try {
    return (await pool.query("SELECT record FROM pm_gtc_executions WHERE owner=$1 ORDER BY updated_at DESC", [String(owner)])).rows.map(row => row.record);
  }
  catch (error) {
    if (error.code === "42P01" && /"pm_gtc_executions"/.test(error.message)) return [];
    throw error;
  }
}
