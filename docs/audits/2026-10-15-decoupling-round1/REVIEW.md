# 第一轮代码复核与提交部署条件

日期：2026-10-15。结论：本轮复核未发现新增业务缺陷，当前整文件提交范围尚不完整，不能直接推送 master 或部署。

## 代码与验证

核对了元信息公开入口、数据库导出、profile SQL、连接池初始化、登录及在线状态调用路径、HTTP 回归测试、临时 PostgreSQL 测试和生产打包发布入口。

本轮 10 个源码及配置文件的规范化 SHA256 与此前完整验收一致。重新运行新增接口及行为回归 42 项、临时 PostgreSQL 7 项，全部通过。此前完整 `check:change` 的 10/10、551/551 保护、前后端测试和构建结果保留；这次没有改动业务代码，因此没有重复整个完整检查。

登录改为合并自己负责的字段；在线窗口、防抖、异常处理和 legacy 导入语义仍保持。新数据入口及其 package exports 必须随业务模块同时提交和发布。现有 `admin_service` 和通用配置整对象写入的并发边界仍属后续范围，不应把本轮结论扩大为整个 preferences 系统完全解耦。

## 提交范围阻断

用独立临时 Git index，将本轮清单的 10 个整文件叠加到 HEAD，生成检查树 `81f9c85d0fefe2128ed4233aee76c113622aee4e`。没有改变真实暂存区，没有创建 commit。

该候选缺少已被选中文件引用的 11 个文件：

- `scripts/testing/phase1-postgres.mjs`
- `scripts/testing/phase2-postgres.mjs`
- `scripts/testing/review-fixes-postgres.mjs`
- `scripts/testing/account-concurrency-postgres.mjs`
- `scripts/testing/deploy-account-preservation-postgres.mjs`
- `scripts/testing/offline-env.mjs`
- `scripts/testing/temporary-postgres.mjs`
- `server/backend/scripts/check-rds-schema.mjs`
- `server/backend/scripts/rds-migrations.test.mjs`
- `server/backend/scripts/rds-schema-check.test.mjs`
- `server/db/client_match_snapshot.js`

还缺少当前测试使用的 `server/backend/vitest.config.mjs`、`server/db/vitest.config.mjs`。因此当前工作区通过的测试不能证明这个缺项候选也能通过。

原因是 package 配置和 profile_store 同时包含此前架构修复与本轮改动。前一轮 99 文件清单也只是范围草稿；其中 profile_store 和三个 package 文件的内容指纹已因本轮变化更新。不能直接重用旧清单作为当前候选验收证明。

解决方式是在明确的候选中保留所需前置修复，或按修改片段拆出本轮独立增量及其测试基础设施，然后对该实际候选验证。不是简单把缺少的 13 个文件全部追加就已证明依赖完整。

## 推送与部署条件

当前分支是 master；`.github/workflows/release.yml` 对 master push 触发校验，随后按计划调用生产前后端发布工作流。push master 与启动生产发布存在直接关联。

| 动作 | 当前结论 | 还需完成 |
| --- | --- | --- |
| commit | 当前 10 个整文件范围不可直接提交 | 拆出依赖完整的候选，排除其它 PM/GTC 和临时文件，验证实际候选 |
| push master | 尚不可执行 | 确认将发布的候选版本及范围，通过原发布所需验证 |
| 部署 | 尚不可执行 | 对候选提交取得正式发布证据，读取生产组件基线并通过现有只读 schema 核验 |

本轮没有 schema 迁移需求。部署不得为了此改造重新执行历史 SQL。此前验收 `completeRelease=false`，仍不是生产发布完成的证明。

复核机器记录见 [review-readiness.json](review-readiness.json)。测试日志位于 `output/decoupling-round1/review-postgres.log`。本轮未提交、推送或连接生产数据库。
