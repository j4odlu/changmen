# 2026-10-03 登录问题复查

## 2026-10-05 再次全面复查（本轮修复，部署状态待确认）

[changmen 扩展] 本轮检查认证入口、恢复/续期、单会话、跨页面状态及账号准备的认证消费路径，确认并修复五个缺口：

1. 会话探测把任何 HTTP 401 当成已撤销，包括代理返回的 HTML 和未知错误码。现在只有明确的 SESSION_REVOKED / ACCOUNT_DISABLED 才清会话；临时错误保留身份，解析响应后再次校验会话版本，避免旧响应清掉新登录。
2. 另一页面 origin 修改共享 API Cookie 时，本页收不到 storage 事件，原先直接替换会话信息可能混用新身份与旧用户数据。现在发现 userId、browserSessionId 或 loginEpoch 改变后关闭旧身份并刷新页面，冷启动恢复当前 Cookie。
3. Polymarket 钱包准备和 relayer 状态查询仍走 JWT 兼容凭证，在原生 Cookie 模式可能调用 Client_RefreshToken。这说明残留调用不只来自旧页面。两套钱包准备 SDK 均改为 Cookie + CSRF；签名凭证回调绑定发起操作的会话版本，登录变化后停止旧操作，不自动重放交易。原生 Cookie 模式的 JWT-only 外部兼容入口直接报不支持，不再请求旧认证接口。
4. 退出前探测确认会话已不存在时，本地版本变化曾让 logout 返回失败；现在明确无会话返回成功，新登录仍受版本保护。
5. 冷启动无本地会话提示时，认证服务配置错误曾被当成网络错误无限重试；现在保留配置错误提示并停止自动重试。

验证：前端全量 383 个测试文件通过、1 个跳过，2530 项测试通过、1 项跳过；vue-tsc 类型检查通过。后端认证/证书测试 154 项通过、16 项跳过（未配置真实 PostgreSQL 集成测试连接）；客户端/服务端边界、venue-adapter 四阶段检查及冻结路径检查通过。钱包验证使用离线 mock，未执行真实链上操作；本轮未完成真实浏览器多域名并发登录验收，测试通过不能证明所有生产故障均已消除。

## 2026-10-05 22:20 Ni02 反馈复查

生产认证审计在 22:20:43 有 `AUTH_MIGRATION / DENIED / COOKIE_LOGIN_REQUIRED`，其 `cert_cn=ni02`，可关联到 Ni02 的证书请求。该审计没有记录 action，不能仅凭它区分 Client_Login、Client_RefreshToken 或 Client_Logout，也不能还原用户当时看到的页面。

Ni02 当前会话创建于 19:10:28，与 `active_session_id` 一致，未撤销且持续更新 last_seen（复查时至少至 22:24:31）；当天最近的 LOGOUT 是 18:38:32，属于上一会话。新认证后端 `0d46aa4e` 和包含其改动的前端 `4054d627` 已部署。因此本次没有服务器到期/新登录撤销当前会话的证据；旧接口拒绝和旧页面的迁移处理是直接关联的排查方向。

[changmen 扩展] 已复现一个独立代码缺口：`COOKIE_LOGIN_REQUIRED` / `JWT_DISABLED` 被 SESSION_INVALID_CODES 视为会话失效；普通请求可清本地状态，旧自动续期也可触发退出。四条回归在修复前失败，证实这一错误分类。改为协议/页面版本问题，保留凭证；旧自动续期遇到迁移时停止并提示刷新页面，不清会话。真实 SESSION_REVOKED、ACCOUNT_DISABLED 继续退出。修复不会替换浏览器中已经运行的旧 JS；已有旧页面需刷新，HttpOnly Cookie 仍有效时可直接恢复，无需再次输入密码。该错误分类修复已随 bcf4e588 推送；部署完成状态需另行确认。

## 2026-10-05 后续策略变更（已发布）

[changmen 扩展] 用户要求「不主动退出就保持登录」，同时明确同账号不得多处共存。当前生产使用 `AUTH_MODE=cookie`；本次变更在该模式取消浏览器会话空闲 8 小时、绝对 7 天的到期判断。单会话策略继续执行：另一处成功登录会撤销旧会话，旧 Cookie 即使尚在保存期限内也无法使用；旧退出请求不得撤销新登录。以下历史记录里的期限属于变更前行为。显式 dual/legacy 回滚模式保留原 JWT 兼容约束。

现存未撤销 Cookie 会话在首次验证时升级期限，不批量恢复 LOGOUT、NEW_LOGIN 或证书吊销等已撤销会话。密钥哈希验证、CSRF、证书归属和吊销检查继续执行；数据库暂时不可用仍返回临时错误，不清客户端会话。

Cookie 登录写入 30 天的持久 Cookie（用户要求一个月，按 30 天计）；新前端首次会话监测及其后每 24 小时通过 `POST /auth/session/renew` 续期，重新开始 30 天保存期限。该请求与登录/退出共用 Web Locks，携带 CSRF 和预期会话身份，防止排队的旧续期覆盖新登录。`GET /auth/session` 继续只读且不写 Cookie，登录内部的恢复探测不会重入锁。浏览器重启后保留登录；用户清除 Cookie、更换浏览器或浏览器自身删除 Cookie 后仍需重新登录。浏览器超过 30 天完全不访问也无法从已删除的 Cookie 恢复身份。

发布需要前后端配套；旧页面刷新后才能开始新续期。此前已被浏览器删除或已撤销的会话需重新登录一次。无需数据库 schema 变更；认证代码使用既有 bigint 到期列的远期兼容值，当前 Cookie 模式不再按这些值结束登录。

## 本次故障及修复

