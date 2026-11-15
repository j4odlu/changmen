import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it("retires refresh-balance before loading any account, database or platform module", () => {
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", `
    import { registerHooks } from "node:module";
    registerHooks({ resolve(specifier, context, next) {
      if (context.parentURL?.endsWith('/server/backend/scripts/account_cli.js'))
        throw new Error('Retired command loaded a runtime module: ' + specifier);
      return next(specifier, context);
    } });
    globalThis.fetch = () => { throw new Error('Retired command used the network'); };
    process.argv = [process.execPath, 'account_cli.js', 'refresh-balance'];
    await import('./server/backend/scripts/account_cli.js');
  `], { cwd: fileURLToPath(new URL("../../../../", import.meta.url)), encoding: "utf8", windowsHide: true, timeout: 10000 });
  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.stderr.trim()).toBe("account:refresh 已退役：请在客户端刷新账号余额；PM 使用 Pm_RefreshBalance。");
});
