import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { resolveDevWebPort } from "@changmen/shared/tooling/dev_web_port.js";
import { CHANGMEN_ROOT_FROM_PKG } from "./changmen_root.js";

/** Shared by Vite and local authentication; production never reads frontend env files. */
export { resolveDevWebPort } from "@changmen/shared/tooling/dev_web_port.js";

export function readDevWebPort(webRoot = path.join(CHANGMEN_ROOT_FROM_PKG, "client/web"), env = process.env, platform = process.platform) {
  const values = {};
  for (const name of [".env", ".env.local", ".env.development", ".env.development.local"]) {
    const file = path.join(webRoot, name);
    if (fs.existsSync(file)) Object.assign(values, dotenv.parse(fs.readFileSync(file)));
  }
  return resolveDevWebPort({ ...values, ...env }, platform);
}