River 在 changmen.fun 已显示用户名、账号和实时推送状态，但比赛列表为 0，搜索框为空，赛前全场筛选关闭。使用 River 当前 active_session_id 签发短期诊断 access token，以既有 token 请求头分别请求生产本机及公网 Client_GetMatchs，均返回 success=1、14 场比赛。诊断不改密码、不创建新登录、不撤销用户会话、不写业务数据。

`userStore.isLoggedIn` 自 2026-06-12 起采用 `Boolean(getToken())`；此前 token 是普通模块变量，Pinia computed 没有响应式依赖。Cookie 模式页面加载时内存 token 为空，第一次读取 getter 会缓存 false，之后恢复 access token 不能令 getter 重算，matchStore 和体育列表均会跳过请求。

2026-10-03 的 `52d9b38b` 在 `installClientCoreBridges()` 添加 `startOrderObservation()`。它在 main.ts 的 restoreSession 前启动，其 owner 回调读取 isLoggedIn。这条新增启动路径使旧问题稳定暴露：后端登录恢复成功，前端 getter 仍保持 false。该缺陷不是观察队列向外抛异常，而是共享登录 getter 的缓存副作用。

修复 `0abc4fa1` 将 api/client.ts 的内存 access token 改为 Vue shallowRef；保持 getToken/setToken 及 HTTP 契约不变，让现有登录 getter 感知恢复、登录及退出。回归用例先验证 cookie 模式下 computed 为 false，续期后应为 true，退出后应为 false；修复前失败，修复后通过。登录、续期及恢复相关 37 项测试与 typecheck:frontend 通过。此次提交只包含 client.ts 和对应测试，未包含工作区其他改动。

## 为什么近期集中出现

| 日期 / 提交 | 已确认的缺口 | 后续处理 |
| --- | --- | --- |
| 9 月 27 日 `9d6034a0` | 网络/临时失败与真正退出混淆 | 保留会话，恢复页允许重试 |
| 9 月 27 日 `430ffdc0` | 浏览器切换为 HttpOnly Cookie + 内存短期 access token，旧的同步 token 假设改变 | 新会话机制上线；仍兼容 legacy |
| 9 月 27 日 `bca1810b` / `0336ea38` | matcher 仍依赖旧 token，且页面站与 API Cookie origin 不一致 | 增加浏览器会话认证，导航到 Cookie 同源 matcher |
| 9 月 29 日 `849f3d17` | 过期被归并 AUTH_REQUIRED、后台页恢复、多标签页轮换及慢响应竞态 | 分类错误码、一次续期重放、会话版本、Web Locks、唤醒续期 |
| 10 月 1 日 `8bf10a65` | realtime hub 从 localStorage / 可读 Cookie 取 token，Cookie 模式已不在那里保存 | 通过 web 注入的内存 token getter 认证 |
| 10 月 3 日 `0abc4fa1` | Pinia 登录 getter 无响应式依赖；新增启动消费者提前缓存 false | 内存 token 改为响应式 |

共同原因是会话迁移跨越 HTTP、WS、matcher、页面启动、跨标签页等多个消费面，而回归主要分模块验证。新的启动消费者可以触发共享旧代码的潜在缺陷。9 月 29 日已有大量模块测试通过，仍未覆盖「冷启动、首次读登录 getter、异步恢复、赛事轮询」完整链路，测试数量不能代替这条启动路径的验证。

## 生产审计证据

北京时间 2026-10-03 00:45 左右，只读查询 auth_session_audit 最近 7 天的聚合：

- 全站 SESSION_RESTORE SUCCESS 16,980；River 5,680 次成功恢复，未查到 River 的 DENIED / FAILED 记录。
- 全站 ACCESS_TOKEN_EXPIRED 211 条拒绝审计；按用户/原因每分钟限频，既不是独立用户数，也不代表最终被踢出次数。
- 全站 BROWSER_IDLE_EXPIRED 7、CERT_BIND_FAILED 5、CERT_MISMATCH 1；这些是真正的生命周期或证书约束，不能和前端空列表混为一谈。
- 全站 NEW_LOGIN 撤销旧会话 34 条；River 5 条，均与其历史登录事件相连。这是当前单会话政策的行为，不能仅凭记录判定为用户主动操作或异常登录。
- 查询窗口未见 TEMPORARY_UNAVAILABLE 审计，不能据此排除未成功落审计的网络或数据库故障。

生产 AUTH_MODE=jwt 在代码中等同 Cookie 双轨模式；JWT_ACCESS_TTL=7d 作用于旧 access token，未配置 JWT_BROWSER_ACCESS_TTL，因此浏览器 access token 默认只有 15 分钟。浏览器会话仍为空闲 8 小时、绝对 7 天；10 分钟自动续期及唤醒续期不能取消这两个上限。15 分钟 access 到期后成功恢复是正常流程，不等于登录故障。

## 后续验收重点

1. 每次改认证或新增启动消费者，验证全新登录、Cookie 冷启动恢复、电竞/体育列表确实发请求并渲染。
2. 验证双标签页、休眠超过 access TTL 后唤醒、临时网络失败、重新登录期间旧请求返回，以及真实退出/撤销。
3. 确认 HTTP、WS、matcher 统一消费会话入口；禁止新增直接读取 localStorage token 的认证旁路。既有 legacy fallback 有兼容用途，不能仅按搜索结果全部删除。
4. 比赛列表 API 业务失败目前可被 getMatchs 转为空数组，且首页不显示 matchStore.error。这是诊断可见性缺口，可能让接口失败也表现为 0 场；本次已证实的根因是登录 getter，此处未擅自改动 A8 调用行为。

本记录不将所有历史反馈归因于单一问题。当前故障证据、历史已修复缺口和正常失效政策分别列明。
