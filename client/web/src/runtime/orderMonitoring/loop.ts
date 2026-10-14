/** [changmen 扩展] 页面级监控调度；恢复和查询慢请求不会阻塞后续轮次。 */
import { watch } from "vue";

export function createOrderMonitorLoop(context: {
  recover?: () => Promise<void>;
  active: () => boolean;
  tick: () => void;
}) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let dispose: (() => void) | undefined;
  let generation = 0;
  let running = false;
  let idle = false;
  let initialized = false;
  function tick(stamp: number) {
    if (!running || stamp !== generation)
      return;
    context.tick();
    if (context.recover) {
      void context.recover().catch(() => {}).then(() => {
        if (!running || stamp !== generation)
          return;
        if (!initialized) { initialized = true; context.tick(); }
        const nextIdle = !context.active();
        if (nextIdle !== idle) {
          idle = nextIdle; clearTimeout(timer);
          timer = setTimeout(tick, idle ? 60000 : 5000, stamp);
        }
      });
    }
    idle = !context.active();
    timer = setTimeout(tick, idle ? 60000 : 5000, stamp);
  }
  return {
    consume() {
      if (running)
        context.tick();
    },
    start() {
      if (running)
        return;
      running = true;
      initialized = false;
      const stamp = ++generation;
      dispose = watch(context.active, (active) => {
        if (active && idle && running) {
          clearTimeout(timer); idle = false;
          timer = setTimeout(tick, 5000, stamp);
        }
      }, { flush: "sync" });
      tick(stamp);
    },
    stop() {
      running = false; generation++; clearTimeout(timer); timer = undefined;
      dispose?.(); dispose = undefined;
    },
  };
}
