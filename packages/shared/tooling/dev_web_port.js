export function resolveDevWebPort(env = {}, platform = process.platform) {
  const raw = String(env.VITE_DEV_PORT || "").trim();
  if (!raw) return platform === "win32" ? 5274 : 5174;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("VITE_DEV_PORT 必须是 1–65535 之间的整数");
  return port;
}
