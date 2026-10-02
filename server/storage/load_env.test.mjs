import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

test("explicitly cleared database alternatives cannot be restored from backend .env", () => {
  const url = "postgresql://auth_test@127.0.0.1:4927/changmen_auth_acceptance";
  const output = execFileSync(process.execPath, ["--input-type=module", "-e", `
    import { loadChangmenEnv } from './server/storage/load_env.js';
    loadChangmenEnv();
    console.log('DATABASE_TARGET_CHECK=' + JSON.stringify([
      process.env.DATABASE_URL, process.env.DATABASE_URL_INTERNAL, process.env.DATABASE_URL_PUBLIC
    ]));
  `], { cwd: new URL("../..", import.meta.url), encoding: "utf8", env: {
    ...process.env, DATABASE_URL: url, DATABASE_URL_INTERNAL: "", DATABASE_URL_PUBLIC: "",
  } });
  const result = output.split(/\r?\n/).find(line => line.startsWith("DATABASE_TARGET_CHECK="));
  assert.deepEqual(JSON.parse(result.slice("DATABASE_TARGET_CHECK=".length)), [url, "", ""]);
});
