import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { CHANGMEN_ROOT_FROM_PKG } from "./changmen_root.js";

/** Shared by Vite and local authentication; production never reads frontend env files. */
export function resolveDevWebPort(env = {}, platform = process.platform) {
  const raw = String(env.VITE_DEV_PORT || "").trim();
  if (!raw) return platform === "win32" ? 5274 : 5174;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("VITE_DEV_PORT 必须是 1–65535 之间的整数");
  return port;
}

export function readDevWebPort(webRoot = path.join(CHANGMEN_ROOT_FROM_PKG, "client/web"), env = process.env, platform = process.platform) {
  const values = {};
  for (const name of [".env", ".env.local", ".env.development", ".env.development.local"]) {
    const file = path.join(webRoot, name);
    if (fs.existsSync(file)) Object.assign(values, dotenv.parse(fs.readFileSync(file)));
  }
  return resolveDevWebPort({ ...values, ...env }, platform);
}
