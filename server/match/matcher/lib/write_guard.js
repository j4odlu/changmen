/**
 * 写库互斥：
 * - 默认挡 matcher HB + 其它 composer WRITE HB
 * - viaMatcherWriter / skipMatcherHeartbeat：仅跳过「本进程 matcher HB」
 *   （仍挡其它 composer）
 * - 独立 MATCH_COMPOSER_WRITE loop 未带 skipMatcherHeartbeat 时直接拒绝，
 *   避免与 embedded composer 形成第二写循环
 */
import fs from "node:fs";
import {
  isMatcherRunning,
  readMatcherHeartbeat,
  sanitizeMatcherHeartbeat,
} from "./heartbeat.js";
import {
  COMPOSER_HEARTBEAT_PATH,
  sanitizeComposerHeartbeat,
} from "./heartbeat.js";

export function isForceWriteEnabled() {
  return String(process.env.MATCH_COMPOSER_FORCE_WRITE || "").trim() === "1";
}

function heartbeatActive(filePath, { requireWrote = false, maxAgeMs = 90_000 } = {}) {
  try {
    if (!fs.existsSync(filePath))
      return false;
    const hb = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const last = Number(hb.lastRun) || 0;
    if (!(last > 0 && Date.now() - last < maxAgeMs))
      return false;
    if (requireWrote && !hb.wrote)
      return false;
    return hb;
  }
  catch {
    return false;
  }
}

export function assertComposerMayWrite(opts = {}) {
  if (isForceWriteEnabled())
    return { ok: true };

  // 独立 composer loop（非 viaMatcherWriter）：生产已是 embedded composer，禁止第二写者
  if (!opts.skipMatcherHeartbeat) {
    return {
      ok: false,
      reason: "生产唯一写路径已是 esport 内嵌 composer，拒绝独立 MATCH_COMPOSER_WRITE 循环双写。"
        + " dry-run 保持 MATCH_COMPOSER_WRITE=0；应急可设 MATCH_COMPOSER_FORCE_WRITE=1（危险）",
    };
  }

  {
    const raw = readMatcherHeartbeat();
    const hb = sanitizeMatcherHeartbeat(raw);
    if (isMatcherRunning(hb)) {
      const hbPid = Number(hb.pid) || 0;
      // viaMatcherWriter：本进程合场循环会写 matcher HB，只放行同 pid；
      // 仍须挡住其它 matcher 与 composer 双写。
      if (opts.skipMatcherHeartbeat) {
        if (hbPid && hbPid !== process.pid) {
          return {
            ok: false,
            reason: `另一 matcher 进程 pid=${hbPid} 心跳仍活跃，拒绝与 composer 双写 client_matches。`
              + " 请先停旧 matcher，或设 MATCH_COMPOSER_FORCE_WRITE=1（危险）",
            heartbeat: hb,
          };
        }
      }
      else {
        return {
          ok: false,
          reason: "matcher 心跳仍活跃，拒绝双写 client_matches。"
            + " 请先停 matcher，或设 MATCH_COMPOSER_FORCE_WRITE=1（危险）",
          heartbeat: hb,
        };
      }
    }
  }

  // 其它 composer WRITE 进程（viaMatcherWriter 也必须挡）；已死 pid 先清掉
  if (process.env.MATCH_COMPOSER_ALLOW_MULTI !== "1") {
    sanitizeComposerHeartbeat();
    const peer = heartbeatActive(COMPOSER_HEARTBEAT_PATH, { requireWrote: true });
    if (peer) {
      const peerPid = Number(peer.pid) || 0;
      if (peerPid && peerPid !== process.pid) {
        return {
          ok: false,
          reason: `另一 composer WRITE 进程 pid=${peerPid} 心跳仍活跃，拒绝双写`,
        };
      }
    }
  }

  return { ok: true };
}
