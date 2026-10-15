# 架构及第一轮解耦候选验收

本记录为合并最新 master 后的独立候选验收，取代 REVIEW.md 中的提交阻塞结论。architecture/COMMIT_SCOPE.json 及此前报告保留为历史证据，其旧哈希和旧部署规则不适用于本候选。

基线为 ebbcc398c00352b9b6e7e460622283a95639e8af，候选分支为 codex/architecture-round1-release。范围包括前置架构修复及其完整依赖、本轮核心 HTTP 契约回归、登录及在线信息数据库访问封装。没有新增前端业务代码或 GTC 策略改动。原工作区其他改动未带入。

Client_* / API_* 协议和业务调用行为保持一致。登录仅合并自身拥有的 preferences 字段，避免覆盖并发在线状态。

## 整理期间修复

- 保留上游最新发布规则：应用激活不调用数据库维护。更新旧回归断言和维护文件分类；独立结构检查仍使用只读事务。没有自动历史 SQL 重放、账号回填或初始化。
- 修复 Windows 干净检出后的 Vitest 加载错误：用精确 .gitattributes 条目固定 apply-rds-schema.mjs 的 hashbang 行为 LF。重新检出后两组共 25 项维护测试通过。

## 验证结果

- npm ci 完成。npm run check:change -- --staged：10/10 通过，sourceStable=true。
- 后端 784 通过 / 16 跳过；数据库包 359 通过；前端 3952 通过 / 1 跳过。
- 类型检查、生产构建、导入边界、路由编译和发布控制检查通过。
- FOK 551/551 保护通过，未修改保护基线。
- 临时 PostgreSQL：phase1 12、phase2 12、review-fixes 12、account-concurrency 7、deploy-safety 12、user-metadata 7，共 62 项通过。未访问生产 RDS。
- git diff --cached --check 通过。

受测源码树：63a01262d447e43a9db2cd26bf8a3a50eaa3776a。源码指纹：7a7461f32b6b85205fd912e824b6f03e2d9e3344106821456d3a65b5f9ab9368。验收后仅添加本说明和清单，并再次校验源码指纹。文件哈希见 release-candidate.json。

本记录是生产发布前的本地验收。推送 master 将由 Validate and release 读取线上版本、重新验证、封装制品并按计划先后端后前端发布；最终生产结果以该提交的 Actions 及运行版本核验为准。
