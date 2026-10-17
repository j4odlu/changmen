// Explicit test fixtures: synthetic login/store and a minimal consumer, not a production user session.
import { reactive } from 'vue';
export { watch } from 'vue';
import { PmOrderBookService } from '../../packages/venue-adapter/polymarket/realtime/orderBook/service';
import { WsBookShadowWorkerClient } from '../../packages/venue-adapter/polymarket/submission/preflight/optimized/wsBook/shadowWorkerClient';
export const user = reactive({ isLoggedIn: true, ready: true, userId: 1 });
export const useUserStore = () => user;
const workerUrl = (await (await fetch('/verification-worker.json')).json()).url;
export function startPmMarketData(enabled: () => boolean) {
  const service = new PmOrderBookService(enabled, () => new Worker(workerUrl, { type: 'module' }));
  const client = new WsBookShadowWorkerClient(enabled, service);
  return { stop() { client.stop(); service.stop(); }, reconcile() {} };
}
