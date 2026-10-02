# 认证生产发布与验收记录

本次沿用 GitHub master 的登录身份方向，认证模块在现有进程内独立。模块职责与依赖规则见 [认证模块边界](AUTH_MODULE_BOUNDARIES.md)。账号归属、比赛、订单、下注算法保持各自的业务边界。

## 生产准备

- 目标：香港服务器 `/root/changmen`，页面 `changmen.fun`，接口 `api.changmen.fun`。
- 发布前备份：`/root/changmen-release-backups/auth-20261003-3b36b19f`（目录权限 700）。包含后端配置、持久配置、Caddy 配置、代码、旧前端及用户认证元数据/会话快照；敏感文件不上传仓库。
- 配置：保留原 JWT_SECRET，启用 WEB_AUTH_COOKIE_ENABLED=1、AUTH_MODE=dual，设置独立随机 CSRF secret 及 changmen.fun/www 两个精确 Origin。前端生产构建启用 VITE_WEB_COOKIE_AUTH=1。
- Caddy 实际 `/auth/*` 已反代；mTLS 信任边界保留。配置通过验证后 reload。

## 发布中发现并处理的问题

1. 干净 CI checkout 缺少 gitignore 的后端生成路由。已在完整测试前执行 compile:router。
2. Node 24 Linux 缺少 sessionStorage，订单日期测试依赖上海时区。补齐测试 storage 模拟，CI 测试时区设为 Asia/Shanghai；不更改订单业务算法。对应四个测试文件本地 66 项通过。
3. GitHub 成功运行可能仅发布前端或完全跳过部署。最初基线分类包含旧变更，后端运行 37059308855 重复执行了已有 schema 与玩家归属/账号回填。不能声称本次没有运行迁移。
4. 已改为解压临时源码并在覆盖前逐文件对比实际生产内容，生成可信变更清单。相同 migration 文件不再触发迁移；真实 migration 变更仍受部署规则处理。新增实际文件对比测试及四个部署计划测试，5 项通过。

重复迁移后的只读核查：17 个用户认证元数据与发布前完全相同；迁移前备份的 90 个有效玩家均存在且仍有效，归属无变化，token/password/gateway/secret_key/privateKey/private_key/username/userName 关键字段无变化，当前有效账号仍为 90，缺失归属为 0。迁移前玩家备份已另存 `players-before-deploy.json`，权限 600。这些检查不等于全数据库逐行不变证明；赛事/订单在生产中持续写入。

## 实际生产验收范围

使用 River 真实客户端证书，验证官方服务器证书；用现有登录代次签发仅 120 秒的诊断 JWT，在内存中使用，无重置密码、撤销用户会话或交易请求：

- 原生 `/auth/session` 无 Cookie 返回 401，外域登录被拒绝；两个页面域 CORS 正常。
- River 用户信息、比赛、账号、订单可读取；首轮实际结果比赛 6、账号 7、当日订单 7。
- 香港 PredictFun relay 返回 240 个标签。
- 实际生产 WebSocket 私有频道可订阅自身用户，拒绝其他用户频道。
- 用户提供密码后，使用真实生产原生密码登录独立验证：登录响应不含 JWT/refresh token，Cookie 为 __Host-cm_session、Secure、HttpOnly、SameSite=Strict、Path=/ 且无 Domain；新的独立请求恢复同一会话。
- 原生 Cookie 读取 River 用户、比赛 7、账号 7、当日订单 8；数量随实时业务变化。Cookie 换取 SDK JWT 有效期 900 秒；原生 Cookie 私有 WebSocket 自身频道允许、其他用户频道拒绝。
- 缺 CSRF 的退出被拒绝且会话保留；合法退出撤销 Cookie；再次密码登录成功，旧 Cookie 仍失效。验收最后保留有效 River 登录代次；未发送交易请求。
- 当前 Tabbit 浏览器启动退出码 69、无诊断输出，无法执行生产 UI 点击/刷新。独立请求的 Cookie 恢复不冒充浏览器页面刷新。隔离 Vue 页面实际刷新已有候选验收证据。

隔离环境的 Vue 页面、SDK/插件与故障测试证据见 [候选验收](AUTH_DEPLOYMENT_REVIEW_2026-10-03.md) 和 [全面验收](AUTH_COMPREHENSIVE_ACCEPTANCE_2026-10-03.md)。不将这些隔离结果冒充生产 UI 验收。

## 最终发布结果

代码版本 `3c51a37007e47ad3f601c06f53339989913e59cb` 已推送 master 和 codex/auth-deployment-review，完整 [GitHub 发布运行 37060744445](https://github.com/j4odlu/changmen/actions/runs/37060744445) 的 classify、build、deploy-backend、deploy-frontend 全部成功。Linux Node 24 完整 npm test 13/13 任务成功，前端 2241 项通过，后端 209 项通过、12 项需专用 PostgreSQL 的测试跳过；这些 PostgreSQL 项此前已在专用本地数据库另行通过。

最新发布按实际源码核出 6 项变化，未再次执行 schema 或账号/归属回填。生产前端全部 132 个文件内容 SHA-256 与该 CI artifact 一致；changmen.fun/www 首页和入口 JS 的外网请求也匹配。生产 8 个 PM2 进程 online；River 真实原生密码登录和 JWT/relay/私有 WS 验收成功。

原始主工作区 E:\River\arb\changmen 中其他任务未提交的订单改动保持原样。本次完整代码位于管理 worktree auth-deployment-review，不能把未提交工作区内容当作已发布版本。

上线已完成，已执行的自动验收通过。生产 UI 的点击/刷新仍是明确未覆盖项，测试结果不保证绝对无 bug，也不包含真实下注。

生产回退保留原生接口，优先恢复备份的兼容前端，再根据需要恢复配置；不在缺乏差异审计时自动覆盖整个生产数据库。旧前端可从 frontend.tgz 解压到新的临时目录，校验 index.html/assets 后替换 dist；配置回退使用备份 backend.env/persisted.env/Caddyfile，Caddy 校验后 reload、后端按需 restart。上线前备份保留，避免与持续写入的生产账号/订单相互覆盖。
