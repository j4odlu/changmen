# 统一认证底层执行方案

更新：2026-10-03。本文替代此前的 cookie-v1/v2 模式协商方案。

## 目标与边界

在现有后端内集中认证，不新增独立服务。Cookie 和 JWT 经统一身份校验产生 AuthContext，业务只消费身份并判断权限。数据库操作只经过 server/db。ACCOUNT 调用时序、合场和下注算法保持既有行为。

服务端核心：core/auth/identity.js（凭证到身份）、request_auth.js（Client_* 接入）、http_identity.js（原生 HTTP 接入）、realtime_auth.js（WS 接入及频道权限）；登录及撤销事务在 server/db/rds/auth_store.js。

前端核心：lib/authSessionState.ts（公开会话状态）、webSession.ts（探测/唤醒/重试）、authCredentials.ts（请求凭证及外部 JWT 兼容）、runtime/sessionRecovery.ts（启动身份恢复）。api/client.ts 保留既有调用接口并委托会话状态模块。

身份包含 userId、sessionId、loginEpoch、credentialType。Cookie sessionId 是浏览器会话 ID；旧 JWT 使用登录代次作会话标识，不把它当 Cookie 会话 ID。账号、管理员、团队和频道权限仍由对应业务负责。

## 凭证与政策

- Web 使用随机不透明 Cookie；数据库只存 secret 摘要。生产 __Host-cm_session，HttpOnly/Secure/SameSite=Strict/Path=/，不扩大到整个父域。
- Cookie 空闲期限 8 小时，绝对期限 7 天；JWT 默认 15 分钟，刷新凭证 30 天。保留现有登录互斥和客户端证书规则。
- 原生 /auth/login 不返回 JWT；/auth/session 返回公开身份、期限及绑定会话/登录代次的 CSRF 值；/auth/logout 定向撤销。
- 插件、旧页面、外部 relay 和只支持 Bearer 的 SDK 保留 JWT 兼容。按需取短期凭证，普通 Cookie 业务请求不依赖 JWT。
- 双凭证身份/代次冲突拒绝；明确请求 Cookie 时不会降级为 JWT；旧 JWT 无效时不会用 Cookie 隐式救活。
- 网络/DB 故障返回 TEMPORARY_UNAVAILABLE，前端保留已知身份并阻止新的需鉴权请求，不伪装成未登录。
- 旧 JWT HTTP 撤销检查保留最多 60 秒缓存；私有 WS 握手/操作 fresh 检查，每 30 秒检查存量连接。缓存与检查频率需通过负载验收。

## 实际域名与调用路径

生产 client/web/.env.production 使用 https://api.changmen.fun。私有 hub 的 resolveChangmenWsBase 同样优先 VITE_API_BASE，因此 API 与 hub 可共用 API 主机 Cookie；页面域名本身与 API 跨源，HTTP 必须 credentials=include，CORS 必须精确允许页面 Origin。暂不改变部署域名或工作流中的 API 域名检查。

| 路径 | 接入方式 | 兼容/限制 |
|---|---|---|
| Client_* / API_* | resolveRequestAuth -> authenticateIdentity | Cookie action 全部 POST + CSRF，JWT 保留 |
| IPC action | 同一身份校验 | 登录直接调用事务入口，JWT 接入 |
| matcher | 共享身份校验 | Cookie 写入 CSRF，角色判断保留 |
| 私有 hub | 共享身份校验 | 频道、本人/团队及查询回复权限独立校验 |
| relayer/status/sign、废弃 L1 凭证接口 | requireHttpUser | Cookie 可用；SDK Bearer 兼容；L1 仍返回 410 |
| http-relay | requireHttpUser | REQUIRE_TOKEN 时验证真实会话；Cookie relay 包括 GET 要求 CSRF |
| PM L2 relay | requireHttpUser + 账号归属检查 | 保留平台签名与订单算法 |
| client-core 平台 HTTP | 注入异步 getAuthHeaders | 本后端 Cookie；外部 relay JWT；直连场馆不附本站凭证 |
| KV 读取 | authHeaders + credentials=include | 保留既有 KV wire 格式 |
| 公共 Market hub | 既有公共读取/可选归因 | 不随私有 hub 改为登录门控 |

外部 HK relay 的实际版本、配置、Origin/证书及 SDK 长任务超过凭证期限仍需预生产验证，不能仅根据代码宣称已兼容。

## 已完成的本地实施

