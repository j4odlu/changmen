# 统一认证全面验收结果

执行日期：2026-10-03。分支：`codex/unified-auth`。结论：代码回归与隔离环境认证验收通过，**生产发布验收未通过**。本次没有部署认证代码、重载生产 Caddy 或发送真实交易。

## 本次实际执行

| 项目 | 结果 | 范围与证据 |
|---|---|---|
| 全仓库测试 | 通过 | 最终 `npm test`，13/13 任务；前端 2241 项、后端 204 项，后端另有 12 项 PostgreSQL 测试默认跳过并在下项独立运行；日志 `output/auth-full-final-tests.log` |
| PostgreSQL 集成与中继回归 | 通过 | 显式指定专用本机库，12 项真实数据库测试及最终 4 项中继测试通过；`output/auth-full-pg-tests.log` |
| 默认测试之外的 proxy 测试 | 通过 | 2 文件、6 项；`output/auth-full-proxy-tests.log` |
| 类型、构建、依赖边界和冻结检查 | 通过 | `app:build` 成功；`npm test` 包含团队边界、adapter 导出/import/冻结检查；`output/auth-full-build.log`。构建有体积告警 |
| HTTPS + mTLS + 跨子域 Cookie | 通过 | 实际 Vue 页 `app.changmen.test:4931`，实际 API `api.changmen.test:4930`；使用 River 客户证书及测试服务端证书。浏览器忽略测试服务端证书信任错误；服务端严格验证客户端证书 |
| Cookie 属性与 River 页面 | 通过 | `__Host-cm_session`、Secure、HttpOnly、SameSite=Strict、API host、path=/；实际登录、刷新、比赛读取及私有 Hub。仅隔离库 1 场 fixture；截图 `output/playwright/auth-full-https.png` |
| TLS 与用户名绑定 | 通过 | 无客户端证书连接被 TLS 拒绝；River 证书登录另一测试用户名返回 401/CERT_BIND_FAILED；`output/auth-full-fault.mjs` |
| 实际数据库故障恢复 | 通过 | 只停止 4927 专用 PostgreSQL，`/auth/session` 返回 503/TEMPORARY_UNAVAILABLE，无清 Cookie 响应；重启后原 Cookie 返回 200。没有停止生产库 |
| 页面冻结恢复 | 通过 | CDP 冻结 5 秒再激活，刷新后成功读取比赛。**不等同于 Windows 实际休眠唤醒** |
| 多用户并发 | 通过 | 30 个独立用户、30 条私有 WS、100 并发、1000 次比赛读取，0 错误；P50 38ms、P95 69ms、P99 74ms、最大 78ms；`output/auth-full-load.json`。本机样本，不代表生产容量或持续高频行情容量 |
| 中继凭证隔离 | 通过并修复 | 原实现透传应用 Bearer、CSRF 和协议头；现已剥离应用凭证，保留独立场馆 Bearer/X-API-Key；实际 HTTP 回归测试及实际后端/上游探针验证 |
| 真实生产 River 读取 | 通过 | 生产当前 JWT 模式，只读诊断令牌 60 秒、不触发登录撤销；实际 Client_GetMatchs 返回 9 场。不是新代码部署后的验收 |
| 真实 HK relay | 通过 | 生产已登录身份调用现有 relay 到 PredictFun `/v1/tags`，200、success=true、240 条；`output/auth-full-production-readonly.mjs`。未打印 JWT、未下注 |
| 钱包新旧 SDK 签名认证 | 通过并修复 | 旧流程捕获固定 JWT；现按签名调用获取有效凭证，登录代次变化则停止旧任务。实际两套 SDK 调用专用后端，通过短令牌过期边界和 HMAC 校验，匿名签名 401，交易发送 0；`output/auth-full-sdk.mts`。不等同于真实钱包长交易验收 |
| 实际 Chrome 插件 | 隔离环境通过 | 加载构建后的 MV3 插件 1.3.64，版本通信、JWT HTTP 和 HTTPS+mTLS 请求均成功读取 1 场比赛。初次 HTTPS 为 ERR_NETWORK；仅设置 context.ignoreHTTPSErrors 不足，加入浏览器全局允许测试证书后通过。服务端仍严格验证客户端证书；未证明正式生产服务端证书信任链 |
| 生产 Caddy `/auth/*` | **未通过** | 真实 API `/auth/session` 返回 200 text/plain `changmen api`，未到认证路由；生产 Caddy 缺少 `/auth/*`。已修复三份部署模板，双域模板在 VPS 执行 `caddy validate` 成功；仅上传临时校验文件，未替换线上配置 |

上一轮实际 16 分钟存量 WS/过期重连、互斥登录、旧退出请求、CSRF/Origin、断网、503 探测、损坏登录响应及开关回退结果继续有效，见 [第一次执行记录](AUTH_ACCEPTANCE_2026-10-03.md)。其中误运行远程迁移的记录与影响不确定性仍然保留，不能被后续测试结果抵消。

## 本次修复范围

1. 三份 Caddy 模板加入 `/auth/*` 反代，双域与 mTLS 配置沿用可信客户端证书头的既有代理宏。
2. HTTP relay 剥离应用 Bearer、Cookie、token、CSRF、认证协议头；通过独立 token/Cookie 鉴权时保留场馆自身 Authorization。
3. 钱包准备流程提供带登录代次约束的凭证获取函数；新旧 SDK 每次签名获取凭证，失败直接抛错，不自动重放交易。
4. 专用验收库的地址核验用 `host(inet_server_addr())`，避免 PostgreSQL inet 文本的 `/32` 后缀误拒绝本机地址。所有数据库 URL 仍固定为本机专用库。

未修改下注与订单算法。工作区另一组订单观察改动未纳入本次提交；全仓库测试包含当时工作区内容。

## 发布前仍须完成

- 同一版本部署后端、Cookie 前端构建和已验证 Caddy 配置，配置独立 CSRF secret 与精确 Origin 白名单。当前生产 `AUTH_MODE=jwt`、Cookie 开关关闭、CSRF secret 未配置，不能以旧生产读取成功替代新版本验收。
- 在实际使用的 Chrome/插件证书环境中验证正式 HTTPS 证书信任链、登录、比赛、跨域 Cookie 与私有 Hub；隔离测试通过不替代生产版本验收。
- 以部署后的 River 身份执行登录/刷新/退出/撤销与回退检查；真实休眠唤醒、实际钱包长任务和生产行情 DB 池持续负载尚未通过本次验收。
- 现有用户停用检查 `assertProfileActive` 仍为空；空场馆测试账户、缺少 fixture 的部分赔率表列与受阻外部请求，不构成真实采集/下注/完整行情验收。

本报告的“通过”仅适用于表中已执行范围。生产配置与部署后联合验证仍阻止宣布认证全面上线验收通过。
