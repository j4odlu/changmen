# 第一轮接口回归与登录在线信息收口验收

日期：2026-10-15。对应 [解耦方案](../../FRONTEND_BACKEND_RDS_DECOUPLING_PLAN.md) 的首轮范围。

## 实现范围

核心接口新增 34 项回归，覆盖 legacy 与 registry 两种分发模式。测试经过真实 `handleEsportRequest` 请求解析、序列化、账号路由及登录用例；持久化、场馆和部分鉴权边界使用 stub。因此这些是 HTTP 边界回归，不代表生产端到端验收。

固定的消费者样本包含：ACCOUNT 裸数组与 GetAccounts envelope 的区别，`key/content` 大小写及表单特殊字符，账号服务失败响应，三类采集 payload 与非法 JSON，SaveLiveTimer 的等待语义，比赛及可选场馆字段，订单分页与保存确认，绑定失败、未登录拦截、legacy/cookie 登录及 refresh 的错误码。

另新增 8 项登录和在线信息行为回归，先在原实现上运行，再在重构后运行，均通过。覆盖输入规范化、缺失用户、零行更新、写入异常、60 秒防抖、30 分钟在线窗口、失败后继续处理其它用户、原无自动重试规则及一次性 legacy 导入。

登录和在线信息通过 `@changmen/db/profile_metadata.js` 使用数据方法。`user_login_meta.js` 与 `user_presence.js` 已移除连接池访问和 SQL；数据方法位于现有 `server/db/rds/profile_store.js`。保持业务层对内存、调度、错误和 legacy JSON 文件的管理职责。

登录写入只合并 `lastLoginIp`、`lastLoginAt`，避免旧 profile 快照覆盖并发提交的在线时间及其它偏好。实时 presence 保留原来的最后写入覆盖规则；仅 legacy 导入使用“新时间更大才更新”。未改变请求、轮询、鉴权策略、下单流程或表结构。

## 文件范围

| 文件 | 本轮变化 |
| --- | --- |
| `server/backend/core/esport-api/core_contract.test.mjs` | 新增核心 HTTP 边界回归 |
| `server/backend/core/account/user_metadata_contract.test.mjs` | 新增元信息时序和错误行为回归 |
| `server/backend/core/account/user_login_meta.js` | 调用数据方法，移除直接 SQL |
| `server/backend/core/account/user_presence.js` | 调用数据方法，保留内存和调度 |
| `server/db/profile_metadata.js` | 新增公开数据子入口 |
| `server/db/rds/profile_store.js` | 新增登录和在线信息持久化方法 |
| `server/db/package.json` | 导出子入口 |
| `scripts/testing/user-metadata-postgres.mjs` | 新增临时 PostgreSQL 验证 |
| `server/backend/package.json` | 契约测试入口及默认回归接线 |
| `package.json` | 扩展正式契约入口，增加 PostgreSQL 验证命令 |

工作区原有其它修改保持。本轮增量备份位于 `output/decoupling-round1/before/`；当前全工作区测试结果不能直接作为独立提交候选的证明。

## 数据库验证

运行 `npm run test:user-metadata:postgres`，在新建的临时 PostgreSQL 集群执行真实 SQL，7 项通过：

1. 登录保存保留无关偏好并规范化 IP。
2. 暂停登录读取旧快照，在期间提交 presence 和偏好 patch，恢复登录后两者仍保留。
3. presence 在登录之后保存时保留登录字段。
4. 实时 flush 与 legacy 导入各自保持原时间覆盖规则。
5. 不存在的用户不返回持久化成功。
6. null、数组、字符串等历史 preferences 值保持原登录归一化行为。
7. 用触发器注入真实 SQL 失败，错误向上传播且无部分字段写入。

测试在加载应用模块前固定临时数据库连接与存储路径，没有查询或修改生产数据库。数据库自身的行锁及语句执行负责字段合并；没有把仅限单进程的 JavaScript 队列当作数据库并发保证。

## 发布保护与完整验证

第一次完整检查在 `server/db/index.js` 的既有精确导出保护处失败。随后撤销本轮对 index 和 impl_rds 的新增导出，改用独立公开子入口；两个旧入口相对本轮开始内容保持不变。没有修改原保护规则、551 项清单或基线哈希。

最终 `npm run check:change` 完整 10/10 阶段通过，`sourceStable=true`、`completeRelease=false`。包括 551/551 原保护项、部署控制、验证器测试、router 编译、后端、前端类型检查、前端测试和构建。后端主套件 784 项通过、16 项既定跳过；数据库包 359 项通过；前端 3952 项通过、1 项既定跳过。

单项契约入口通过：URL 断言、6 项既有出站校验及 34 项新增 HTTP 回归。原 profile 持久化单测 4 项通过，目标文件空白检查通过。另行执行的临时 PostgreSQL 7 项也通过。机器结果及本轮文件内容指纹见 [verification.json](verification.json)。

完整日志位于 `output/decoupling-round1/check-change-final.log`，数据库日志位于 `output/decoupling-round1/postgres.log`。原工作区的构建体积告警及测试环境 localStorage 提示没有导致失败，本轮未修改这些配置。

原工作区 `clob_proxy.test.mjs` 的已有空白告警不属于本轮变更，未顺手修改。

## 范围限制

这次消除了登录写入覆盖其它字段的旧快照问题。`admin_service.js`、通用配置等其它整对象 preferences 写入仍属于后续 SQL 收口范围；本次不声称所有偏好更新已具备跨路径并发保护。

没有改为“在线时间始终单调递增”、增加失败重试或改变 legacy 导入策略，这些属于业务语义变化，应另行安排。核心 HTTP 测试中账号空覆盖和归属失败验证的是错误传播；实际事务授权逻辑仍由既有账号与 PostgreSQL 回归负责。

本轮未提交、推送或部署。后续发布前仍需对精确候选内容执行原发布验收。
