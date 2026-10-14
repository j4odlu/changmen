/** [changmen 扩展] 唯一 RAY 订单监控的业务上下文，保存关联和补单依据，不负责查询。 */
import type { RayOrderContext } from "./types";
import { defineStore } from "pinia";
const STORAGE_PREFIX = "changmen:ray-order-context:v1";
const LEGACY_PREFIX = "changmen:ray-reject-monitor:v1";
const REJECTED_RETENTION_MS = 24 * 60 * 60 * 1000;
function readTasks(userId: string): RayOrderContext[] {
  try {
    const parsed: unknown = JSON.parse(sessionStorage.getItem(`${STORAGE_PREFIX}:${userId}`)
      || sessionStorage.getItem(`${LEGACY_PREFIX}:${userId}`) || "[]");
    if (!Array.isArray(parsed)) return [];
    const rows: RayOrderContext[] = [];
    for (const raw of parsed) {
      if (!raw || typeof raw !== "object" || !raw.key || raw.userId !== userId || !Number(raw.linkId) || !Number(raw.accountId)) continue;
      if (raw.status === "closed") continue;
      if (raw.status === "rejected" && Date.now() - Number(raw.updatedAt || 0) > REJECTED_RETENTION_MS) continue;
      const task = { ...raw };
      delete task.monitorMinutes; delete task.expiresAt; delete task.nextPollAt;
      if (task.status === "expired") task.status = task.boundOrderId ? "watching" : "binding";
      rows.push(task);
    }
    return rows;
  }
  catch { return []; }
}
export const useRayOrderContextStore = defineStore("rayOrderContexts", {
  state: () => ({ ownerUserId: "", tasks: new Map<string, RayOrderContext>() }),
  getters: {
    taskForLink: state => (linkId: number): RayOrderContext | null => {
      return [...state.tasks.values()].filter(task => task.linkId === Number(linkId) && task.status !== "closed")
        .sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null;
    },
    activeTasks: state => [...state.tasks.values()].filter(task => ["binding", "watching", "ambiguous"].includes(task.status)),
  },
  actions: {
    restore(userId: string) {
      if (!userId || this.ownerUserId === userId) return;
      this.ownerUserId = userId;
      this.tasks = new Map(readTasks(userId).map(task => [task.key, task]));
      this.persist();
    },
    upsert(task: RayOrderContext) { this.tasks.set(task.key, task); this.persist(); },
    patch(key: string, patch: Partial<RayOrderContext>) {
      const current = this.tasks.get(key);
      if (current) { this.tasks.set(key, { ...current, ...patch }); this.persist(); }
    },
    persist() {
      try {
        if (!this.ownerUserId) return;
        const rows = [...this.tasks.values()].filter(task => task.status !== "closed")
          .filter(task => task.status !== "rejected" || Date.now() - task.updatedAt <= REJECTED_RETENTION_MS);
        sessionStorage.setItem(`${STORAGE_PREFIX}:${this.ownerUserId}`, JSON.stringify(rows));
        sessionStorage.removeItem(`${LEGACY_PREFIX}:${this.ownerUserId}`);
      }
      catch { /* 上下文持久化失败不改变原下注流程。 */ }
    },
  },
});
