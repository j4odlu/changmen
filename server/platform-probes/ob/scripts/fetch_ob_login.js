#!/usr/bin/env node
/**
 * Step 1: OB login — get token, gateway, MQTT endpoints.
 *
 * Usage:
 *   node platforms/ob/scripts/fetch_ob_login.js
 *   node platforms/ob/scripts/fetch_ob_login.js "<login url>"
 */

import { DEFAULT_LOGIN_URL, login } from "../session.js";

async function main() {
  const loginUrl = process.argv[2] || DEFAULT_LOGIN_URL;
  const session = await login(loginUrl);
  console.log(JSON.stringify(session, null, 2));
}

main().catch((err) => {
  console.error(JSON.stringify({ error: err.message, loginUrl: err.loginUrl, response: err.response }, null, 2));
  process.exit(1);
});
