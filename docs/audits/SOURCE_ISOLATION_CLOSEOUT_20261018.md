# 源码隔离候选收口（2026-10-18）

[changmen 扩展] **历史批次快照**：下文的 `abdfce46`、280 个路径及第 1、2 步结论仅代表当时输入。当前 HEAD、累计改动分组及第 3 步推进见[团队边界推进记录](TEAM_BOUNDARIES_PROGRESS_20261018.md)；不覆盖原机器证据或把旧验证结论转写为新候选通过。

[changmen 扩展] 本轮完成收口计划第 1、2 步：归档新增 Linux 实验、更新当前边界，并核对累计待提交清单。工作目录仍为 `E:\River\arb\changmen`；HEAD 为 `abdfce46d46f562c208ea0d832b6cafc02fd2360`。没有 commit/push、切换分支、触发 Actions、部署、重启本机服务或访问生产 RDS。

## 本轮实际修改

- 四个未跟踪、未接入发布的 Linux 实验脚本按原路径归档；每份副本与原文件 SHA-256 相等后才移出源码目录。原始安装/运行日志及失败报告保留，清理报告确认全部测试子进程退出、临时 PostgreSQL 关闭。
- 修改四份计划/边界文档，并新增本文；应用源码、package/lock、现有验证器、workflow、运输/激活脚本和默认开关均未修改。
- 当前代码输入指纹恢复到实验开始前的 `01facfeb812396e74426d5a18f600ac5cb3b6ac7fa96f1cb0c6df8d4dd081ccc`，实际 Git 暂存区保持不变。此指纹不含文档，不替代未来提交及制品身份。

归档目录：`output/source-isolation-closeout-20261018/archived-source/`。`archive-manifest.json` 记录以下四个原路径、大小和 SHA-256；恢复时逐文件核对，不能整批覆盖源码：

1. `scripts/testing/backend-linux-runtime.mjs`
2. `scripts/testing/backend-process-smoke.mjs`
3. `scripts/testing/backend-runtime-fixture.mjs`
4. `scripts/testing/backend-runtime-namespace.sh`

可选 Linux 实验并未完成八进程运行验收：临时 PredictFun 配置缺少 API key 导致超时。它不构成生产故障证据，也不是当前全量发布的阻断。前一批五个 Windows 安装清单/解析/测试工具保留；精简安装、瘦包和独立发布 C–E 暂缓，本地 WSL 不作为原全量部署前置条件。

## 累计候选范围

以下统计为相对 HEAD 的当前候选，包含之前各批次；不能理解为本轮新增这些业务文件。每个文件的状态、归属、用途和内容 SHA-256 在 `output/source-isolation-closeout-20261018/pending-files.json`，可读完整清单为同目录 `pending-files.md`。本轮只清点，不生成新提交分组或替换历史补丁。

<!-- inventory:start -->
共 **280 个路径**：101 个已跟踪文件修改、179 个新增文件、0 个已跟踪文件删除。

| 审查归属 | 文件数 |
| --- | --- |
| Actions 与发布验收 | 15 |
| 文档 | 32 |
| 依赖声明与锁 | 13 |
| 浏览器实现与兼容入口 | 54 |
| adapter 开发工具 | 9 |
| 共享逻辑与 Node 构建工具 | 13 |
| 边界与验证 | 53 |
| 暂缓的安装验证工具 | 5 |
| Node 消费者与兼容入口 | 21 |
| RDS 数据层与兼容入口 | 65 |

其中 32 份文档、44 个测试文件；其余包括源码、工具、配置及 SQL 资产副本，不能把总数当作业务模块数。
<!-- inventory:end -->

当前清单覆盖源码迁移与旧兼容入口、依赖声明/lock、RDS 资产副本、边界/精确迁移检查、PM 维护状态 v3 适配，以及已授权的 Actions 验收绑定和同次验证复用。后者确实修改了三个 workflow，不能沿用早期批次的“工作流未改”概括全部候选；生产安装命令、运输/激活、组件分类及后端先行规则仍保留。

旧 `output/frontend-build-isolation-20261017/commit-groups.json` 和两组补丁仅覆盖当时 238 个路径；后续新增的 Actions、工具与审计文件需进入下一步提交整理。历史补丁不用于直接提交当前候选。没有删除其它历史脚本或撤回之前已授权的源码隔离、检查与 Actions 改动。

## 已隔离与仍保留的边界

| 部件 | 已有本机证据 | 仍需保留或尚未启用 |
| --- | --- | --- |
| 前端 | 七个 workspace 的安装/类型/构建可在没有 server 目录时完成；浏览器簿实现及宿主装配有明确入口 | 后端仍提供九个历史静态资源 URL，契约继续核对；未启用新的独立发布选择规则 |
| 后端 | 生产消费者改用原位 Node loader/registry 入口，工具与运行依赖已有声明和边界检查 | 原冻结 loader/registry 与浏览器文件物理上仍在混合 adapter 包；生产继续完整 workspace 安装 |
| RDS | 维护实现与 43 个有效迁移、结构基线主资产归属数据层，可在没有 backend 时维护临时库 | backend 原资产与 CLI 留作兼容；不随应用发布执行结构或数据维护 |
| 真正共享 | 身份纯逻辑集中到 shared；构建辅助集中到 shared/tooling 并保持 Node 专属约束 | 纯共享与 Node 工具并不具有相同运行环境，不能把整个 shared 当作浏览器包 |

六组保留边界继续由原清单约束：冻结 adapter 岛、旧兼容入口、RDS 新旧资产、冻结 DB 访问、后端打包工具及布局根。保留冻结内容和原路径是兼容要求；当前不能宣称物理目录零混合或三个部件完全独立发布。

## 本轮核验及后续

- 归档副本逐文件校验通过，四个原脚本不再出现在 Git 候选中；没有包命令或工作流引用被移走的脚本。
- 源码指纹与 Linux 实验开始前完全一致；本轮除归档四个文件外，只改文档，原 package/lock、业务代码、工作流与保护清单没有新差异。全清单未发现新增凭据、临时日志或构建产物；忽略的 output 证据不入候选。
- 原 `check:boundaries` 入口通过：0 未分类源码，六组保留边界保持，PM 来源绑定与未知调用回退检查保持。
- 原 `check:fok-vps` 所调用的 `verify-vps-fok-baseline.mjs` 通过：551/551，固定历史提交、manifest/hash 保持，内部实际执行 FOK 等价、共享链路与 GTC 隔离检查。
- 不重复应用构建、干净安装、数据库演练或浏览器长稳验证。此前完整审计只代表各自的输入，不能转写为本轮新执行的 CI 通过；当前代码与安装清单批次指纹一致，文档变化另有清单记录。

**第 1、2 步完成；尚未执行第 3 步提交分组整理或第 4 步发布。** 下一步核对分组依赖及最终候选，按实际调整复验；获授权后才能 commit/push，并由 Actions 对精确提交验收。master 的 push 会触发生产发布。原行情、默认经典 `legacy` FOK 和 HTTP 预检保持，本地簿及旁路默认关闭，生产旁路仍未放行。

本轮机器结果、归档 manifest、清单和核验日志均在 `output/source-isolation-closeout-20261018/`，不入 Git。
