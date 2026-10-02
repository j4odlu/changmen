# 2026-10-03 登录问题复查

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
