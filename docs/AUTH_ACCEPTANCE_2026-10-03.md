# 统一认证执行验收

执行日期：2026-10-03。分支：`codex/unified-auth`。验收使用本机专用 PostgreSQL、实际 Vue 页面、实际 HTTP 路由及私有 Socket.IO Hub；River 为隔离库测试账号。未发布认证代码到生产。

## 已执行结果

| 验收项 | 结果与证据 |
|---|---|
| 全仓库回归 | `npm test`：13 个任务成功；前端 355 文件、2235 项，后端 200 项，另有 matcher、共享包、collector、Hub 检查；完整日志 `output/auth-acceptance-full-tests.log` |
| 最终修复验证 | 原生登录/退出 4 项、环境隔离 1 项、后端 200 项、真实 PostgreSQL 12 项通过；vue-tsc、生产构建和团队边界通过 |
| 原生浏览器登录 | 不返回 JWT，HttpOnly Cookie 在 JavaScript 不可读；localStorage 无 token key |
| River 比赛 | 成功显示专用库的 1 场比赛；刷新、多标签可恢复，私有 Hub 已连接 |
| 断网/恢复 | 身份保留为 unavailable，恢复网络后 authenticated，并收到新的成功比赛响应；未仅靠旧画面判断恢复 |
| 冷启动 503 | 连续两次探测 503，不呈现匿名登录；自动重试读取并恢复比赛 |
| 登录提交后响应损坏 | 实际登录已提交并写 Cookie，故意截断响应 JSON；页面提示结果未确认，刷新恢复；登录写请求恰好 1 次 |
| 登录超时 | 故意挂起请求，约 10493ms 返回错误，锁释放，手动再次登录成功；没有自动重放 |
| JWT 兼容入口 | Cookie 用户按需获得 JWT，独立不带 Cookie 的 token 请求成功读取比赛；不把此项等同于真实外部 relay/SDK 验收 |
| 登录互斥与定向退出 | 新登录后旧 Cookie HTTP 立即 401；携新 Cookie 提交旧退出预期返回 409，新会话仍有效 |
| 私有 WS 权限与撤销 | 本人频道允许、他人频道拒绝；旧存量连接约 30010ms 收到 auth:ended |
| CSRF/Origin | 缺少 CSRF 的 Cookie action 拒绝；恶意 Origin 退出返回 403 |
| 兼容构建回退 | 独立服务关闭 Cookie 开关，前端 VITE_WEB_COOKIE_AUTH=0；登录、刷新、比赛读取成功，使用 JWT |
| 压力抽样 | 100 并发比赛读取，0 错误；P50 63ms、P95 78ms、最大 94ms。本机单会话样本，不代表生产容量 |
| 超过 JWT 默认期限 | 真实运行 960527ms（16 分钟）通过；Cookie 会话、比赛读取及存量 WS 正常，断开后重新握手与订阅成功；`output/auth-acceptance-long.json` 的 passed=true |

浏览器证据：`output/playwright/auth-river-matches.png`；协议证据：`output/auth-acceptance-revocation.json`。复现入口见 `server/backend/scripts/auth-acceptance/README.md`。

## 修复

1. 原生登录和退出增加 10 秒请求期限。登录响应丢失/损坏时清除旧登录代次的本地凭证，保留 Cookie 恢复提示，要求读会话确认；不重放登录。退出先清本地身份，确认请求有期限。
2. 环境加载器保留显式置空的 DATABASE_URL / DATABASE_URL_INTERNAL / DATABASE_URL_PUBLIC，防止 `.env` 悄悄恢复远程备用地址。专用验收脚本在迁移或写 fixture 前同时核验真实数据库名与服务器地址，并固定所有 URL 为本机专用库。

## 环境隔离失误记录

首次准备数据库时，执行者将 INTERNAL/PUBLIC 设为空后运行现有 apply-rds-schema；loadChangmenEnv 删除了空变量并从 backend/.env 重新注入地址。2026-10-03 02:50:42–02:50:48（本机北京时间）脚本误选已配置的远程 RDS，并执行一次现有迁移。执行者已向用户报告并修复环境覆盖问题。

这些迁移包含 DDL、管理员/角色回填、场馆账号标识回填、重复标识清理及更新时间写入，不能仅因脚本可重复运行就称为只读或零变化。没有执行前快照，无法完整证明受影响行数或无变化；未盲目回滚。只读核查：users/profiles 各 17，活跃 players 90，orders 22219，client_matches 4452；未发现 acceptance-long 用户，非空账号指纹无重复。生产 8 个 PM2 进程均 online。这些结果证明当前可读与部分一致性，不构成前后无变化证明。

误执行日志 `output/auth-acceptance-schema.log`；之后专用库迁移日志 `output/auth-acceptance-local-schema.log`。测试账号与后续故障注入均在本机专用库。

## 尚不能据此宣布生产全面通过

- 真实 HK relay、插件连接、钱包 SDK 长任务及生产 mTLS/CORS/Secure Cookie 联合链路尚未跑完；当前运行的生产后端没有部署本批代码。
- 断网及 focus/pageshow 覆盖恢复事件，未把机器实际休眠与唤醒当作已完成项目。
- 空测试账号覆盖页面加载和相关自动化回归，没有真实场馆采集、签名或真实下注。
- 测试页有未启动场馆 WS 转发、被拦截的场馆请求和缺失字体告警；本报告确认身份、比赛读取和私有 Hub，不宣称全部场馆运行无异常。
- 未提供生产规模多用户/高频行情 DB 池容量结论，也未补充用户停用模型；现有 assertProfileActive 仍为空函数。

本机验收结果可作为预生产候选依据；上述项和远程迁移影响核查仍属于发布前限制。
