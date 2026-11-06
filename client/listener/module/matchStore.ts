import { useMatchStore as originalUseMatchStore } from "../../web/src/stores/matchStore";
import { installListenerStore } from "./index";
/** Reuse exactly one original Pinia store; replace its scheduler only in this application. */
export const useMatchStore: typeof originalUseMatchStore = new Proxy(originalUseMatchStore, {
  apply(target, thisArg, args) {
    const store = Reflect.apply(target, thisArg, args) as ReturnType<typeof originalUseMatchStore>;
    installListenerStore(store);
    return store;
  },
});
