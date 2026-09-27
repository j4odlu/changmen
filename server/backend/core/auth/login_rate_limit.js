const attempts = new Map();

const WINDOW_MS = 15 * 60 * 1000;
const ACCOUNT_LIMIT = 8;
const IP_LIMIT = 30;
const MAX_BUCKETS = 10_000;
let operations = 0;

function normalized(value) {
  return String(value || "").trim().toLowerCase();
}

function bucket(key, now) {
  operations += 1;
  if (operations % 256 === 0 || attempts.size > MAX_BUCKETS) {
    for (const [entryKey, value] of attempts) {
      if (now - value.startedAt >= WINDOW_MS)
        attempts.delete(entryKey);
    }
    while (attempts.size > MAX_BUCKETS)
      attempts.delete(attempts.keys().next().value);
  }
  const current = attempts.get(key);
  if (!current || now - current.startedAt >= WINDOW_MS) {
    const fresh = { count: 0, startedAt: now };
    attempts.set(key, fresh);
    return fresh;
  }
  return current;
}

export function checkLoginRateLimit(userName, clientIp, now = Date.now()) {
  // 按“账号 + 来源 IP”限流，避免攻击者仅凭已知用户名锁死其他人的登录。
  const account = bucket(`account-ip:${normalized(userName)}:${normalized(clientIp)}`, now);
  const ip = bucket(`ip:${normalized(clientIp)}`, now);
  const accountLimited = account.count >= ACCOUNT_LIMIT;
  const ipLimited = ip.count >= IP_LIMIT;
  const limited = accountLimited || ipLimited;
  const retryAt = Math.max(
    accountLimited ? account.startedAt + WINDOW_MS : 0,
    ipLimited ? ip.startedAt + WINDOW_MS : 0,
  );
  return { limited, retryAfterSec: limited ? Math.max(1, Math.ceil((retryAt - now) / 1000)) : 0 };
}

export function recordLoginFailure(userName, clientIp, now = Date.now()) {
  bucket(`account-ip:${normalized(userName)}:${normalized(clientIp)}`, now).count += 1;
  bucket(`ip:${normalized(clientIp)}`, now).count += 1;
}

export function recordLoginSuccess(userName, clientIp) {
  attempts.delete(`account-ip:${normalized(userName)}:${normalized(clientIp)}`);
}

export function resetLoginRateLimitForTests() {
  attempts.clear();
  operations = 0;
}