- 移除 capabilities、session/mode、modeRevision、用户名单协商及未部署的 045 模式迁移。
- Cookie/JWT 共用身份校验；HTTP、IPC、matcher、私有 WS、钱包服务及 relay 接入。
- 保留登录用户行锁及完整事务；Cookie logout 新增事务，同时撤销登录代次、Cookie 和刷新凭证，无 JWT 桥接和删除 Cookie 响应。
- Cookie 写入 CSRF/Origin，双凭证冲突拒绝，私有 hub 不再只检查非空 token。
- 前端会话状态抽离；按登录代次合并探测；身份恢复退避重试；临时故障保留会话。
- runtime 初始化失败可重试；同代次并发初始化合并；退出后旧初始化不能再启动采集；主循环启动前检查登录代次。
- 外部 relay/SDK 通过统一兼容凭证入口获取当前短期 JWT，不重放业务写请求。

## 发布配置与顺序

后端 WEB_AUTH_COOKIE_ENABLED 默认 0；WEB_AUTH_CSRF_SECRET 使用独立至少 32 字符随机密钥；WEB_AUTH_ORIGINS 生产精确列出实际页面 Origin。示例配置默认不启用 Cookie 迁移。开发时不要照搬生产 Origin 覆盖默认 localhost 白名单。

前端 VITE_WEB_COOKIE_AUTH=1 才使用不返回 JWT 的原生登录；首轮兼容客户端保持未设置。服务端登录 Cookie 功能还要求 AUTH_MODE=dual（不能 off/legacy）。普通恢复只在 Cookie 支持启用后采用新路径；已采用 Cookie 的页面发现配置撤回会暂停并要求刷新，不做运行期模式切换。

1. 工作分支提交并审查。master push 会触发自动生产部署，不直接推 master。
2. 发布兼容客户端：动态 WS 握手、统一凭证入口、Cookie 接收能力；保留旧登录路径。
3. 对旧已打开页面完成覆盖策略后发布后端。严格私有 hub 不受 Cookie 开关控制，不能用关闭 Cookie 开关代替客户端先行。
4. 预生产验收后启用后端 Cookie 路径，再发布 VITE_WEB_COOKIE_AUTH=1 客户端。
5. 观察登录失败原因、恢复时长、业务请求错误、DB 池等待、私有拒绝和撤销延迟。

回退保留 /auth/session 与 /auth/logout 等接口，先回退前端到兼容构建，要求页面刷新，再关闭 Cookie 启用开关。不得直接恢复成只接收 JWT、没有 Cookie 接口的旧后端；严格鉴权不回退到非空 token 放行。

数据库继续使用已有 043/044，部署前检查已应用。不需要认证模式表或字段。

## 本地验证与待完成验收

本地通过：后端测试、真实 HTTP 会话协议测试、前端认证/WS/恢复/初始化测试、client-core 凭证桥接测试、matcher 身份、realtime-hub、前端生产构建/vue-tsc、compile:router、团队边界和共享包检查。

真实 PostgreSQL 使用专用本机 changmen_auth_test；12 项涵盖登录 6 个写入故障、并发登录、退出 3 个写入故障、正常撤销和旧退出代次冲突。测试服务已停止；未使用生产数据库。默认无 AUTH_TEST_DATABASE_URL 时跳过；测试会清空专用库 fixture，代码只允许 127.0.0.1/changmen_auth_test。

生产尚未部署。上线前仍必须：

- 真实浏览器 + Cookie jar + 私有 WS 联合验收，River 比赛加载、刷新、多标签、超过 15 分钟重连、睡眠唤醒。
- 提交成功但响应丢失的恢复验收；不能自动重放登录或业务写入。
- 插件、外部 HK relay、钱包/SDK 与证书 Origin 的实际配置验证。
- 账号、采集、订单流程回归，以及 DB 池/高频行情压力验证。
- 登录互斥/撤销、在线与休眠旧页面的发布和刷新回退演练。
- 现有 assertProfileActive 是空函数，没有实际停用状态模型。本批不凭空改变账号政策，不宣称已提供用户停用保护；需产品规则和数据库模型明确后补齐。

Passkey、管理员 MFA、设备管理作为后续能力接入统一底层，不进入本批上线范围。

验证计数：后端 200、前端及共享请求层 62、hub 18、matcher 11、真实 PostgreSQL 12；合计 303 项，不重复计入数据库测试的默认跳过项。登录提交后 profile 恢复失败明确报告 LOGIN_RESULT_UNCERTAIN，并保留已提交 Cookie，客户端不自动重放登录。
