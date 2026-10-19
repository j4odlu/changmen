import { buildPbAuthHeaders } from "./auth.ts";

const b64 = process.argv[2];
if (!b64) {
  console.error("usage: node _diag_token.mjs <base64>");
  process.exit(1);
}

const outer = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
console.log("outer keys:", Object.keys(outer));
console.log("provider:", outer.provider);
console.log("gateway:", outer.gateway);
console.log("referer:", outer.referer?.slice(0, 80));
console.log("token type:", typeof outer.token, "len:", outer.token?.length);

let tokenObj;
try {
  tokenObj = JSON.parse(outer.token);
  console.log("token parse: OK, keys:", Object.keys(tokenObj).slice(0, 15), "total", Object.keys(tokenObj).length);
} catch (e) {
  console.log("token parse: FAIL", e.message);
  process.exit(1);
}

const appDataRaw = tokenObj["x-app-data"];
let appData;
try {
  appData = JSON.parse(appDataRaw || "{}");
  console.log("x-app-data parse: OK, keys sample:", Object.keys(appData).filter((k) => /Session|custid|directus/i.test(k)));
} catch (e) {
  console.log("x-app-data parse: FAIL", e.message);
}

const account = { provider: "PB", gateway: outer.gateway, token: outer.token };
const headers = buildPbAuthHeaders(account);
console.log("buildPbAuthHeaders:", headers ? "OK" : "UNDEFINED");
if (headers) {
  const keys = Object.keys(headers);
  console.log("header keys:", keys);
  for (const k of keys) {
    const v = headers[k];
    console.log(`  ${k}: ${String(v).slice(0, 60)}${String(v).length > 60 ? "…" : ""}`);
  }
}
