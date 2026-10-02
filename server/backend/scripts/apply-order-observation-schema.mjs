import { readFileSync } from "node:fs";

const EXPECTED_INDEXES = [
  "order_observations_user_link",
  "order_observations_user_attempt",
  "order_observations_user_queue",
  "order_observations_user_order",
  "order_observations_user_execution",
];

/** [changmen 扩展] 先建旁路表，再建执行索引；失败时阻止部署继续。 */
export async function applyOrderObservationSchema(client) {
  for (const name of ["20261002_order_observations.sql", "20261003_order_observation_execution_index.sql"]) {
    console.log(`[rds] 执行 ${name} …`);
    const sql = readFileSync(new URL(`../db/migrations/${name}`, import.meta.url), "utf8");
    await client.query(sql);
  }
  const result = await client.query(
    "SELECT indexname FROM pg_indexes WHERE schemaname='public' AND tablename='order_observations' AND indexname=ANY($1::text[])",
    [EXPECTED_INDEXES],
  );
  const found = new Set(result.rows.map(row => row.indexname));
  const missing = EXPECTED_INDEXES.filter(name => !found.has(name));
  if (missing.length)
    throw new Error(`旁路观察索引缺失: ${missing.join(", ")}`);
  console.log("[rds] 旁路观察表及 5 个查询索引已核验");
}
