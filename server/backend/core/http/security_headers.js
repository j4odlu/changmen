/**
 * 保守的全局安全头：不改变现有资源加载行为。
 * CSP 先以 Report-Only 上线，观察无误后再单独切到强制模式。
 */
export function applySecurityHeaders(_req, res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Content-Security-Policy-Report-Only", "default-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'self'");
  if (process.env.NODE_ENV === "production")
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
}
