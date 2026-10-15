import { getPgPool } from "./common.js";

/** [changmen 扩展] Capture availability now; execute only after the caller's match diagnostics are ready. */
export function createValueSignalDashboardReader() {
  const pool = getPgPool();
  return async function readValueSignalDashboard() {
    const unavailable = () => ({ dbAvailable: false, signals: [], stats: [], platformDist: [] });
    if (!pool) return unavailable();
    try {
      const [signals, stats, platformDist] = await Promise.all([
        pool.query("SELECT * FROM value_signals WHERE status = 'open' ORDER BY edge DESC LIMIT 100"),
        pool.query("SELECT status, COUNT(*)::int AS count, ROUND(AVG(edge)::numeric, 5) AS avg_edge, ROUND(MAX(edge)::numeric, 5) AS max_edge FROM value_signals GROUP BY status ORDER BY status"),
        pool.query("SELECT soft_platform, COUNT(*)::int AS count, ROUND(AVG(edge)::numeric, 5) AS avg_edge FROM value_signals WHERE status = 'open' GROUP BY soft_platform ORDER BY count DESC"),
      ]);
      return { dbAvailable: true, signals: signals.rows, stats: stats.rows, platformDist: platformDist.rows };
    }
    catch (error) {
      if (error.code !== "42P01") throw error;
      return unavailable();
    }
  };
}
