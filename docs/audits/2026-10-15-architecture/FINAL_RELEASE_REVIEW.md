# 发布改进独立复核

2026-10-15；基准 `1f9ca758959a24d947439bc42be6ae2ce5c3661e`。仅本地检查和临时 PostgreSQL，不连接生产，不 commit/push，不部署。

**最新处理：按用户要求，发布已改成只读结构核验。** 本轮先发现并复现首次账本接入的历史 SQL 数据重放，随后修复：日常 backend 激活调用独立只读检查，不执行历史编号 SQL，也不创建或补写账本。缺项时在 PM2 变更前中止；初始化只有显式空库命令可执行，遇到业务表拒绝。本文件和 `final-release-review.json` 优先于上一轮验收状态。

## 已复现并修复的问题（历史证据）

**[P1] 首次接入账本把缺少记录等同于从未执行，重放历史权限回填。**

`server/backend/scripts/rds-migrations.mjs` 创建账本后，依次执行所有缺少记录的迁移。已经升级过结构、尚未接入账本的数据库，也会执行 `004_users_is_admin.sql` 中按用户名授予管理员的 UPDATE，以及 `012_user_roles_teams.sql` 中的角色回填。

在临时数据库先完成当前全部结构，再创建一名测试用户，设为 `is_admin=false, role=user`，清空迁移记录模拟首次接入，然后调用真实 `applyRdsSchema`。结果为 `is_admin=true, role=admin`。再加入无归属的测试 player，使后续 027 迁移拒绝执行；前面已逐文件提交的权限改写仍然保留。发布代码回退不会撤销这些数据库提交。

**测试用户名 `tj01` 是本轮在临时数据库创建的合成数据，不是生产账号调查结果。** 用户已说明生产没有该账号；本轮没有查询生产用户。004 只命中大小写不敏感的 `admin`、`tj01`，不存在匹配行时该 UPDATE 不改账号。本问题是首次接入机制存在有条件的数据重放风险，不表示生产已经发生权限变化。

旧 SQL 030/032/035 还包含 player 身份字段的回填/去重操作，不能把“停止 JSON 导入”描述为“所有历史数据修改都停止”。本轮没有观察到当前余额或 token 被这些 SQL 改写。

修复前复现结果保存在 `final-release-review.json` 的 `historicalFinding`；本地详细日志为 `output/deploy-safety-role-recheck.log`。这是修复前缺陷的证据，不是对生产账号存在性的断言。

最终采用更小的发布职责：只核验已有 schema，不自动登记任何迁移；缺失结构与历史数据维护分开处理。不会把全部历史迁移无条件标成已完成。初始化工具仍保留校验值、会话锁、逐迁移事务，正式发布闸门保持。

## 只读核验实现

`server/backend/scripts/check-rds-schema.mjs` 使用真实 PostgreSQL 的 `REPEATABLE READ READ ONLY` 事务读取系统目录；要求 33 张表、373 个字段、68 项约束、124 项索引、19 项序列、4 个函数和 2 个触发器符合固定要求。字段核对类型、默认值、空值限制和 identity/generated 属性，索引核对定义及 valid/ready 状态，约束核对定义和 validated 状态。核对序列结构，不读取或设置其当前值。独立运行时表/索引可存在，编号 SQL 所要求的对象一项也不能缺。

`rds-schema-baseline.json` 来自全新临时 PostgreSQL 按 42 项显式清单创建的结构，包含每个 SQL 的校验值，未从生产录制。运行时拒绝核验清单漏掉新增迁移、历史 SQL 校验值改变、已有账本校验值冲突。没有账本或账本为空时也只检查，不回填记录。

`apply-rds-schema.mjs` 命令默认同样只读核验。空库初始化必须显式 `--initialize`，已有业务表时拒绝；本地 fixture 兼容导出在已有库也只核验。旧库缺 034/039 时，正式第一阶段回归现在要求先报告缺失、不动账本或账号；测试中仅显式补这两项结构后才通过核验。

## 发布保护与 A8 边界

- 原 551 项清单、固定基线、冻结哈希、Actions 工作流、归档签章及发布闸门没有修改。
- `fok-exact-boundaries.mjs` 增加了精确持久化增量登记：3 个文件、12 个完整声明，通过固定 SHA256 的契约逐项还原，再进入原整模块对照。没有文件级豁免或只按函数名跳过。新增的 29 项来源/负向测试检查函数体变化、部分回退、额外行为和契约篡改。
- 本次相对基准没有修改已跟踪的 `client/web`、`chrome-extension` 运行代码；原有未跟踪的 `client/web/src/runtime/orderPolling/accountRead.ts` 排除在候选范围之外。
- 核对账号 `loadAccounts`、`persistAccounts`、余额刷新后的 `saveAccounts`；未新增空列表或管理端预览跳过保存的前端门控。原 HTTP 调用顺序、120～180 秒余额轮询、matcher 30 秒周期和 timer 3 秒去抖保持。
- 后端空 ACCOUNT 覆盖拒绝、归属校验、余额保护及事务提交后发布缓存的回归仍通过。本轮修改部署/核验工具、测试接线和文档，没有修改前端、账号业务实现或历史 SQL。
- A8 参考 `index0706.js` SHA256：`33b8a5e586f55564ac5483c723cc613b144726985daaa45c936d90fa038c4279`。

## 本地验证

完整 `check:change` 的结果与每阶段耗时见 `final-release-review.json`。另重跑：第一阶段 12 项、第二阶段 12 项、业务修复 12 项、账号并发 7 项、事务/缓存边界 8 项、部署/结构只读边界 12 项及快照边界 5 项，共 68 项。核验单元测试 21 项已接入 backend 默认回归。

最终本地验收通过：`check:change` full 10/10，`sourceStable=true`；551/551 原保护项通过；后端 726 项、前端 3938 项及类型检查/构建通过，既定跳过项保留。上述 68 项数据库/缓存场景全部通过。`completeRelease=false`，没有生产版本捕获或生产验收。

部署回归从只比较 players/profile 的 3 项扩展到 12 项：实际调用部署脚本，比较 players、users、profiles 整行及序列当前值；覆盖无账本、空账本、full 激活、缺字段、错误类型、缺 owner 约束、缺唯一索引和禁用触发器。另注入意外 UPDATE，确认 PostgreSQL 返回 `25006` 拒绝写入，回滚后下一次核验正常。

本地 `check:change` 不是生产 `completeRelease` 验收，也不是隔离提交候选验收。当前工作区包含其它原有改动；后续实际提交前须以明确候选内容重新验收。

## 提交范围草稿

`COMMIT_SCOPE.json` 按显式文件名列出本对话涉及的账号持久化/事务、matcher/快照、测试接线、部署与保护增量，以及审计材料；保存内容哈希用于后续检查。**草稿不是已通过的提交候选，没有 stage 或 commit。**

排除原有 PM/GTC 文档修改/删除、`docs/ARCHITECTURE.md`、Polymarket adapter README、其它历史审计、新增前端 orderPolling 文件、其它运维/验证脚本、AGENTS.md、output 和浏览器临时文件。没有使用 `git add .`，现有索引保持不变。

最终清单包含 99 个文件，排除 52 项已有变更（另以目录规则排除 output/浏览器临时文件）。未创建隔离提交候选，后续实际提交前仍需对该精确范围做候选验收。
