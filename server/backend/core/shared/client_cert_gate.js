/**
 * mTLS 客户端证书门：解析 Caddy 注入头，供登录绑定 CN↔用户名。
 *
 * Caddy :443 应注入：
 *   X-Changmen-Client-Cert / X-Changmen-Client-Subject
 * :80 / 直连 Node 无此头。仅信任 loopback（Caddy→Node）注入。
 */

function isLoopbackAddress(addr) {
  if (!addr)
    return false;
  const s = String(addr).replace(/^::ffff:/i, "");
  return s === "127.0.0.1" || s === "::1" || s === "localhost";
}

/**
 * @param {import("node:http").IncomingMessage | undefined | null} req
 * @returns {{ hasClientCert: boolean, subject: string }}
 */
export function readClientCertStatus(req) {
  if (!req) {
    return { hasClientCert: false, subject: "" };
  }
  const fromLoopback = isLoopbackAddress(req.socket?.remoteAddress);
  if (!fromLoopback) {
    return { hasClientCert: false, subject: "" };
  }
  const flag = String(req.headers["x-changmen-client-cert"] || "").trim().toLowerCase();
  let subject = String(req.headers["x-changmen-client-subject"] || "").trim();
  // Caddy 未替换占位符时会原样传来 "{http.request.tls.client.subject}"
  if (subject.includes("{") || subject.includes("}"))
    subject = "";
  const hasClientCert = flag === "1" || flag === "true" || subject.length > 0;
  const fingerprint = String(req.headers['x-changmen-client-fingerprint'] || '').replace(/:/g, '').toLowerCase();
  return { hasClientCert, subject: hasClientCert ? subject : "",
    ...(hasClientCert && /^[a-f0-9]{64}$/.test(fingerprint) ? { fingerprint } : {}) };
}

export function clientCertificateAudit(req) {
  const cert = readClientCertStatus(req);
  return { certCn: clientCertCnFromSubject(cert.subject), certFingerprint: cert.fingerprint || '' };
}

/** 从 subject（如 CN=gb19 / CN=gb19,O=...）取出 CN */
export function clientCertCnFromSubject(subject) {
  const s = String(subject || "").trim();
  if (!s)
    return "";
  const m = /(?:^|[,\/\s])CN\s*=\s*([^,\/]+)/i.exec(s)
    || /^CN\s*=\s*([^,\/]+)/i.exec(s);
  return m ? String(m[1]).trim() : "";
}

function envFlag(name, defaultValue) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || String(raw).trim() === "")
    return defaultValue;
  const v = String(raw).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(v))
    return true;
  if (["0", "false", "no", "off"].includes(v))
    return false;
  return defaultValue;
}

/**
 * 是否强制登录绑定客户端证书。
 * - CHANGMEN_CERT_LOGIN_BIND=1/0 显式开关
 * - 未设置时：NODE_ENV=production 默认开启
 */
export function isCertLoginBindEnabled() {
  return envFlag("CHANGMEN_CERT_LOGIN_BIND", process.env.NODE_ENV === "production");
}

/**
 * 登录绑定校验。通过返回 null；失败返回给用户看的错误文案。
 * @param {string} userName 登录用的用户名（或 profile.userName）
 * @param {{ hasClientCert?: boolean, subject?: string } | null | undefined} cert
 */
export function certLoginBindError(userName, cert) {
  if (!isCertLoginBindEnabled())
    return null;

  if (!cert?.hasClientCert) {
    return "需要有效的客户端证书才能登录";
  }

  const cn = clientCertCnFromSubject(cert.subject);
  if (!cn) {
    return "客户端证书无效（缺少 CN）";
  }

  const want = String(userName || "").trim().toLowerCase();
  const got = cn.toLowerCase();
  if (!want || got !== want) {
    return "客户端证书与登录账号不匹配";
  }

  return null;
}
