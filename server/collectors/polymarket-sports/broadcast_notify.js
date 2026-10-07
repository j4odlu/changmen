/**
 * pm-sports 写入 RDS 后通知 gamebet-web 推浏览器（localhost only）
 */

function broadcastUrl() {
  if (process.env.CHANGMEN_PM_SPORT_BROADCAST_URL)
    return String(process.env.CHANGMEN_PM_SPORT_BROADCAST_URL).trim();
  const port = Number(process.env.CHANGMEN_WEB_PORT || process.env.PORT)
    || (process.platform === "win32" ? 3700 : 3456);
  return `http://127.0.0.1:${port}/esport/internal/broadcast/pm-sport`;
}

/** @param {number} clientMatchId @param {object} pmSport */
export async function notifyPmSportBroadcast(clientMatchId, pmSport) {
  const url = broadcastUrl();
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientMatchId, pmSport }),
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.warn(`[pm-sports] broadcast HTTP ${res.status}: ${text.slice(0, 120)}`);
    }
  }
  catch (err) {
    console.warn("[pm-sports] broadcast failed:", err.message);
  }
}
