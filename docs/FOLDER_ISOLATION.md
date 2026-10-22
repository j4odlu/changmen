# 前端、后端、数据层与共享代码的文件夹隔离

> [changmen 扩展] **文档状态（2026-10-22）：历史迁移与验收记录。文中的旧目录、兼容入口、workspace 数量、未提交及未部署状态仅对应各自批次；当前布局见 [WORKSPACE_LAYOUT](./WORKSPACE_LAYOUT.md)，安装与发布见 [INDEPENDENT_DEPLOYMENT](./INDEPENDENT_DEPLOYMENT.md)**

[changmen 扩展] 2026-10-18，用户选择按四类代码的真实目录隔离推进。工作目录 `E:\River\arb\changmen`，基线 `master` / `42b07aab`。本批实际移动未冻结文件，保持包名、运行源码及旧 CLI 调用；不改变 551 固定基线、业务语义或发布范围。

## 目录规则与本批结果

| 类别 | 实际落点 | 当前状态 |
| --- | --- | --- |
| 前端 | `client/web`、`client/packages/`、`client/devtools/` | 本批公共簿包及前端维护工具迁入；历史客户端包和 Chrome 扩展仍有保留项 |
| 后端 | `server/backend`、`server/match`、`server/collectors` 等 | 原业务目录保持；Node loader/registry 受保护的实现仍在旧 adapter 目录 |
| 数据层 | `server/db`，含 `assets/` 与 `maintenance/` | 主实现及资产已归数据层；backend 旧 CLI/SQL 留作兼容 |
| 真正共享 | `packages/api-contract`、`packages/shared` 中的协议及纯逻辑 | 单一实现继续共享；两项 Node 工具后续已迁至 `devtools/runtime-tooling`，旧 shared 路径仅兼容 |

本批把 `packages/pm-market-data-browser` 完整迁到 `client/packages/pm-market-data-browser`，把 `devtools/venue-adapter/frontend` 迁到 `client/devtools/venue-adapter`，共 19 个文件。两个旧实现目录移除，没有用复制、junction 或空壳目录模拟隔离。三个旧 `packages/venue-adapter/scripts` CLI 只分派到新的真实工具文件，保留原 npm 命令。

所有簿运行源码和三个维护工具实现逐字保持；仅测试定位、README 链接及宿主元数据随目录更新。workspace 名 `@changmen/pm-market-data-browser` 和所有包公开导出保持，因此浏览器消费者继续按包名引用。根 workspace、两个宿主 `file:` 依赖、Vite 测试发现、源码/环境边界清单及 CODEOWNERS 模板使用新路径。

## 保护与精确证明

原 `pm-source-isolation-metadata`、frontend-install、frontend-build、node-consumer、backend-tool 五份证明 JSON 不改。新增 `pm-client-folder-metadata.json`，记录 19 个迁移文件的前后路径及 hash，并对五份宿主/策略元数据登记 16 处精确逆变换。新 lock 先完整恢复到上一批 backend-tool 的 hash，再沿原链恢复同一个 `a233e205` 全文；没有替换原历史版本或为目录整体放行。

lock 相对批前只改变六个 workspace/link 记录：根 workspaces、web 声明、adapter 声明、浏览器包旧/新记录及其 workspace 链接。所有外部依赖版本、来源、integrity 与记录保持。根离线安装只更新一个 workspace 链接，不执行生命周期脚本。

旧兼容契约的原 hash 保留。门禁只对完整命中本批 hash 的策略还原三条前端 CLI 的位置，再核对原兼容契约；其它入口及全部 SQL 资产不减项、不重定向。旧 Node loader、manifest、缓存、瘦包复制规则及资源根不改。Node 对新浏览器包的公开包名及计算得到的新物理路径均继续拒绝。

## 仍未完成的物理隔离

