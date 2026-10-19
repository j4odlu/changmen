# Node 基础包目录隔离第二轮

[changmen 扩展] 2026-10-19，在 `E:\River\arb\changmen` 的 `master` 工作目录实施，起点为 `92c0d7d6a223cfc421c29590f495ec115c9aec49`。本轮只调整源码归属、安装声明、打包和检查入口，未执行数据库迁移。

## 实施范围

| 公共包 | 唯一实现目录 | 原目录用途 |
| --- | --- | --- |
| `@changmen/venue-node-loader` | `server/packages/venue-node-loader` | `packages/venue-adapter/loader` 保留转导出与旧包配置 |
| `@changmen/venue-node-registry` | `server/packages/venue-node-registry` | `packages/venue-adapter/registry` 保留转导出，以及浏览器注册代码和共享 catalog |

迁移三个运行文件：`adapter_paths.mjs`、`paths.js`、`feeds.js`。原 Node 目录退出根 workspace，新目录接管相同包名与 exports；backend 和 resolver 的本地依赖、锁文件链接同步更新。925 个外部依赖条目与起点完全一致。

运行逻辑保持原样，只有两个模块的位置锚点显式映射回原资源目录，保留资源查找顺序、环境变量、平台别名、缓存和初始化时序。旧入口转导出同一实现，不创建第二套缓存。打包工具在瘦包内将三个转发入口展开为原始实现，避免产物依赖包外的新源码目录；自定义部分资源输入仍可使用。

Node 包的 `manifest.json` 公开导出保留一份 catalog 副本；唯一维护源仍是 `packages/venue-adapter/registry/manifest.json`，边界检查要求两者完全一致。这是本轮保留的资源约束，尚未完成 catalog 的共享包归位。旧资源根、浏览器 adapter 和打包工具目录也尚未退役。

发布分类和前后端版本指纹继续覆盖新 Node 目录，保持原有保守发布范围。未启用精简生产安装、缩小归档或改变 Actions 部署流程。

## 验证与修复

- 新增完整源码迁移证明：旧入口必须精确转发；新实现还原位置锚点后与起点完整内容一致。缺失、重定向、实现漂移和 catalog 不一致都会失败。历史基线未改写，未增加目录级豁免。
- 新增新旧入口、公开包入口的函数身份与共享缓存验证，覆盖 catalog 导出、新旧环境变量、平台别名和瘦包内容。
- 修正原测试指向旧实现路径、入口数量及独立安装脚本将模块 namespace 对象当作函数身份的断言。原业务断言保留。
- 第一轮的完整源码测试曾在并发构建时超过默认 5 秒；改为每个文件只读取一次 Git 原文，并给跨进程读取设置 30 秒上限，保留所有逐字校验。

| 验证 | 最终结果 |
| --- | --- |
| `npm run test:checks` | 边界、包导出、契约及 24 步 catalog smoke 全部通过 |
| Actions 同命令 verification-control | 102 个文件、2,683 项全部通过，包含本轮 8 项迁移回归 |
| 独立 node:test 与发布分类/安装 profile | 27 项通过 |
| backend workspace 全量测试 | 883 项通过、16 项原有跳过；另有登录/在线状态两个 node:test 及瘦包运行验证通过 |
| `npm run app:build` | 前端类型检查、生产构建通过；存在原有大 chunk 体积提示 |
| `node scripts/deploy/check-controls.mjs` | 103 项通过，发布切换、重试、回滚、存储隔离集成演练通过 |
| 依赖与格式 | 925 个外部锁条目未变；`git diff --check` 通过 |

不同测试组可能存在交叉覆盖，不累计为一个总测试数。验收结果见本机 `output/node-package-isolation-20261019/` 的 `checks.log`、`controls-final.log`、`node-tests.log`、`backend.log`、`build.log`、`deploy-controls.log`。`controls-initial.log` 和 `controls.log` 保留修复前的路径断言及超时记录，以最终复验为准。

独立后端安装另存于 `output/backend-install-isolation/`：完整安装与按消费者选择安装均离线成功、路由编译成功；386 个文件、1,053 个字面量引用的解析一致且无未解析项。原有 11 个动态未知输入继续登记，不据此宣称完整运行闭包已认证。原生加载验证无网络尝试，未启动服务。

这轮证明 Node 实现和 workspace 已归服务端；并不表示整个混合 adapter 已彻底拆完，也不等于生产部署验收。本轮未 commit、push 或部署。开始前已有的架构文档、matcher README 及其他计划/审计文档保持原状。

## 同日全面复核

复核源码差异、workspace 与依赖声明、新旧入口状态、目录回退、环境变量、catalog 一致性、版本指纹、发布分类及 Actions 归档链路，未发现新的业务逻辑回归。没有修改运行实现或数据库。

补充一项此前没有直接覆盖的回归：瘦包在仓库外的临时目录中执行，复制真实 storage 包，使用确定性的离线平台模块；完全没有 `packages/`、`server/packages/`、`devtools/` 或指回本仓库的依赖链接。实际验证默认资源回退、registry 加载、平台别名、预加载及缓存重置。该测试通过，本轮迁移回归增至 9 项。

前端另做独立安装实验：只复制 8 个前端及工具 workspace，不存在 `server/`，离线安装、类型检查和生产构建通过，锁文件未变。前端全量单测 522 个文件通过、3 个原有跳过，4,806 项通过、4 项原有跳过。后端及依赖的 12 个 workspace 测试任务全部通过，使用离线数据库和临时存储配置。

检查器初次复验发现一项稳定性问题：读取 83 个历史文件的完整源码测试在并发负载下耗时 7.2 秒，超过默认 5 秒。只将这一项设为 30 秒上限，全部完整内容断言保留。另一次将离线预加载参数带入边界扫描的尝试被检查器按设计拒绝，随后将纯边界扫描与离线运行测试分开执行，边界检查通过；未豁免环境规则。

复核日志使用 `review-` 前缀，独立前端安装证据位于 `review-frontend-isolation/`。此前通过的后端独立安装、部署控制及发布回滚演练仍适用于未改变的运行代码和部署脚本。本次复核不包含生产部署验收。

最终按 Actions 相同命令复验，verification-control 的 102 个文件、2,684 项全部通过（`review-controls-final.log`），另行执行的 node:test 9 项全部通过。边界检查、925 个外部锁条目一致性及 `git diff --check` 通过。复核范围内没有尚未解决的失败；原有跳过项、动态未知输入和生产环境验收限制仍保留。

## 发布前最后核对

已通过本地代理更新远端引用，`HEAD` 与 `origin/master` 均为 `92c0d7d6`，无领先或落后提交。边界检查再次通过；迁移、发布选择及版本指纹相关 6 个测试文件、81 项通过。当前发布计划为 full，后端先行，新 Node 目录全部纳入版本及发布范围。

按 Actions 的数据库兼容检查入口，在本机临时 PostgreSQL 18 上执行 schema-compatibility、history-schema、rds-cli-isolation、rds-assets-standalone、deploy-account-preservation，五阶段全部通过，报告确认 `sourceStable: true`、`localOnly: true`、`productionWrites: false`。未连接或迁移生产数据库。日志见 `prepush-database.log` 和 `output/database-compatibility/verdict.json`。

结论：本轮具备提交后推送到 master、交由 Actions 验证与部署的条件。发布前须完整提交新 Node 包与迁移检查文件；工作目录中原有无关文档改动应留在本地。本次仅做最后检查，未 commit、push 或触发部署，线上验收仍须在部署后执行。
