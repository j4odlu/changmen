import { readDevWebPort } from "../../server/storage/dev_web_config.js";

/** [changmen 扩展] Same development configuration as Vite and backend auth. */
export function readPmWalletDevOrigins(webRoot, env = process.env, platform = process.platform) {
  const port = readDevWebPort(webRoot, env, platform);
  return ["localhost", "127.0.0.1"].map(host => `http://${host}:${port}`);
}
