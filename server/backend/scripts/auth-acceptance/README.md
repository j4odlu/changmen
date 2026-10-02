# 本机认证验收

所有命令从仓库根运行。只连接 `127.0.0.1:4927/changmen_auth_acceptance`；写 fixture 和应用迁移前查询实际数据库名与服务器地址，不允许使用生产库。需要已启动的本机 PostgreSQL，`auth_test` 用户和该专用数据库。

```powershell
node server/backend/scripts/auth-acceptance/apply-schema.mjs
node server/backend/scripts/auth-acceptance/serve.mjs
```

另开终端启动实际 Vue 页面：

```powershell
$env:VITE_API_BASE='http://127.0.0.1:4930'
$env:VITE_WEB_COOKIE_AUTH='1'
npm run dev --workspace=@changmen/web -- --host 127.0.0.1 --port 4931 --strictPort
```

两个测试账号 `river`、`acceptance-long` 的密码均为 `Acceptance-Only-2026!`，仅用于专用库。fixture 使用实际 HTTP、认证、私有 Hub 和数据库模块；不启动 matcher 或场馆采集进程。本次浏览器验收拦截非 loopback 外部 HTTP 请求，不发真实下注；需要完全隔离网络时还应拦截外部 WebSocket。

```powershell
node server/backend/scripts/auth-acceptance/run-long.mjs
node server/backend/scripts/auth-acceptance/run-revocation.mjs
```

前者持续真实 16 分钟，覆盖 Cookie 身份、比赛读取、频道权限、100 并发请求及超过默认 JWT 期限后的重连；后者验证互斥登录、旧退出请求、CSRF、Origin 和存量 WS 撤销。后者会撤销浏览器中的 River 测试登录；不要并行操作同一测试用户。

结果写到仓库根 `output/auth-acceptance-*.json`。关闭验收浏览器、这两个 Node/Vite 服务和专用 PostgreSQL 后即可结束；不要停止其他开发服务。浏览器验收结果及局限见 `docs/AUTH_ACCEPTANCE_2026-10-03.md`。
