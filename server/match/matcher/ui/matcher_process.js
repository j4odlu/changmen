import {
  clearMatcherHeartbeat,
  isMatcherRunning,
  readMatcherHeartbeat,
  sanitizeMatcherHeartbeat,
} from "../lib/heartbeat.js";
import { isEmbeddedMatcher } from "../runtime_ports.js";
import {
  getMatcherLoopState,
  startMatcherLoop,
  stopMatcherLoop,
} from "../loop.js";

function remoteMatcherHeartbeat() {
  const hb = sanitizeMatcherHeartbeat(readMatcherHeartbeat());
  if (!hb || !isMatcherRunning(hb))
    return null;
  if (Number(hb.pid) === process.pid)
    return null;
  return hb;
}

export async function startMatcherProcess() {
  const state = getMatcherLoopState();
  if (state.running) {
    return {
      ok: true,
      pid: state.pid,
      source: "embedded",
      warning: "匹配循环已在运行",
    };
  }

  const remote = remoteMatcherHeartbeat();
  if (remote) {
    return {
      ok: false,
      error: `合并循环已在 web 进程运行（PID ${remote.pid}）`,
      pid: remote.pid,
      source: "embedded",
    };
  }

  if (!isEmbeddedMatcher()) {
    return {
      ok: false,
      error: "合并循环由内嵌 web 进程管理，请使用 npm run web 启动",
    };
  }

  return { ...(await startMatcherLoop()), source: "embedded" };
}

export async function stopMatcherProcess() {
  const state = getMatcherLoopState();
  if (!state.running) {
    const remote = remoteMatcherHeartbeat();
    if (remote) {
      return {
        ok: false,
        error: `合并循环在 web 进程运行（PID ${remote.pid}），请重启 web 进程停止`,
        pid: remote.pid,
      };
    }
    return { ok: false, error: "匹配循环未运行" };
  }

  const result = stopMatcherLoop();
  clearMatcherHeartbeat();
  return { ...result, source: "embedded" };
}

export function isManagedByServer() {
  return getMatcherLoopState().running;
}

export function getManagedMatcherPid() {
  const state = getMatcherLoopState();
  return state.running ? state.pid : null;
}

export function getEmbeddedMatcherState() {
  return getMatcherLoopState();
}
