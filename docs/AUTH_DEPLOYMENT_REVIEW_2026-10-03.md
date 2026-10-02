# GitHub 对比与认证部署审查

执行日期：2026-10-03。源工作区：`E:\River\arb\changmen`。隔离候选：`codex/auth-deployment-review`。

## 对比结论

已实际 fetch origin。GitHub master 为 `7678122f`；源认证分支为 `c4f5b22a`，与 GitHub `origin/codex/unified-auth` 一致，但相对 master 有 3 个尚未纳入的业务提交。共同祖先以来的统计为 master 独有 3、认证分支独有 4，其中手动下注修复在两个分支有等价提交。

本次在隔离工作树合入 origin/master（合并提交 `d9de0297`），保留最新订单显示与业务修复；没有在源工作区执行 reset/stash 或覆盖未提交文件。候选包含 GitHub master 的全部历史。

源工作区仍有未提交的订单 UI、类型、Polymarket 逻辑位置、订单 DTO 和 package 元数据改动；它们不是本次候选发布内容。**不能以源工作区整体文件覆盖生产，应发布已审查的候选分支提交。**

## 模块边界修复

认证方案沿用 GitHub 的 JWT 兼容、Cookie 会话、登录互斥、证书约束与刷新方向。本次将登录用例从 router.ts 移入 core/auth/login_service.js，以注入的资料/策略钩子保持既有行为；原生认证路由不再导入业务总路由。前端令牌与登录代次状态从 api/client.ts 移入 lib/authSession.ts，并保留同一实例的兼容导出。

职责、依赖方向和自动边界规则见 [认证模块边界](AUTH_MODULE_BOUNDARIES.md)。认证模块在现有进程内独立，不引入额外服务或认证供应商。

## 业务兼容检查

对比 origin/master，以下源码无差异：`client/web/src/stores/accountStore.ts`、`stores/betting/`、`server/backend/core/account/`、`core/esport-api/account_client_routes.ts`、`pm_pf_routes.ts`、`store.js`、`server/match/matcher/compose/`、`packages/arb-core/`。订单 UI 保留 master 最新版本。

其他变更集中于认证接入、会话恢复、代理和 SDK 凭证、私有 Hub 权限及部署配置。缺少 CSRF、越权频道或应用令牌透传被拒绝属于预期鉴权收紧。正常身份经 Cookie 和 JWT 两种协议仍进入相同业务处理函数。

## 本次执行证据

| 检查 | 结果 |
|---|---|
| 全仓库 `npm test` | 13/13 成功；前端 2241 项、后端 209 项；`auth-review-full-tests.log` |
| 真实 PostgreSQL | 12 项全部通过，只使用 loopback `changmen_auth_test`；`auth-review-postgres-tests.log` |
| 默认脚本之外的账号/订单/代理回归 | 167 项通过；presence/last-login 两个 Node assert 脚本独立通过；`auth-review-business-unit.log` |
| 生产构建 | 默认兼容构建与 VITE_WEB_COOKIE_AUTH=1 构建均成功，含 vue-tsc；后端 compile:router 成功；`auth-review-build.log`、`auth-review-cookie-build.log`、`auth-review-router.log` |
| 模块规则 | 三组认证边界规则进入 check:boundaries；全仓库检查通过 |
| 实际 HTTP 业务链路 | 原生 Cookie、纯 JWT、旧登录入口均通过比赛/用户/空账号/空订单读取及 USERCONFIG 写读；普通用户管理接口拒绝，CSRF 缺失拒绝，旧 Cookie 被新登录撤销；`output/auth-acceptance-business.json` |
| 实际 WS 撤销 | 旧连接 30012ms 内撤销，旧退出请求不能影响新会话；`output/auth-acceptance-revocation.json` |
| 拆分后的实际 Vue 页面 | 原生 River 登录、刷新后比赛仍可读取，localStorage 无 access JWT；`output/auth-review-river.png`。仅使用专用库，无场馆采集/真实下注 |

单独前端回归首次出现既有 Polymarket 下单测试 5000ms 超时，之后该文件 51 项独立复测及全仓库测试均通过；未通过延长超时或修改下注逻辑掩盖失败。这仍是测试稳定性记录。

之前的 HTTPS/mTLS、插件、真实 HK relay、30 用户压力、数据库故障与 SDK 验收见 [全面验收记录](AUTH_COMPREHENSIVE_ACCEPTANCE_2026-10-03.md)。它们是之前代码与隔离配置的证据；本轮拆分新增了登录行为测试与实际业务链路验证，不将其冒充部署后的生产验证。

## 部署判断

候选版本通过已执行的代码、类型、构建及业务兼容验证，未发现阻止发布的认证代码缺陷。测试不能证明“绝对没有 bug”，空测试账号/订单也不能代替真实下注验收。

启用新 Cookie 页面前必须同步满足以下条件：

1. Caddy 的 API 域 `/auth/*` 实际反代到后端，而非返回 `changmen api`；双域模板已修复，但模板提交不等同线上配置已更新。
2. 使用现有 JWT_SECRET；配置独立的 WEB_AUTH_CSRF_SECRET（至少 32 字符）和精确 WEB_AUTH_ORIGINS；后端 WEB_AUTH_COOKIE_ENABLED=1，前端 VITE_WEB_COOKIE_AUTH=1，两端配套。保留现有 mTLS 可信头规则。
3. 以兼容客户端先行的发布顺序避免旧页面的 WS 握手与严格后端不匹配；校验现有 043/044 表结构。不要为验收重新运行整个生产迁移脚本。
4. 部署后实际 River 完成登录、刷新、比赛、账号、订单、插件、私有 Hub 和退出验证；回退保留原生会话接口，先切前端兼容构建再停 Cookie 登录开关。

本次仅准备候选版本，未推 master、触发生产发布或修改生产配置。源工作区未提交业务改动和正式生产证书链联合验收不包含在本次放行结论中。
