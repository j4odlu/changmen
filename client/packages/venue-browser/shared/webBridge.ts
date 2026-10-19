/**
 * venue-adapter → web Pinia 注入点（对齐 A8 单 bundle 内直接调 store）。
 * 由 `client/web/src/runtime/installVenueWebBridge.ts` 在应用启动时注册；
 * 采集/下注模块只 import 本文件，不 import `@/stores/*`。
 */

import type { VenueWebBridge } from "./webBridgeTypes";

export type {
  AccountStoreBridge,
  CollectStoreBridge,
  MatchStoreBridge,
  MessageStoreBridge,
  UserStoreBridge,
  VenueWebBridge,
} from "./webBridgeTypes";

export type {
  VenueOddsEntry,
  VenueLimitEntry,
  OddsSaveSource,
} from "@changmen/client-core/bridge/oddsAccess";

let bridge: VenueWebBridge | null = null;

export function setVenueWebBridge(next: VenueWebBridge | null) {
  bridge = next;
}

function requireBridge(): VenueWebBridge {
  if (!bridge) {
    throw new Error(
      "Venue webBridge 未安装：请在 client/web 启动时调用 installVenueWebBridge()",
    );
  }
  return bridge;
}

export function useCollectStore() {
  return requireBridge().useCollectStore();
}

export function useMatchStore() {
  return requireBridge().useMatchStore();
}

export function useMessageStore() {
  return requireBridge().useMessageStore();
}

export function useAccountStore() {
  return requireBridge().useAccountStore();
}

export function useUserStore() {
  return requireBridge().useUserStore();
}
