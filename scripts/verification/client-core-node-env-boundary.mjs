// [changmen 扩展] Exact Node-only missing import.meta.env fix. The original
// browser algorithm and every other byte still pass the fixed FOK comparison.
const before = `function hkRelayOriginFromEnv(): string {
  if (typeof import.meta === "undefined")
    return "";
  const env = import.meta.env as Record<string, string | undefined>;
  return String(env.VITE_HK_RELAY_ORIGIN || env.VITE_PM_HK_RELAY_ORIGIN || "").trim().replace(/\\/+$/, "");
}`;
const after = before.replace("const env = import.meta.env as", "const env = (import.meta.env ?? {}) as");

export function restoreClientCoreNodeEnv(file, source, replaceExact) {
  if (file !== "packages/client-core/src/shared/hkRelayOrigin.ts") return source;
  if (source.includes(after)) return replaceExact(source, after, before);
  return source;
}
