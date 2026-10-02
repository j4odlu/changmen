import type { Pinia } from "pinia";
import { browserAuthState, getAuthSessionVersion, isAuthSessionCurrent } from "@/api/client";
import { useUserStore } from "@/stores/userStore";

/** Retry identity/profile restoration only. Never replay business operations. */
export function installSessionRecovery(pinia: Pinia): () => void {
  let stopped = false;
  let running = false;
  let failures = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const user = useUserStore(pinia);
  const recover = async () => {
    if (stopped || running || user.ready)
      return;
    if (timer) clearTimeout(timer);
    const version = getAuthSessionVersion();
    running = true;
    try { await user.restoreSession(); }
    catch { /* The store keeps its error for the UI. */ }
    finally { running = false; }
    if (stopped || !isAuthSessionCurrent(version))
      return;
    if (!user.ready && (user.sessionRestoreError || browserAuthState.value === "unavailable")) {
      failures += 1;
      timer = setTimeout(() => { void recover(); }, Math.min(60_000, 2000 * 2 ** Math.min(failures - 1, 5)));
    }
    else failures = 0;
  };
  window.addEventListener("online", recover);
  window.addEventListener("pageshow", recover);
  void recover();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    window.removeEventListener("online", recover);
    window.removeEventListener("pageshow", recover);
  };
}
