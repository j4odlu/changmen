// [changmen 扩展] Disposable local PostgreSQL only; never imports production credentials.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { validationIdentity } from "../verification/verify-change.mjs";
import { DATABASE_PHASES } from "./acceptance-contract.mjs";

export function checkDatabaseCompatibility({ cwd = process.cwd(), run = spawnSync, env = process.env } = {}) {
  const directory = path.join(cwd, "output/database-compatibility");
  fs.mkdirSync(directory, { recursive: true });
  const identity = validationIdentity(cwd), results = [];
  const npm = [env.npm_execpath, env.CHANGMEN_TEST_NPM_CLI,
    path.join(path.dirname(process.execPath), "node_modules/npm/bin/npm-cli.js"),
    path.resolve(path.dirname(process.execPath), "../lib/node_modules/npm/bin/npm-cli.js")]
    .find(file => file && fs.existsSync(file));
  const report = { checkedAt: new Date().toISOString(), passed: false, sourceStable: false,
    localOnly: true, productionWrites: false, identity, results };
  const save = () => fs.writeFileSync(path.join(directory, "verdict.json"), JSON.stringify(report, null, 2));
  save(); // Replace any earlier success before starting a new check.
  if (env.GITHUB_SHA && env.GITHUB_SHA !== identity.commit) throw Error("Database check commit differs from CI checkout");
  for (const phase of DATABASE_PHASES) {
    const started = Date.now(), log = path.join(directory, `${phase}.log`), fd = fs.openSync(log, "w");
    let result;
    try {
      result = run(process.execPath, [`scripts/testing/${phase}-postgres.mjs`], { cwd, windowsHide: true,
        timeout: 240000, stdio: ["ignore", fd, fd], env: { ...env,
          CHANGMEN_TEST_NPM_CLI: npm || "",
          CHANGMEN_TEST_EVIDENCE_DIR: path.join(directory, "standalone") } });
    } catch (error) { result = { status: null, error }; }
    finally { fs.closeSync(fd); }
    results.push({ phase, passed: result.status === 0 && !result.error, exitCode: result.status,
      errorCode: result.error?.code ?? null, elapsedMs: Date.now() - started });
    save(); console.log(`${phase}: ${result.status === 0 && !result.error ? "PASS" : "FAIL"}`);
    if (result.status !== 0 || result.error) break;
  }
  report.sourceStable = JSON.stringify(validationIdentity(cwd)) === JSON.stringify(identity);
  report.passed = results.length === DATABASE_PHASES.length && results.every(row => row.passed) && report.sourceStable;
  save(); return report;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { if (!checkDatabaseCompatibility().passed) process.exitCode = 1; }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
