import { setChangmenAuthTokenGetter, setChangmenHandshakeTokenGetter, setChangmenCookieSessionGetter, setVenueWebBridge } from "@changmen/venue-adapter/shared";
import type { VenueWebBridge } from "@changmen/venue-adapter/shared";
import { getToken, usesWebCookieSession } from "@/api/client";
import { getCompatibilityToken } from "@/lib/authCredentials";
import { useAccountStore } from "@/stores/accountStore";
import { useCollectStore } from "@/stores/collectStore";
import { useMatchStore } from "@/stores/matchStore";
import { useMessageStore } from "@/stores/messageStore";
import { useUserStore } from "@/stores/userStore";

/** 将 web Pinia store 注入 venue-adapter（须在 createPinia 之后调用） */
export function installVenueWebBridge() {
  const hooks: VenueWebBridge = {
    useCollectStore: () => useCollectStore(),
    useMatchStore: () => useMatchStore(),
    useMessageStore: () => useMessageStore(),
    useAccountStore: () => useAccountStore(),
    useUserStore: () => useUserStore(),
  };
  setVenueWebBridge(hooks);
  setChangmenAuthTokenGetter(() => getToken());
  setChangmenCookieSessionGetter(() => usesWebCookieSession());
  setChangmenHandshakeTokenGetter(getCompatibilityToken);
}

export function clearVenueWebBridge() {
  setVenueWebBridge(null);
  setChangmenAuthTokenGetter(null);
  setChangmenHandshakeTokenGetter(null);
  setChangmenCookieSessionGetter(null);
}