1. `packages/venue-adapter` 仍有浏览器和 Node 实现混放；loader/registry 的七个文件受原 551 项保护，其他平台及经典 FOK 源码也有大量受保护路径。不能把这一批 19 个文件的迁移表述为整个 adapter 已迁走。
2. `packages/client-core`、`packages/arb-core` 仍是前端实现的历史目录，分别有 25、11 个被源码归属库存识别的固定保护文件。后续搬迁必须同时设计旧路径兼容与真实运行实现的完整保护。
3. 根 `chrome-extension` 尚未迁移。迁移前须核对已加载扩展目录、构建根及打包输出，保持现有浏览器联调入口可用。
4. `packages/shared/tooling` 的两个 Node 实现及类型后续已迁至 `devtools/runtime-tooling`，原目录只保留 Node 兼容入口 workspace。`devtools/platform-probes` 仍含服务端探针，资源根与消费者待核对；不复制第二套 loader 或工具算法。
5. 数据层旧 SQL/CLI 兼容副本继续保留；只有全部旧消费者退役后才移除。

上述保留项使四类代码的物理隔离仍未全部完成。本批不启用精简安装、瘦包或独立发布 C–E，不拆仓，也不改变本机或生产服务的工作目录。

[第二批 Node 工具与冻结迁移方案](NODE_TOOLING_AND_FROZEN_MIGRATION_20261018.md)已补充 888 路径清单、工具新旧入口及安装验证；冻结包本轮只完成方案，未实际迁移。

## 验证

下表绑定文件夹迁移完成时的 334 路径候选。后续发现新目录未进入运行版本指纹，已补齐 Git 与无 Git 归档覆盖并完成本地提交，最新结果见[指纹补漏与提交收口](audits/FOLDER_ISOLATION_LOCAL_COMMITS_20261018.md)；旧清单和日志保留，不转作新输入的验收。

| 本轮检查 | 结果 |
| --- | --- |
| 新路径、兼容元数据及前端工具的完整回归 | 86 文件、2,479 项通过；包含新迁移/篡改拒绝测试和三个前端 CLI 的离线等价测试 |
| 前端完整回归 | 515 文件通过、3 文件跳过；4,701 项通过、3 项既有跳过，测试发现总量仍为 4,704 项 |
| 边界 | 0 未分类源码；六组保留边界、27 个环境入口、54 个动态目标、9 条来源绑定调用保持，PM 未解释输入为 0 |
| 固定 FOK | 实际执行等价检查通过，`check:fok-vps` 551/551；独立 Node 保护测试 9 项通过 |
| 后端 | 12 个无缓存任务通过，既有集成跳过项保留 |
| 前端类型和生产构建 | 强制类型检查通过，迁移后生产构建通过；只保留既有大 chunk 提示 |
| 原证明与资产 | 原五份元数据证明 JSON、551 manifest、六组保留契约逐字保持；本批无数据库结构或数据维护 |
| 文档及审查候选 | 8 份文档、62 个本地链接、22 条模板路径检查通过；334 个待提交路径重新分为 283 / 3 / 5 / 43 四组，补丁顺序应用后与完整候选树相等 |

首轮专项发现旧工具路径断言和前一批 lock 比较未先还原本次目录迁移；已更新定位与还原顺序，原断言及历史证明保留。首轮前端另发现三个测试文件的迁移定位遗漏：Worker URL 多一层 `client`、esbuild 元文件相对工作目录导致目录断言失败、宿主兼容测试仍使用旧相对 import。它们属于本批迁移错误，已改为正确路径和显式打包工作目录；没有调宽超时、删除断言或修改业务实现。Worker/宿主专项及完整回归随后通过，所有初始失败日志保留。

最终两套完整回归和最后构建对应同一稳定源码指纹。先前构建、失败的前端运行及不同证明版本分别保留，不能拿它们充作最终输入的验收。原 330 路径/四组补丁仅代表上一批候选；当前清单、逐文件原始 hash、Git 树、四份新补丁及结果位于 `output/client-folder-isolation-20261018/`。

本轮只完成第一批真实目录迁移与本机回归，未声称全部目录隔离、独立安装或生产发布已验收。后续正式提交仍由 Actions 对精确提交运行所需完整审计和数据库兼容检查；本轮没有运行完整 22 阶段、临时 PostgreSQL 演练或浏览器长稳测试。

上述文件夹迁移批次完成时尚未 commit。后续已连同指纹补漏及累计候选按四组建立本地提交；未 push、触发 Actions、部署或维护生产数据。原行情、默认经典 `legacy` FOK、HTTP 预检及本地簿/旁路默认关闭保持。
