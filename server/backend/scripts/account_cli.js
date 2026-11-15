#!/usr/bin/env node

/**
 * 账号模块 CLI：登录、创建标签平台、读写 ACCOUNT KV。
 *
 * 用法:
 *   npm run account:cli -- login admin admin
 *   npm run account:tags
 *   npm run account:create -- --platform 测试盘 --player test01
 *   npm run account:list
 *   npm run account:cli -- parse-credential <base64>
 *   npm run account:import-platform -- <base64> --sync-store
 *   npm run account:set-a8 -- <user> <password>
 */

function usage() {
  console.log(`用法:
  login <user> <pass>              登录并打印 token
  tags                             列出标签平台
  create --platform <名> --player <名>   创建 player（Client_CreateTagPlatform）
  list                             列出 ACCOUNT KV
  save-sample                      写入一条示例账号到 ACCOUNT
  parse-credential <base64>        解析插件凭证
  import-platform <base64> [--sync-store]  写入 platforms.json（插件 data 字段）
  set-a8 <user> <password>             写入 A8 账号（方案 A，供控制台登录与平博 SSO）
  refresh-balance                  已退役；请在客户端刷新账号余额
`);
}

function login(userName, password, store) {
  store.ensureSeed();
  const user = store.getUserByName(userName);
  if (!user) throw new Error("用户不存在");
  const hash = store.hashPassword(password, user.salt);
  if (hash !== user.passwordHash) throw new Error("密码错误");
  const token = store.createSession(user.id);
  console.log(JSON.stringify({ token, userName: user.userName, ID: user.id }, null, 2));
  return token;
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === "refresh-balance") {
    console.error("account:refresh 已退役：请在客户端刷新账号余额；PM 使用 Pm_RefreshBalance。");
    process.exitCode = 1;
    return;
  }

  // 退役命令不加载账号服务，也不初始化数据库或平台凭证。
  const accountStore = await import("../core/account/account_store.js");
  const accountService = await import("../core/account/account_service.js");
  const { parseClipboardCredential, encodeClipboardCredential } = await import("../core/account/clipboard_credential.js");
  const { importPlatformCredential } = await import("../core/shared/import_platform_credential.js");
  const { saveA8Config, CONFIG_FILE } = await import("../core/integrations/a8/config.js");
  const { syncPbFromSession } = await import("../core/esport-api/platform_sync.js");
  const { requirePlatform } = await import("../core/shared/adapter_paths.js");
  const { default: store } = await import("../core/esport-api/store.js");
  const { tryLoadSession } = requirePlatform("PB", "node", "session.js");
  await accountStore.ensureSeed();
  store.ensureSeed();

  if (!cmd || cmd === "help" || cmd === "-h") {
    usage();
    return;
  }

  switch (cmd) {
    case "login": {
      login(rest[0] || "admin", rest[1] || "admin", store);
      break;
    }
    case "tags": {
      console.log(JSON.stringify(await accountStore.listTagPlatforms(), null, 2));
      break;
    }
    case "create": {
      let platform = "";
      let player = "";
      let userName = "";
      for (let i = 0; i < rest.length; i++) {
        if (rest[i] === "--platform") platform = rest[++i];
        if (rest[i] === "--player") player = rest[++i];
        if (rest[i] === "--user") userName = rest[++i];
      }
      let userId = "";
      if (userName) {
        store.ensureSeed();
        const user = store.getUserByName(userName);
        if (!user) throw new Error(`用户不存在: ${userName}`);
        userId = user.id;
      }
      const r = await accountService.handleCreateTagPlatform({ platform, playerName: player }, userId);
      console.log(JSON.stringify(r, null, 2));
      break;
    }
    case "list": {
      console.log(JSON.stringify(accountStore.getAccountsFromKv(), null, 2));
      break;
    }
    case "save-sample": {
      store.ensureSeed();
      const demoUser = store.listUsers?.()?.[0] || store.getUserByName?.("admin");
      if (!demoUser?.id)
        throw new Error("save-sample 需要至少一个用户，或改用 account:create --user <name>");
      const created = await accountStore.createTagPlatform("本地测试", "demo01", demoUser.id);
      const sample = {
        accountId: created.playerId,
        platformId: created.platformId,
        platformName: created.platformName,
        playerName: created.playerName,
        provider: "PB",
        gateway: process.env.PB_GATEWAY || "",
        token: process.env.PB_TOKEN || "",
        referer: process.env.PB_REFERER || process.env.PB_GATEWAY || "",
        maxBalance: 0,
        maxBalanceOdds: 2,
        minOdds: 0,
        maxOdds: 0,
        rateConfig: [],
        profit: 0,
        game: {},
        multiply: 1,
      };
      store.setUserKv("ACCOUNT", JSON.stringify([sample]));
      console.log(JSON.stringify(sample, null, 2));
      break;
    }
    case "parse-credential": {
      const cred = parseClipboardCredential(rest[0] || "");
      console.log(JSON.stringify(cred, null, 2));
      console.log("\n编码回 Base64:\n", encodeClipboardCredential(cred));
      break;
    }
    case "import-platform": {
      const base64 = rest.find((arg) => arg && !arg.startsWith("--")) || "";
      const syncStore = rest.includes("--sync-store");
      const result = importPlatformCredential(base64);
      console.log(
        JSON.stringify(
          {
            ok: true,
            provider: result.provider,
            file: result.file,
            gateway: result.entry.gateway,
            updatedAt: result.entry.updatedAt,
          },
          null,
          2,
        ),
      );
      if (syncStore && result.provider === "PB") {
        const session = tryLoadSession();
        if (session) {
          syncPbFromSession(session);
          console.log("\n已同步 PB 凭证到 esport store（Client_GetCollectPlatform）");
        }
      }
      break;
    }
    case "set-a8": {
      const userName = rest[0];
      const password = rest[1];
      if (!userName || !password) {
        throw new Error("用法: set-a8 <A8用户名> <A8密码>");
      }
      const saved = saveA8Config({ userName, password });
      console.log(
        JSON.stringify(
          {
            ok: true,
            file: CONFIG_FILE,
            userName: saved.userName,
            updatedAt: saved.updatedAt,
          },
          null,
          2,
        ),
      );
      break;
    }
    default:
      usage();
      process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exitCode = 1;
});
