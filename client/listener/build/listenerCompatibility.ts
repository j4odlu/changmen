import path from "node:path";
import type { Plugin } from "vite";
import { repoRoot } from "./paths.mjs";

/** Keep the original routes, guards, administration and return-to-home logic. */
export function listenerRouter(): Plugin {
  const target = path.join(repoRoot, "client/web/src/router/index.ts").replaceAll("\\", "/");
  return { name: "listener-router-history", enforce: "pre", transform(source, id) {
    if (id.split("?")[0]?.replaceAll("\\", "/") !== target) return;
    if (source.split('createWebHistory("/")').length !== 2) this.error("Original router history contract changed");
    return { code: source.replaceAll("createWebHistory", "createWebHashHistory")
      .replace('createWebHashHistory("/")', "createWebHashHistory(window.location.pathname)"), map: null };
  } };
}
/** Only adapt the return URL, so future changes to shared authentication run in both entries. */
export function listenerAuthReturn(): Plugin {
  const target = path.join(repoRoot, "client/web/src/lib/authSession.ts").replaceAll("\\", "/");
  const landing = 'window.location.href = "/"';
  return { name: "listener-auth-return", enforce: "pre", transform(source, id) {
    if (id.split("?")[0]?.replaceAll("\\", "/") !== target) return;
    if (source.split(landing).length !== 2) this.error("Original authentication return contract changed");
    return { code: source.replace(landing, 'window.location.href = `${window.location.pathname}#/`'), map: null };
  } };
}
/** Match the original local dev application's flags without altering the shared gates. */
export function listenerEnvironment(): Plugin {
  return { name: "listener-original-environment", config(_config, { command, mode }) {
    if (command === "build" && mode === "development")
      return { define: { "import.meta.env.DEV": "true", "import.meta.env.PROD": "false" } };
  } };
}
