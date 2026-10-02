import type { OrderObservationEvent } from "@changmen/shared/order_observation";
import { normalizeObservationEvent } from "@changmen/shared/order_observation";

/** [changmen 扩展] 上传队列只重发事件；没有下注、补单或场馆依赖。 */
export class OrderObservationOutbox {
  private events: OrderObservationEvent[] = [];
  private gaps: OrderObservationEvent[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private inFlight = false;
  private retry = 0;
  private storageFailed = false;

  constructor(private deps: {
    owner: () => string;
    send: (owner: string, events: OrderObservationEvent[]) => Promise<string[]>;
    read: () => string | null;
    write: (value: string) => void;
    capacity?: number;
    onEvent?: (event: OrderObservationEvent) => void;
  }) {
    // 启动时恢复，不在下注函数内读取存储。
    try {
      const rows = JSON.parse(deps.read() || "[]") as OrderObservationEvent[];
      if (Array.isArray(rows)) {
        const seen = new Set<string>();
        const valid = rows.map(row => normalizeObservationEvent(row, row?.ownerUserId)).filter((row): row is OrderObservationEvent => Boolean(row));
        for (const row of valid) {
          const identity = `${row.ownerUserId}:${row.eventId}`;
          if (seen.has(identity))
            continue;
          seen.add(identity);
          if (row.kind === "transport_gap") {
            if (this.gaps.length < 32) {
              this.gaps.push(row);
              this.publish(row);
            }
          }
          else if (this.events.length < (this.deps.capacity ?? 512)) {
            this.events.push(row);
            this.publish(row);
          }
          else {
            this.markGap(row, "outbox_restore_overflow");
          }
        }
        if (valid.length !== rows.length)
          this.storageFailed = true;
      }
    }
    catch {
      this.storageFailed = true;
    }
  }

  enqueue(event: OrderObservationEvent): void {
    try {
      if (this.events.length >= (this.deps.capacity ?? 512)) {
        this.markGap(event, "outbox_overflow");
      }
      else {
        this.events.push({ ...event });
        this.publish(event);
        if (this.storageFailed)
          this.markGap(event, "storage_unavailable");
      }
      this.wake();
    }
    catch { /* 观察异常不得冒泡至下注调用 */ }
  }

  private markGap(event: OrderObservationEvent, reasonCode: string) {
    if (this.gaps.some(gap => gap.ownerUserId === event.ownerUserId && gap.linkId === event.linkId))
      return;
    if (this.gaps.length < 32) {
      const gap: OrderObservationEvent = { ...event, eventId: `${event.eventId}_gap`, kind: "transport_gap", reasonCode };
      this.gaps.push(gap);
      this.publish(gap);
    }
  }

  private publish(event: OrderObservationEvent): void {
    try { this.deps.onEvent?.(Object.freeze({ ...event })); }
    catch { /* 展示消费者失败不能阻断记录上传或业务 */ }
  }

  wake(): void {
    if (!this.timer) {
      this.timer = setTimeout(() => {
        this.timer = undefined;
        void this.flush();
      }, Math.min(60_000, this.retry ? 1000 * 2 ** Math.min(this.retry, 6) : 0));
    }
  }

  private persist() {
    try {
      this.deps.write(JSON.stringify([...this.events, ...this.gaps]));
      this.storageFailed = false;
    }
    catch {
      this.storageFailed = true;
      for (const event of this.events)
        this.markGap(event, "storage_unavailable");
    }
  }

  async flush(): Promise<void> {
    if (this.inFlight)
      return;
    this.inFlight = true;
    try {
      this.persist();
      const owner = this.deps.owner();
      const batch = [...this.gaps, ...this.events].filter(event => event.ownerUserId === owner).slice(0, 32);
      if (!owner || !batch.length)
        return;
      const acknowledged = new Set(await this.deps.send(owner, batch));
      const sent = new Set(batch.map(event => event.eventId));
      this.events = this.events.filter(event => event.ownerUserId !== owner || !sent.has(event.eventId) || !acknowledged.has(event.eventId));
      this.gaps = this.gaps.filter(event => event.ownerUserId !== owner || !sent.has(event.eventId) || !acknowledged.has(event.eventId));
      this.retry = batch.every(event => acknowledged.has(event.eventId)) ? 0 : this.retry + 1;
      this.persist();
    }
    catch {
      this.retry += 1;
    }
    finally {
      this.inFlight = false;
      if (this.events.length || this.gaps.length) {
        // 登录切换期间暂停上传；只对当前用户发送。
        if (!this.deps.owner())
          this.retry = Math.max(this.retry, 5);
        else if (![...this.events, ...this.gaps].some(event => event.ownerUserId === this.deps.owner()))
          this.retry = Math.max(this.retry, 5);
        this.wake();
      }
    }
  }
}
