import type { OrderObservationEvent } from "@changmen/shared/order_observation";
import { orderObservationTimeline } from "@changmen/shared/order_observation_view";
import { defineStore } from "pinia";

/** [changmen 扩展] 本地事实视图；业务 store 不依赖本 store。上传确认不会删除这里的记录。 */
export const useOrderObservationStore = defineStore("orderObservation", {
  state: () => ({ events: [] as OrderObservationEvent[], truncatedOwners: [] as string[] }),
  getters: {
    forLink: state => (ownerUserId: string, linkId?: number): OrderObservationEvent[] => {
      if (!ownerUserId || !linkId)
        return [];
      const owned = state.events.filter(event => event.ownerUserId === ownerUserId);
      const anchors = owned.filter(event => event.linkId === linkId);
      const executions = new Set(anchors.map(event => event.executionId).filter(Boolean));
      const attempts = new Set(anchors.map(event => event.attemptId).filter(Boolean));
      const queues = new Set(anchors.map(event => event.queueId).filter(Boolean));
      return orderObservationTimeline(owned.filter(event => event.linkId === linkId
        || Boolean(event.executionId && executions.has(event.executionId))
        || Boolean(event.attemptId && attempts.has(event.attemptId))
        || Boolean(event.queueId && queues.has(event.queueId))));
    },
  },
  actions: {
    record(event: OrderObservationEvent): void {
      if (this.events.some(row => row.ownerUserId === event.ownerUserId && row.eventId === event.eventId))
        return;
      this.events.push(Object.freeze({ ...event }));
      if (this.events.length > 512) {
        const removed = this.events.splice(0, this.events.length - 512);
        for (const row of removed) {
          if (!this.truncatedOwners.includes(row.ownerUserId))
            this.truncatedOwners.push(row.ownerUserId);
        }
        if (this.truncatedOwners.length > 32)
          this.truncatedOwners.splice(0, this.truncatedOwners.length - 32);
      }
    },
  },
});
