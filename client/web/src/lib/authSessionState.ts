import { shallowRef } from "vue";

export interface CookieSessionInfo {
  user: { id: string; userName: string; role: string };
  browserSessionId: string;
  loginEpoch: string;
  cookieEnabled: boolean;
  csrfToken: string;
  persistent?: boolean;
}

const cookieSession = shallowRef<CookieSessionInfo | null>(null);
export const browserAuthState = shallowRef<"checking" | "authenticated" | "anonymous" | "unavailable">("checking");
export function getCookieSessionInfo() { return cookieSession.value; }
export function setCookieSessionInfo(info: CookieSessionInfo | null) {
  cookieSession.value = info;
  if (info)
    browserAuthState.value = "authenticated";
}
export function usesWebCookieSession() { return Boolean(cookieSession.value?.cookieEnabled); }
