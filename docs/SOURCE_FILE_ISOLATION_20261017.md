# 源码文件隔离：前端、后端、RDS 与真正共享

> [changmen 扩展] **文档状态（2026-10-22）：历史迁移与验收记录。文中的旧目录、兼容入口、workspace 数量、未提交及未部署状态仅对应各自批次；当前布局见 [WORKSPACE_LAYOUT](./WORKSPACE_LAYOUT.md)，安装与发布见 [INDEPENDENT_DEPLOYMENT](./INDEPENDENT_DEPLOYMENT.md)**

[changmen 扩展] 2026-10-18 收口：本文历史批次与原证据保留；当前精简安装、瘦包及进一步独立发布暂缓，新增 Linux 实验脚本已归档。继续沿用全量安装与发布范围；本地 WSL 不作为部署要求。当前源码/构建独立成果、仍需保留的冻结混合目录与兼容入口，以及累计待提交清单见[候选收口记录](audits/SOURCE_ISOLATION_CLOSEOUT_20261018.md)。

[changmen 扩展] 2026-10-17，工作目录 `E:\River\arb\changmen`，提交基线 `abdfce46d46f562c208ea0d832b6cafc02fd2360`。本批在已有未提交改动上实施源码归属迁移，不修改实际发布规则；未 commit/push、未部署，不访问或维护生产 RDS。

本文按批次保留历史结果；当前 RDS 资产归属以后文“RDS 维护资产独立”一节为准：主文件已在数据层，backend 原资产只作兼容副本。

当前前端安装/构建状态以“前端构建源码隔离”为准：9 个 workspace 的旧安装结果保留为历史证据，现已降为 7 个，并可脱离 server 目录构建；实际发布边界尚未启用。

后续“前端构建源码隔离”已进一步解除 Vite 对 server 目录的源码/资源读取依赖，七包临时安装配置可在完全没有 `server/` 的目录构建；实际组件安装/发布规则尚未启用，冻结目录与兼容入口仍保留。

## 后续批次：后端工具与 registry 开发声明收口（2026-10-18）

[changmen 扩展] 本批回到前后端分离，matcher 检查发现仅记录，未修算法、game 字段或三个 scraper 的既有语法错误。业务源码、原 loader/registry 冻结文件、实际发布规则保持。

- backend 的开发依赖从整个 `@changmen/venue-adapter` 换成已有 `@changmen/venue-node`。布局验证脚本通过该包的公开导出调用原函数；`sync:platform-adapter` 也改用该工具 workspace，仍先同步 adapter、再同步 probes。原 `test:adapter` 命令保留。
- tools 仅增加指向原文件的 `sync:backend-bundle` npm 命令。同步实现全文、复制清单、源根选择、目标根和默认行为均未改；没有移动或复制第二套打包算法。
- 去掉 Node registry 的 `api-contract` / `client-core` 开发声明：它们只用于相邻浏览器 TS，浏览器父 adapter 已直接声明这两个宿主。本批没有修改父 adapter 的声明或冻结浏览器文件；Node registry 的 exports/files/运行依赖不变。
- 持续门禁增加 backend 开发工具闭包、布局验证消费者与命令顺序检查，拒绝整个 adapter/浏览器包回流及绕过工具包的源码深导入；同时要求浏览器父 adapter 保留类型宿主，拒绝在 Node registry 重新登记这组开发宿主。旧动态未知回退和发布保守处理保持。
- lock 只变更 **`server/backend` 与 `packages/venue-adapter/registry` 两个 workspace 记录**，外部包记录零变更。新 `pm-backend-tool-metadata.json` 追加 2 处精确逆变换；前四份 17 + 8 + 2 + 1 处证明 JSON 逐字保留，仍最终恢复同一 `a233e205` 完整历史源码，不豁免 lock 或替换固定基线。

### 本批验证

| 检查 | 结果 |
| --- | --- |
| 原根配置的后端干净安装 | 完整根 package.json/workspaces 与 lock 不做临时裁剪，npm 11 离线 ignore-scripts，单选 backend、包含 backend 开发依赖；安装 393 包、15 个 Node workspace，未链接父 adapter/client-core/浏览器簿，Vue/Pinia 与实际 client-core 导出子路径均 MODULE_NOT_FOUND |
| 原生 Node/打包布局 | 工具包入口与原文件为同一模块；原布局验证脚本通过，网络请求尝试 0；backend 手动同步命令按原 adapter→probes 顺序运行，仅在隔离目录操作 |
| Node SDK 实际解析 | 10 个 SDK/网络库的 Node ESM + CJS 共 20 项解析相对路径及文件 hash 与当前工作目录一致，零漂移；未执行平台请求 |
| 前端宿主验证 | 无 server 目录的七包临时配置安装 470 包，vue-tsc 类型检查通过，原 19 项 Vite 浏览器解析零漂移；安装不改 lock，前端类型宿主不依赖 Node registry 的开发声明 |
| 瘦包内容契约 | 原函数以批前/批后两份元数据分别生成，均 48 文件、清单完全相同；仅 `registry/package.json` 和 `scripts/package.json` 内容发生本批已说明的变化，其余文件逐字一致；未改变复制算法、白名单或默认目标 |
| 专项与兼容 | 依赖/元数据 7 文件 120 项通过；原输入、来源绑定、保留边界、构建输入与 facade 兼容 5 文件 141 项通过，集合不重复相加为全量业务测试 |
| 固定保护与边界 | 551/551、实际 FOK 等价/共享边界/GTC 隔离及 check:boundaries 通过；PM 仍 932 个有界文件、9 条来源绑定调用、54 个动态目标和 0 个未解释输入；前端/后端生产/RDS 声明闭包仍 7/14/3，后端含开发工具闭包为 15 |

初次后端安装仍被 registry 的开发声明带入一个 client-core 链接。初稿只探测包根，误把无根导出的 `ERR_PACKAGE_PATH_NOT_EXPORTED` 当作未安装；已明确作废该独立安装结论，保存 `initial-install-correction.json` 和实际子路径能解析的证据。最终验收同时核对全部 workspace 链接、实际子路径及 MODULE_NOT_FOUND；去掉 Node registry 的重复宿主后重新干净安装通过，不将旧假阳性记录当作最终结果。

新元数据负向用例首轮错误地修改 lock 中并不存在的 exports，已改为篡改真实依赖记录，最终 120 项通过；初次 CLI 检查误认 probes 的日志标签，按原实现实际标签更正后通过。原始日志保留，未改原业务测试断言、超时、同步输出或实现来消除失败。

**剩余边界**：7 个冻结 browser/Node 文件仍在原目录；工具仍需读取该目录的原资源根，瘦包仍按旧规则含相邻共享/兼容资产。本批证明的是宿主依赖及工具消费隔离，不是裸工具包可在任意目录自行打包，也不是全部源码已搬离混合目录。实际 Actions 安装/发布仍用原规则，C–E 尚未启用；前端运行时的后端 HTTP 静态资源契约仍保留。

没有重做应用生产构建、全量前后端业务测试或浏览器长测；本批改动为包声明、开发命令、工具消费者和验证门禁，已做对应干净安装、类型、实际解析、打包及固定回归。未操作本机/生产服务进程、访问生产 RDS、commit/push 或部署；原行情、经典 legacy FOK、实际 HTTP 预检、本地簿/旁路默认关闭保持。证据在 `output/backend-tool-isolation-20261018/`，旧提交补丁与上线验收不代表本批候选。

## 后续批次：resolver 消费者与 Node 依赖收口（2026-10-17）

[changmen 扩展] OB、PB、Ray 三个辅助 scraper 的导入从父 adapter 旧 loader 子路径改为 `@changmen/venue-node`。OB/Ray 保持函数内动态 import，PB 保持顶层静态 import；其它代码经逆替换与本批前完整文件逐字一致。三个文件不在原 551 或电竞冻结清单内。本批没有执行 scraper、抓平台或读写生产 RDS。

resolver 的唯一开发 workspace 依赖由整个 adapter 换成原 Node loader；生产依赖不变，生产闭包仍为 5 个 workspace、没有 loader。工具声明闭包为 8 个 workspace，含原 loader/registry/probes，不带父 adapter、client-core、浏览器簿、Vue 或 Pinia。工具仍依赖 Node 宿主和现有根目录规则，不将该闭包自动认定为可独立运行的 scraper 发行包。

原 `venue-node-dependencies` 门禁同时检查这 3 个源码消费者的入口与静态/动态类型、resolver 各依赖组及工具根的生产传递依赖；拒绝旧父包入口、相对源码旁路、Node 深路径、opaque 替代、混合回退及浏览器宿主回流。其它历史脚本没有纳入本批治理，原动态未知处理保留。前端/后端反向运行依赖约束仍由原图门禁负责。

lock 只替换 `server/match/resolver` 记录中的一条开发依赖，未增删包记录、未改变任何外部包。追加 `pm-node-consumer-metadata.json` 的 **1 处精确逆变换**，先恢复上一批完整 lock，再沿原 17 + 8 + 2 处逆变换恢复同一历史基线。原三份证明 JSON、551 manifest/hash 和实际发布控制不变。

### 本批验证与限制

| 检查 | 结果 |
| --- | --- |
| 依赖/来源/loader/resolver 回归 | 9 文件，195 项通过、1 项既有 expected-fail；涵盖元数据全文恢复/篡改拒绝、PM 来源绑定、原 adapter facade 和 resolver 离线行为 |
| 固定保护与边界 | 原 551/551、FOK 等价/共用链路/GTC 隔离、源码和安装边界全部通过；PM 仍 932 个有界文件、9 条来源绑定调用和 0 条未解释输入 |
| 无浏览器的 Node 安装 | 临时配置只登记既有 14 个后端 workspace，npm 11 离线 omit-dev/ignore-scripts 安装 349 包；不复制父 adapter package.json 或浏览器 registry TS，Vue/Pinia/父 adapter/client-core/浏览器簿不能解析，lock 不被改写 |
| 原生 Node 兼容 | 从 resolver 目录解析到原 loader 文件；新入口与原文件是同一模块，registry/缓存身份不变；17 项 manifest、OB/PB/Ray session 和 resolver 导出加载通过，fetch/TCP 阻断且请求尝试 0 |
| scraper 命令 | 三个脚本在本批前就存在语法错误，修改前后 `node --check` 的退出码、首个报错位置与错误一致。仅完成依赖入口收口，**不宣称 scraper CLI 已可运行**；既有错误另行修复 |

安装 fixture 的首轮原生检查把 Windows 的反斜线路径与 POSIX 字符串比较而失败；改为比较两侧真实绝对路径后，复用同一干净安装通过，原日志保留，未改 loader/放宽模块身份断言。该实验仍是后端宿主安装验证，不是 8 包工具闭包的独立执行认证；原统一安装/发布规则保持。

**剩余边界**：7 个冻结 browser/Node 文件仍在原 adapter 物理目录；旧 loader 导出继续兼容，backend 开发期打包/验证仍声明整个 adapter。registry manifest 保持单一原来源，没有复制第二套 loader、缓存或清单实现。未改经典 `legacy` FOK、行情、HTTP 实际预检及本地簿/旁路默认关闭；未 commit/push 或部署。

证据：`output/node-consumer-isolation-20261017/`。上一批两组提交审查补丁仅代表旧候选，本批没有更新或使用它们作为新候选的提交/发布证明。

## 后续批次：前端构建源码隔离（2026-10-17）

[changmen 扩展] 本批只收口正在使用的 Vite 配置、插件和四个 predev/prebuild/build 脚本，不扩大到其它历史脚本，不修改实际发布流程。

- `packages/shared/tooling/runtime_version.js` 成为来源身份识别的唯一实现，完整 JS 与类型声明逐字迁入；原 storage 路径只转导出。**原来源筛选、全部 packages、旧 `server/storage/runtime_version.js` 路径、Git/archive 判定、EOL/binary 处理和 dirty 规则全部保持**，不通过缩小指纹覆盖取得独立构建。
- `packages/shared/tooling/dev_web_port.js` 成为端口解析的唯一实现，原函数逐字迁入；Vite 和 `readDevWebPort` 引用同一函数。后端 dotenv 文件读取、优先级和错误处理完整还原后一致，旧公开入口及类型兼容。
- Vite 从自己的配置目录取得明确 workspace 根和原 adapter 相对位置，不再导入会创建 storage 目录的后端路径模块。`shared/tooling/` 明确为 Node-only，浏览器/扩展运行图引用会被边界检查拒绝；它不进入浏览器运行 barrel。
- `/esport2/assets/` 的 9 个现有前端引用登记到 `client/web/vite/legacyPublicAssets.json`。构建只核对契约并保留原外部 URL；仓库门禁另核对每个后端原文件的存在性和完整 hash，拒绝缺失、漂移、未登记及越界 URL。资源字节、backend 静态服务与缓存规则、前端 CSS 均未改。静态资源仍是运行时 HTTP 契约，C/D 放行前还需实际前后端版本组合的证据。
- 活跃构建入口纳入原源码归属检查，拒绝前端构建代码重新引用 backend/RDS 私有实现。没有重标注整个历史脚本目录。storage 为原兼容入口补充已有 shared 包的直接声明，前端七包、RDS 三包闭包均未增加 workspace。
- 新增第三阶段两处精确元数据逆变换（shared 导出、storage 的 local lock 依赖）；上一批 17 处和后续 8 处证明逐字保留，最终仍恢复同一历史基线。外部依赖锁记录本批零变化。

### 本批验证

| 检查 | 结果 |
| --- | --- |
| 无 server 的前端安装/构建 | 临时根只登记原 7 个前端 workspace，完全不复制 `server/`；离线安装 470 包，类型检查与生产构建通过；构建后仍没有 server/backend/storage 占位目录，未激活生产安装 profile |
| 独立解析/插件 | 原 19 项 Vite 解析零漂移；隔离目录 2 个插件文件、9 项测试通过；新增资源插件测试进入前端正式测试清单 |
| 前端全量 | 515 个文件、4,537 项测试通过，包含新增/纳入的 9 项插件测试；3 个既有文件/测试跳过保持 |
| 后端与来源兼容 | 12 个任务成功、0 缓存；原 dev_web_port 真实环境文件优先级检查通过，来源/插件相关 22 项通过；原生 Node 确认旧新导出函数引用相同 |
| RDS 独立加载 | 不含 backend 的 db/shared/storage 三包安装仍为 18 包；新旧来源/端口函数同一引用，维护模块加载通过，阻断浏览器模块、fetch/TCP，未连接数据库 |
| 固定保护/边界 | 551/551、实际 FOK 等价、共享边界、GTC 隔离、adapter 四项与新旧源码边界通过；原 551 路径/内容、原行情/经典 FOK 和缺省配置不变 |
| 验证工具 | 全量 74 文件中 2,232 项通过、1 项旧扫描数断言失败；证实新增文件后仅修正该库存断言，原完整 PM loader 文件 73 项复验通过；原失败保留。相关迁移专项 117 项通过，集合有重叠 |
| 发布控制 | 原发布控制检查及临时 shell 产物/回滚场景通过，仅操作本地 fixture；实际 workflow、分类、封存及发布脚本不变 |
| Worker/资源 | PM Worker 24,149 字节、完整内容与上批一致；9 个原后端资源文件逐字节不变；无真实浏览器长稳/下单测试 |

扫描清单已单独对照迁移前实现：PM 有界图由 **931 增至 932**，只新增 `packages/shared/tooling/dev_web_port.js`，旧 `server/storage/dev_web_config.js` 仍在，零文件移除，9 条来源绑定调用不变。测试新增对两处文件的明确覆盖，未改原 551 或 loader 规则。全仓未知输入从 165 增至 185，是本批显式纳入构建工具的输入；PM 未解释输入仍为 0，共享 20 条、原 8 个 loader 来源及 9 条绑定调用继续检查，不授予缩小发布范围资格。

初始新增测试把 ESM 转导出的 namespace 对象与原模块比较，已改为核对全部导出函数的实际引用；两个负向检查原先重复扫描完整仓库而超过 5 秒，改用保留相同边界断言的小型隔离仓库，未延长阈值。插件测试原不在前端 include 内，已正式纳入；独立构建的原始日志和这些初始记录均保留。扫描数修正前曾误认新增为来源身份模块，后以完整清单定位为端口解析器并修正，不把错误覆盖断言放行。

**当前源码/构建结论：前端已无需 server 目录即可安装、类型检查和构建；服务端旧入口与 RDS 独立维护兼容。** 临时前端 fixture 没有 Git 身份，产物 commit 明确为 unknown，不是可发布包。源码布局中的冻结 Node 岛、旧兼容入口和后端 HTTP 资源契约仍保留；实际组件安装 profile、C–E 发布选择/证据/远端规则及验证去重尚未启用。

证据在 `output/frontend-build-isolation-20261017/`。未 commit/push、未部署、未重启开发/生产服务或写生产数据库；累计候选仍按原全量、后端先行规则进入后续 GitHub Actions 精确提交验收。本地簿/旁路继续默认关闭，实际预检保持 HTTP。

## 后续批次：浏览器安装声明收口（2026-10-17）

[changmen 扩展] 本批已解除 `web → venue-adapter → DB/storage` 的包级安装耦合。原业务源码、原 551 路径/内容、loader、registry、打包工具实现及发布控制均未修改。

- adapter 移除没有源码消费者的 DB 声明，以及仅用于 Node 的 storage 声明。既有 Node loader/registry workspace 继续直接声明自己的 storage 需求，原 loader 导出保留。
- 在原 `packages/venue-adapter/scripts/` 增加 `package.json`，由 `@changmen/venue-node` 声明打包工具直接使用的 storage。脚本原文件、函数、npm 命令、复制算法/白名单/目标保持不变；按原复制规则，临时瘦包中自然增加 `scripts/package.json`。四个前端/验证兼容命令仍需完整 monorepo，不将整个 scripts 目录认证为可独立发布的工具。
- Web 显式声明构建使用的 `dotenv` 17.4.2。该依赖原由 storage 间接提供，干净安装暴露遗漏；没有恢复 storage 包，也未改变端口解析规则。
- Web 的 SocketCluster 声明从 `^19.2.0` 对齐到原 Vite 根别名实际使用的 `20.0.1`。Vite 别名和行情代码不变；原根目录 20.0.1 的锁记录及实际解析内容 hash 一致，仅移除原别名不使用的 `client/web/node_modules/socketcluster-client` 19.2.7 锁记录。其余外部依赖锁记录全部不变，不能把这项声明对齐描述成实际浏览器 SDK 升级。
- 原安装输入门禁增加前端到 server/devtools/Node loader/registry/tools workspace 的拒绝；拒绝把 Node/data 依赖放回 adapter 的运行、开发、optional 或 peer 声明，也核对打包工具的原位导出和直接依赖。
- 追加 `pm-frontend-install-metadata.json` 的 8 处精确 lock 逆变换，先恢复上一批已登记 lock，再沿原 17 处变换恢复 `a233e205` 完整历史源码。上一批记录不改，固定 551 manifest/hash 不改，没有整文件或目录豁免。

### 本批实际验证

| 项目 | 结果 |
| --- | --- |
| 前端干净安装 | npm 11 离线、ignore-scripts；470 包，7 个 workspace：web、arb-core、api-contract、client-core、shared、venue-adapter、pm-market-data-browser；DB/storage/Node loader/registry/tools 均未安装 |
| 干净前端构建 | 完整 `npm run build --workspace=@changmen/web` 通过，包含 vue-tsc 和生产 Vite 构建；未借回整个后端依赖闭包 |
| 浏览器/双端解析 | 原 19 项 Vite、35 项 Node/Vite 解析零漂移；另核对 SocketCluster 原别名及 Vue 宿主，实际文件/hash 一致 |
| 干净全量安装与 Node | 849 包；新旧 loader 模块、打包工具模块及 RDS CLI 身份相同；禁止浏览器模块、fetch/TCP 后加载和临时打包检查通过；无平台或数据库请求 |
| RDS 定向干净安装 | 18 包，只安装 db/shared/storage，原 lock 不被安装改写；本批未重跑 PostgreSQL 维护场景，维护源码和 SQL 均未变 |
| 后端 | 12 个任务成功，0 缓存；原实际打包布局测试通过 |
| 前端行为 | 513 个文件、4,528 项测试通过；3 个既有文件/测试跳过保持 |
| 固定保护及专项 | 完整 551/551、实际 FOK 等价、共享边界、GTC 隔离、adapter 四项检查、最终依赖边界通过；551 与本批开始时逐字节一致 |
| 验证工具 | 最终源码上的完整组 2,214 通过、1 项历史包检查超出原 5 秒；空闲后原阈值单独复验该文件 9 项全部通过；最终相关专项 100 项通过，有重叠不相加 |
| 来源与发布 | 2,423 个既有应用 JS/TS/Vue 文件无变化；8 个实际发布控制文件逐字节不变；原 PM Worker 24,149 字节、全文 hash 不变；实际发布优化继续关闭 |

初始配置加载缺少 dotenv、干净构建缺少根 SocketCluster 别名的记录保留。补齐实际依赖后重新安装/构建通过，没有修改行情算法、原验收断言或延长超时。安装解析证据的首次汇总误把同一 HMAC 的 Node/browser 记录合并，修正证据键包含环境后，对同一干净安装继续读取全部 35 项并通过；没有删除比较条目。历史包组的完整运行超时与单独复验分别保留，未把原失败日志改写为全绿。不同构建目录/配置的全部产物不宣称逐字节等同，实际产物仍须由精确提交 CI 验收封存。

### 仍未完成的分离

1. Vite 配置仍直接读取 `server/storage/{dev_web_config,paths,runtime_version}.js`，构建插件还核对 backend 静态资源；前端包安装已不带 DB/storage，**构建源码输入仍依赖现有仓库布局**。这些真正共享的构建/布局能力及静态资源归属需要下一批专门收口，不能靠重新引入 storage 隐藏。
2. 冻结混合目录和旧兼容入口仍保留。原 Node 入口要求相应 Node workspace/宿主；本批不是任意平铺 npm 包布局认证。
3. 后端生产实际安装仍使用现有统一 workspace/完整源码布局；此前临时安装 profile 尚未接入生产。C–E 的组件计划、证据、工作流与远端规则一致性及验证去重仍未实施，本批不缩小发布范围。

证据：`output/frontend-install-isolation-20261017/result.json` 及同目录日志、安装目录、逐项解析和原始失败记录。本批未 commit/push、未部署、未重启服务或写生产数据库。经典 `legacy` FOK、实际 HTTP 预检及本地簿/旁路缺省关闭保持原状；上一批提交补丁与就绪证据需按新候选更新，不能直接复用为发布批准。

## 本批实际迁移

| 归属 | 实现位置 | 本批处理 |
| --- | --- | --- |
| 前端 | `packages/venue-adapter/browser/pm-book-diagnostics/` | 原 wsBook 的 9 个实现迁入：HTTP 旁路、模拟计算、新鲜度、诊断 Worker 协议/客户端及观察插槽；旧文件只有转导出 |
| 前端 | `packages/venue-adapter/browser/pm-book-source.ts` | 只读原行情 source 实现迁入；原 `polymarket/orderBookSource` 保留对象身份一致的兼容入口 |
| 后端 | `server/backend`、`server/match/resolver`、`server/match/matcher` 等 | 保持服务端职责；Node loader/registry 的冻结实现不搬动，不把 resolver 归入 shared |
| RDS 数据层 | `rds/maintenance/` | 迁入 schema 检查、迁移 runner、结构统一和持久备份 4 个实现，增加明确的 db 包导出；原 backend 路径仅转导出 |
| RDS 数据层 | `rds/runtime_schema.js` | 从 backend 的运行版本诊断抽出原 schema SQL、指纹、60 秒缓存、请求合并、超时与失败处理；backend 只组合来源身份和数据层结果 |
| 真正共享 | `packages/shared/match-identity/` | 原 identity 的 8 个 JS 实现逐字迁入。旧 `server/match/identity` 路径保留转导出；RDS team_store 直接依赖 shared，db 补齐直接依赖声明 |

共迁移 **22 个完整实现文件，另抽出 1 个数据层观察实现**。13 个完整文件逐字一致，另外 9 个仅调整模块或资源路径；原 schema SQL 和缓存函数体逐字一致。公共身份规则不导入 DB、网络或应用实现；原 team plugin 仍由宿主注入，旧、新入口共享同一状态。

前端迁移是在 adapter 中建立明确的 browser 子树，不是把整个 adapter 包认证为纯前端。簿核心继续在 `packages/pm-market-data-browser`；诊断直接引用其公开核心入口，原行情与经典 FOK 的实现留在原处。原 HTTP 观察调用不改，旧、新观察插槽使用同一注册状态；未新建订阅、Worker 或预检决策。

## 持续分类与依赖约束

`scripts/verification/source-ownership-inputs.json` 登记四类源码归属，`source-ownership.mjs` 输出逐文件清单；接入原 `check:boundaries` 和同一套源码解析，不另建一套依赖解析器。

- frontend 不得依赖 backend / RDS；backend 和 RDS 不得依赖 frontend。
- shared 不得依赖任何一端的专属实现；arb-core 因仍使用 client-core 类型，当前归 frontend，没有仅凭“纯计算”名称将其列作 shared。
- RDS 不得导入 backend 业务实现；允许依赖明确登记的 `server/storage` Node 基础设施。
- 通过 import、类型导入、re-export 和已解析的字面量路径检查真实边。原动态 loader 的来源绑定、别名、namespace 和未知回退继续有效，搬到 browser 的目标也禁止 Node 自定义加载。
- 22 个旧源码入口必须维持纯转导出，防止兼容位置重新长出第二套实现；旧 JSON 兼容资产必须与 canonical 文件逐字相同。
- 新包的未分类源码拒绝通过；未知动态路径仍保留原保守处理，分类清单不授予安装或发布豁免。

backend 运行版本诊断的 2 个历史数据库访问例外已删除，并列入不可重新登记例外的已迁移文件。剩余只有冻结 `admin_maintenance.js` 的 8 个历史位置。原边界、551 固定基线和所有恢复器均未削弱。

逐文件库存包含测试、工具及 SQL，并标记角色和是否属于 551；该标记不是所有冻结面的全集。原行情、经典 FOK 的 relocated 实现及订单冻结也必须继续保持，不能把 `protected551:false` 当成迁移许可。范围为 web/src、扩展/src、packages、server、platform-probes；未修改其它历史脚本。

## 验证

| 检查 | 本批结果 |
| --- | --- |
| 551 原路径/原内容保护 | FOK 等价、`check:fok-vps` 原 551/551 通过；另与本批开始时工作树逐字比较，551 文件无一改动 |
| 原行情 / 经典 FOK | 40 个相关实现及缺省设置与本批开始时逐字相同；既有保护行为检查通过 |
| 浏览器相关专项 | 预检与生命周期 264 通过、2 个既有跳过；行情 / Worker 187 通过；新增旧/新观察插槽和只读源兼容 2 项通过 |
| 构建 | 一次 app:build 通过，包含 vue-tsc；仍只有 `pmMarketData.worker-6o1jiZ-N.js`，24,149 字节，与 B 批名称和大小一致 |
| 后端 | 最终 12 个任务成功，其中 3 个缓存命中；公共身份旧/新函数身份及插件共享测试通过 |
| 验证工具 | 6 文件 211 项通过；收尾诊断/边界 47 项、最终源码归属 12 项通过，集合有重叠，不相加 |
| RDS 维护与兼容 | 相关离线单测通过；隔离 PostgreSQL 的升级/代码回退 17 项和标准结构/备份恢复 16 项通过，未连接生产库 |
| 干净安装 | npm 11 离线、ignore-scripts，849 包；35 项解析中 34 项完全一致，1 项仅预期的旧 source 入口 hash 改为转导出内容；全部外部依赖解析无漂移，Vue 宿主一致 |
| Node 隔离加载 | 干净目录禁止浏览器模块解析，loader、四馆 session、resolver、RDS 兼容入口及 shared identity 加载通过；函数与插件身份一致，未发送现场请求 |
| 发布规则 | 8 个相关控制文件与本批开始时逐字相同；`publishScopeOptimizationEnabled:false`，本批不是上线验收 |

首轮发现并修正了迁移后的两个 SQL 模板资源路径；初次浏览器命令因 cwd 不匹配没有找到测试，改用 web 工作目录执行。初始日志保留，没有调整断言、SQL checksum、基线或超时以消除失败。

证据在忽略目录 `output/source-isolation-20261017/`：逐文件归属、迁移前 hash、迁移等价、原保护文件、测试日志、干净安装与 Node 隔离加载结果。

## 尚未完全隔离的内容

1. **冻结 Node 源码仍在 adapter 原路径**：`loader/adapter_paths.mjs`、registry 的 paths/feeds，以及相邻冻结的浏览器 registry 文件；仍是混合物理目录。551 文件不得为搬目录改变原路径或内容。
2. **旧兼容入口仍在原目录**：22 个源码文件只转导出，不再拥有实现。旧 `team_aliases.json` 公开路径保留一份逐字兼容资产；运行实现读取 shared canonical 文件，门禁拒绝两份资产不一致。
3. **RDS 的旧 CLI 与资产兼容路径仍保留**：主实现位于 `rds/maintenance`，SQL/结构基线主文件已归入 `rds/assets`；backend 原命令只转导出或分派，原资产是逐字兼容副本。维护代码不再读取 backend 资产；其它历史运维/回填脚本与固定旧消费者未迁移，兼容副本暂不能删除。
4. **订单冻结诊断仍有直接 SQL**：`admin_maintenance.js` 受 orders-phase2 固定保护，保留 8 个精确位置；运行版本诊断已不再直接操作连接池或 SQL。
5. **原 PM-M、经典 FOK 及其语义保护实现保留**：不为目录外观改动它们；browser 诊断仍复用这些原浏览器计算辅助函数。
6. **包级安装与 Node 工具尚未物理拆净**：adapter 仍同时含 browser、冻结 Node 和后端瘦包同步实现；另外 4 个检查/维护工具已迁至 `devtools/venue-adapter`，原命令留下薄入口。统一 workspace/lock 的安装耦合仍在，不能把源码子树隔离等同于整个包独立安装。真实共享 SDK 继续由两端各自声明。

本地簿及对照继续默认关闭，实际预检保持 HTTP。未补做长时间浏览器运行或恢复/性能验证，本批只交付源码隔离及其兼容证据。

## 后续第 1 批：工具与 RDS 命令收尾（2026-10-17）

[changmen 扩展] 在上述未提交工作树上继续迁出 **7 个实现**，只改变源码/资源根定位及初始化 CLI 函数的显式导出，没有修改维护算法、SQL、checksum、连接超时、错误提示或退出规则。

| 归属 | 新实现 | 旧入口 |
| --- | --- | --- |
| 前端维护工具（Node 执行） | `devtools/venue-adapter/frontend/{list-web-venue-imports,relativize-internal-imports,sync-package-exports}.mjs` | adapter 原 scripts 文件仅导入工具；npm 命令不变 |
| 跨端验证工具（Node 执行，非共享运行库） | `devtools/venue-adapter/verification/check-esport-freeze.mjs` | 原冻结检查命令仅导入工具；原 manifest、精确恢复器、默认拒绝及参数保持 |
| RDS 数据维护 | `rds/maintenance/{check-rds-schema,apply-rds-schema,apply-order-observation-schema}.mjs` | backend 原路径只转导出或按原直接执行判定分派 CLI；导入不加载环境或连接数据库 |

**保留后端打包工具原位**：`packages/venue-adapter/scripts/sync-backend-bundle.mjs` 与本批开始时逐字相同，仍明确归 backend/tooling。其 `scripts/` 原样复制约定和包内源目录定位属于瘦包内容契约；直接搬到包外将使复制后的命令依赖包外实现。本批不改变复制白名单、目标目录或发布规则，因而没有强搬此项。原 scripts 中的开发/验证命令仍需完整 monorepo，不认证为独立瘦包维护工具。

新增工具目录按 frontend/shared + tooling 分类，并作为精确指定的工具种子接入同一依赖解析器，不扩大到其它历史脚本。6 个 CLI 薄入口由固定模板检查；观察表入口纳入纯转导出检查。防止旧命令重新长出逻辑，也防止前端维护工具导入后端业务。

扩大到这组工具可达的既有验证依赖后，通用库存的未知记录从 168 变为 **169**：新增显示的是 `pm-stored-market-refresh-boundary.mjs` 已存在的动态 helper 资源 URL，不是新 loader 或运行时调用。记录保留，不予豁免；PM 专项仍为 54 处动态目标、9 处来源绑定调用、931 个有界文件、20 条共享记录和 0 条未解释 PM 输入。

验证结果：

- 7 个完整实现经逆向还原根路径/CLI 导出后全文一致；旧、新 RDS 导出对象/函数身份相同。
- 前端工具用隔离小仓库验证旧/新命令输出、不同 cwd、非法深导入、exports 漂移和改写范围；没有在真实源码执行写入型维护命令。
- 工具/入口/冻结/边界组合 254 项通过；随后补充“只扫描明确工具目录、拒绝工具跨端依赖”的负向用例并运行组件边界组，集合有重叠，不相加。原 RDS 等相关离线组 51 项通过。
- 临时本机 PostgreSQL：既有升级/旧新代码兼容 **17 项**通过；新增真实新旧 CLI **6 组**通过，包含默认只读拒绝空库、显式初始化、既有库拒绝重放、迁移账本不变、不同 cwd。未读取生产配置或操作生产 RDS。
- `check:fok-vps` 完整 **551/551**通过，包含实际执行 FOK 等价、共享边界和 GTC 隔离；本批前后的 551 个文件原路径/原内容逐字一致。浏览器 PM 与 web 源文件、本地簿缺省配置、根依赖/lock 和实际发布控制未改。
- adapter 四项检查与边界检查通过。本批未改浏览器运行/构建链，不重复构建或长时间行情测试；未重启本机开发服务。

初轮新增入口身份测试在 Vitest 加载 CLI 时出现语法错误；原生 Node 的语法检查和导入通过，最终用实际执行这些 CLI 的原生 Node 子进程检查同一组身份断言。首轮记录保留，没有放宽断言、延长超时或跳过失败。

证据：`output/source-tooling-isolation-20261017/`。当前累计是 **29 个完整实现迁移 + 1 个数据层观察实现抽出**，23 个纯转导出兼容入口、6 个 CLI 兼容入口及 1 个 JSON 兼容资产。冻结混合目录、后端打包工具、SQL/结构基线资产和统一安装耦合仍未消除；不是三个部件已经完全独立。未 commit/push、未部署，本地簿与对照默认关闭，实际预检继续 HTTP。

## 后续第 2–3 批：保留边界与真实安装输入（2026-10-17）

[changmen 扩展] 本轮只增加验证门禁、依赖清单与隔离安装证据，不再迁移业务实现，不修改任何 workspace package.json、根 lock、loader、SQL、实际安装命令或发布规则。

### 六组明确保留边界

`scripts/verification/retained-source-boundaries.json` 登记责任归属、保留原因、退出条件；`retained-source-boundaries.mjs` 接入 `check:boundaries`，提供追加约束，不授予源码、安装或发布豁免。

| 保留组 | 持续约束 | 仍缺条件 |
| --- | --- | --- |
| 冻结 adapter 岛 | 7 个 loader/registry 文件与原 551 路径/原 hash 一致；不能从库存静默删项 | 原路径/内容要求下继续保留，未来迁移需单独兼容设计 |
| 旧兼容入口 | 23 个转导出、6 个 CLI、1 个 JSON 资产的登记关系不能静默删除或重定向；原薄入口与同内容检查继续执行 | 逐个证明旧消费者已退役，才可单独移除入口 |
| RDS 资产 | 明确列出结构基线及 43 个有效迁移 SQL，共 44 个资产；沿用既有 SQL checksum | 维护包资源布局与固定旧消费者兼容；退役 002 SQL 仍原位，不属于有效迁移 manifest |
| 冻结 DB 访问 | 保留现有 admin_maintenance 的 8 个位置登记，既有 DB/订单保护继续执行 | 需要单独授权的订单兼容改造，不能添加例外 |
| 后端瘦包工具 | 当前完整实现、源根及复制约定追加固定检查 | 独立工具闭包与复制内容契约明确后再讨论迁移 |
| 布局根 | 复用原 PM shared-loader 的来源签名检查；不另建根解析器 | 独立安装必须仍能解析正确布局与资源，不能拿目录名称代替证明 |

新库存不替代原 551 manifest、原精确恢复器、订单保护或 DB 边界检查。原行情与经典 FOK 继续由既有完整保护负责。

### 三个部件的依赖输入

`scripts/verification/component-install-inputs.mjs` 输出带来源链的生产声明闭包，保守包含 optional/peer；前端另列其宿主构建依赖。未知本地包和错误 file 目标拒绝通过。此报告也接入原边界命令，始终为 `installationCertified:false`、`publishScopeOptimizationEnabled:false`。

- 前端声明闭包 **9 个 workspace**。当前 `web → venue-adapter → db/storage` 是真实的包级安装耦合，不能因为浏览器运行图没有 SQL 就忽略它；Node 工具/基础设施的需求仍压在整个混合 adapter 的声明上。
- 后端声明闭包 **14 个 workspace**，没有整个 adapter、client-core、浏览器簿、Vue 或 Pinia；但完整根 workspace 中 backend/resolver 对 adapter 的开发依赖及相关 peer/workspace 链仍影响 npm 实际安装。
- RDS 声明闭包 **3 个 workspace**：db、shared、storage；外部直接依赖只有 pg、dotenv。这个依赖闭包已可单独安装，但维护 SQL/结构基线仍在 backend 目录，storage 仍依赖现有仓库布局。

### 五个全新目录的安装对照

均使用本机 npm 11、原 lock、离线 cache、`--ignore-scripts`；复制源码时排除 .env、.npmrc、密钥及 backend storage，未读取生产凭据。没有通过安装后手工删除包来制造隔离结果。

| 目录配置 | 安装包数 | 实际 workspace 链接 | 浏览器依赖结果 |
| --- | --- | --- | --- |
| 原配置：backend + resolver，omit dev | 384 | 17 | 仍可解析整个 adapter、client-core、浏览器簿及 Vue；Pinia 无 |
| 原配置：只选 RDS，omit dev | 18 | 3 | adapter、client-core、浏览器簿、Vue、Pinia 均不可解析 |
| 实验：临时根仅登记后端 14 个生产 workspace，omit dev | 349 | 14 | 上述浏览器依赖均不可解析；新的 Node loader 包可正常加载 |
| 实验：临时根仅登记 RDS 3 个生产 workspace，omit dev | 18 | 3 | 上述浏览器依赖均不可解析 |
| 原配置：选前端，包含构建依赖 | 484 | 9 | Vue/Pinia 正常；DB/storage 仍因 adapter 声明进入安装闭包 |

实验仅在临时目录调整根 workspace 成员列表；源码文件和 lock 保持原样，所有目录仍保留完整源码布局，**没有证明产物内容已经排除浏览器源码**。仓库中的根清单、依赖声明、生产安装与发布流程未采用实验配置。

`npm explain` 在真实后端定向安装中显示 adapter 的 backend/resolver 开发依赖及 workspace 链、client-core 的 adapter 生产依赖与 registry 开发依赖、Vue 的 adapter optional peer 关系。这组证据说明需要约束安装上下文，不能把 `--omit=dev` 等同于排除相关 workspace/peer；它不构成“只有某一条依赖是唯一原因”的断言。

### 验证与结论

- 当前/实验后端及 RDS 四个安装目录，均在阻断浏览器运行模块、fetch/TCP 连接后加载通过。后端加载同一原 loader 模块、registry/17 项 manifest、OB/PB/RAY/HG session、resolver；RDS 新旧维护入口的函数身份相同。没有连接平台或数据库。
- 按真实导入者解析：后端 **23 处**、RDS **2 处**外部依赖在原/实验安装中版本及入口内容 hash 一致，未因缩小 workspace 集合漂移 SDK；不是从根目录猜测所有依赖的解析位置。
- 前端 **19 处** Vite 解析与上一批真实证据逐项一致，web/adapter 共用一个 Vue；没有重新构建应用。
- 新旧边界与负向用例 **6 文件 133 项通过**；adapter 四项检查、`check:boundaries`、完整 `check:fok-vps` **551/551**通过。FOK 等价脚本由完整保护真实执行，原断言和原基线不变。
- 通用未知输入仍为 169；PM 专项仍为 54 动态目标、9 来源绑定调用、931 有界文件、20 共享记录、0 未解释输入。未扩大到其它历史脚本。

首轮新增布局检查误将既有 token 来源签名当作全文 hash，已改为调用原 `sharedLoaderSourceSignature`，未改原签名、551 或恢复器。首轮安装冒烟错误请求了不存在的 IM/session 路径，已核对实际文件/manifest 后使用原有 HG/session；没有修改生产代码或删除实际断言。初始日志和最终结果分别保留。

**结论：保留边界已变为持续检查，后端/RDS 的依赖安装隔离路径有真实证据；三个部件尚未完全独立。** 后续优先为 adapter 整理真正的浏览器依赖入口/安装输入，解决前端声明带入 DB/storage 的问题；同时明确后端必需布局资源、RDS 维护资产的完整清单。冻结文件继续原位，不能直接把临时 workspace 实验当作生产包或发布授权。

证据在 `output/component-isolation-inputs-20261017/`。本轮未改业务源码、package.json、lock、实际发布控制或本机服务；未 commit/push、未部署，本地簿及对照继续默认关闭，实际预检仍走 HTTP。

## 后续批次：RDS 维护资产独立（2026-10-17）

[changmen 扩展] 数据层维护资产已解除对 backend 目录的读取依赖：

- **主文件**：`rds/assets/migrations/` 的 43 个有效迁移 SQL，以及 `rds/assets/schema-baseline.json`；与本批开始时原文件逐字一致，没有重新录制结构基线或修改 checksum。
- **读取入口**：`rds/maintenance/assets.mjs` 按自身模块位置读取；结构核验、初始化、观察表维护、结构统一四个实现统一使用它。没有 backend 回退。四个实现除了资产读取/导入调整，全文还原后一致，原 SQL、事务、锁、顺序、超时、备份与错误处理不变。
- **兼容副本**：backend 原路径 44 个文件原字节不变，旧 CLI、旧测试与固定历史消费者继续可用。退役 002 SQL 未迁入有效清单，原文件仍保留。
- **生成与门禁**：`rds-assets.mjs --check` 检查完整主资产、历史 checksum 和旧副本逐字一致；显式 `--sync` 仅生成旧副本，全部主资产通过核验后才写入，不连接数据库。源码归属清单新增 44 组资产映射，六组保留边界同步登记主/旧两侧，原基线 checksum 保持。
- **数据层自身检查**：三个 SQL smoke 改读数据层本地资产和当前初始化实现；原断言保留。它们另有跨端业务源码断言，仍属于仓库集成检查，不宣称整套测试可脱离 backend。

### 无 backend 目录的真实验收

`scripts/testing/rds-assets-standalone-postgres.mjs` 从零复制 DB/shared/storage 三个源码包，不复制 backend、浏览器源码、.env、.npmrc 或密钥；用原 lock 做离线生产安装（18 包，关闭生命周期脚本）。仅临时根的 workspace 清单为这三个包，仓库根 package.json/lock 不变。

在不同 cwd、环境变量显式提供本机临时 PostgreSQL 地址的条件下完成 **8 组检查**：干净安装与无 backend 目录；主资产读取且没有浏览器依赖；空库默认命令只读失败且不建表；显式执行 43 个原迁移；完整库默认核验及账本时间不变；已有业务表拒绝初始化；观察表维护读取本地 SQL；结构统一默认检查读取本地 SQL。每次命令后都确认 `server/backend` 未被创建，不使用占位目录、旧目录软链接或复制旧 backend 资源兜底。

### 本批验证

| 检查 | 结果 |
| --- | --- |
| 资产及维护/兼容专项 | 9 文件 87 项通过；含缺失主文件不回退、非法文件名、未登记 SQL、校验失败写入前拒绝、只读检查及显式生成 |
| 数据层正式测试命令 | 30 文件 365 项 vitest 与 3 个原 SQL/业务隔离 smoke 全部通过；新旧 CLI 导出身份继续一致，与专项集合有重叠 |
| 无 backend 目录安装与维护 | 8 组真实 PostgreSQL 检查通过；18 个依赖包，只有 db/shared/storage workspace，原 lock 未改 |
| 旧消费者/代码回退兼容 | 临时 PostgreSQL 17 项通过，固定 52 份旧来源与原提交/hash 不改 |
| 结构统一与备份恢复 | 临时 PostgreSQL 16 项通过，原数据/序列/精度/账本与备份恢复检查保留 |
| 原 backend / 新数据层 CLI | 临时 PostgreSQL 6 组通过，默认只读、显式初始化与已有库拒绝重放均保持 |
| 原行情与经典 FOK | 完整 551/551 保护通过，内含真实执行 FOK 等价、共享边界和 GTC 隔离；551 原路径/原内容未改 |
| 边界 | 0 未分类/资产漂移；PM 54 动态目标、9 来源调用、931 有界文件、20 共享记录和 0 未解释输入不变；通用未知从 169 降至 165，与资产读取集中对应 |

**当前结论：本次已完成 RDS 维护资产对 backend 的依赖解除。** 保留原布局中的 DB/shared/storage 即可运行上述维护命令；backend 旧资产只是供旧消费者使用的兼容副本。尚未认证任意平铺 npm 包布局、独立发布产物或生产迁移，旧 CLI 的配置兼容方式和历史脚本仍保留。前端经混合 adapter 带入 DB/storage 的安装耦合也仍待处理。

证据位于 `output/rds-asset-isolation-20261017/`。本批只调整数据层资产读取及验证，不改任何历史 SQL/原结构基线、原行情、经典 FOK、默认簿开关、依赖声明/lock 或实际发布规则；未连接生产 RDS、未重启本机服务，未 commit/push、未部署。

## 后续批次：退役 backend 的 RDS 副本与入口（2026-10-20）

[changmen 扩展] 本节替代上文“仍保留兼容副本和旧 CLI”的当前状态说明，历史批次记录保留。

- backend 的 43 份有效 SQL 副本和 1 份结构基线副本已删除；数据层主文件及原 checksum 不变。已退役的 `002_prune_pg_cron.sql` 原字节移至 `rds/assets/archive/`，不加入有效迁移清单。
- 5 个转导出入口及 2 个 CLI 分派入口已删除。当前测试、初始化/核验命令和发布前只读检查直接使用 `@changmen/db/maintenance/*` 或数据层正式 CLI；backend 原 npm 命令名称保留。
- 4 个维护测试移至 `rds/maintenance/`，原测试断言保留，只调整 SQL 资源路径；公开导出身份、导入无初始化、副本缺席和历史资产防漂移另有检查。
- `rds-assets.mjs --sync` 生成副本的功能退役，`--check` 只核对主资产与旧位置缺席。边界检查也验证旧入口不得返回、服务端源码不得引用已删除的 SQL 路径。
- RDS 正式维护路径沿用“只触发数据库验证、不选择应用发布”的既有规则；保留旧路径分类以处理删除旧文件的变更事件。没有实际发布或数据库维护操作。
- 固定的 52 份旧消费者仍从原 Git 提交物化；旧版本的 checker 只在该独立历史目录加载，不恢复候选源码中的旧入口。

验证：数据层正式测试 397 项及 3 个原 SQL smoke 通过；临时 PostgreSQL 的新旧兼容 17 项、结构统一/回退 16 项、独立 CLI 及无 backend 的离线安装/维护通过。原 551 保护、adapter 冻结检查和边界检查通过。具体日志位于 `output/adapter-browser-isolation/rds-*.log`。

本批未动 `admin_maintenance.js` 及其 8 处冻结例外；backend 中其他历史运维脚本仍需按实际职责核查。本批完成列明的副本与入口退役，不代表整个后端/RDS 源码隔离已全部验收。未提交、未部署、未连接生产数据库。

## 后续批次：业务 SQL 例外清零与结构工具归位（2026-10-20）

[changmen 扩展] 上一批保留的 `admin_maintenance.js` 已完成只读 SQL 抽取：三条查询、原连接就绪检查及未就绪错误原文逐字归入 `rds/admin_maintenance.js`，通过 `@changmen/db/admin_maintenance.js` 暴露两个读取方法。backend 保留报表组装、分组、排序、金额/日期转换、提示文字和三个原公开方法。

- `backend-db-access-exceptions.json` 的八处访问位置已全部退役；固定历史基线未更换。AST 扫描确认 backend core 当前直接访问为零，已迁移文件不得重新登记例外。
- 原订单阶段二基线和清单保持不变。新的有限抽取记录可从当前报表完整恢复迁移前源码，并要求三条 SQL 主实现、调用位置及所有显示逻辑逐字相等；额外语句或 SQL 改动仍拒绝。
- 4 个只负责数据层结构维护的脚本移至 `rds/maintenance/`：033 体育合场结构、036 队伍 provider 标识巡检、客户端证书结构、SQL 表引用检查。只调整资源路径及命令说明，旧 backend 文件删除，不添加转导出。
- 原生 Node 对照覆盖六组输入/故障、三个公开方法共 18 次比较，同时核对 SQL 文本、查询顺序、连接就绪调用、错误与完整报告；网络调用为零。
- 临时 PostgreSQL 中使用可包含历史重复数据的诊断样本，在数据库强制只读状态下对照原/新三个方法，覆盖同用户及跨用户重复订单、软删账号、订单数和小数金额；结果及原订单行一致，注入 DELETE 被数据库拒绝。完整新旧结构兼容的 17 项检查另行通过。

数据层正式 397 项测试及 3 个原 smoke、后台账号测试、专项保护、原 551 保护、adapter 冻结检查和边界检查通过。SQL 表引用工具直接执行通过，覆盖原有的 12 张代码表；这是源码检查，不连接数据库。

当前完成的是 backend 业务 SQL 访问与上述 4 个工具的物理归属收尾。其余历史运维、事件修复和归档脚本仍需按实际职责处理，不能据此宣称三层所有历史文件均已隔离。所有数据库验收仅使用本机临时实例，未执行生产维护、提交或部署。日志位于 `output/adapter-browser-isolation/admin-*.log`。

## 后续批次：130 个纯数据库历史脚本归位（2026-10-20）

[changmen 扩展] 对 backend scripts 的 224 个 JS/MJS 文件核对静态/动态导入、相对资源及环境/目录上下文后，将其中 130 个只依赖数据层、storage、纯共享规则和 Node 能力的数据库脚本移至 `rds/maintenance/legacy/`：归档 39 个、诊断 27 个、事故修复 47 个、迁移 16 个、配置数据维护 1 个。旧文件全部删除，不保留转导出或副本。

127 个文件正文不变；另 3 个文件的 5 个数据层相对导入按新位置调整，SQL、事务、业务字段、环境处理、参数及默认执行行为均不变。322 个非 builtin 导入逐项验证迁移前后的实际解析结果相同，数据层没有新增反向业务依赖。四个既有 npm 命令名称保留并改指向数据层；工作目录和原参数约定保留。

有限迁移记录锁定每个文件的原文、变换与完整结果。历史订单保护读取旧位置时，必须先核对新位置完整真实实现，再恢复原始源码进行全文比较；这只用于验证，不向 Node 运行时注册旧路径解析。原 551 manifest 和订单阶段二范围清单未修改。

验收没有执行任何迁入的维护脚本：原生 Node 对 130 个文件逐个进行语法检查；边界检查、312 项迁移/原保护专项、66 项订单退役/历史包检查、397 项数据层测试与 3 个原 smoke、244 项后台账号测试、adapter 冻结检查和完整 551 保护通过。相关集合有重叠，不合计为独立测试总数。

剩余清单仍有 52 个涉及数据库能力的后台脚本，包括后台/平台编排、外部 API、特殊环境和旧路径依赖，以及验收辅助脚本。它们未被直接搬入数据层；下一步应继续拆出其中的数据访问或处理其目录上下文。固定 SQL 资产中的旧命令注释保留，以维护原 checksum，不是当前可执行入口。日志、依赖核对和剩余清单位于 `output/adapter-browser-isolation/legacy-*`。未提交、未部署，也未执行生产或本机维护写入。

## 后续批次：10 个带环境/路径上下文的数据脚本归位（2026-10-20）

[changmen 扩展] 本轮从上述 52 个剩余项中迁走 10 个：用户创建、账号备份、三项数据诊断、三项历史事故修复、两项归档诊断/修复。累计迁入 `rds/maintenance/legacy/` 为 140 个，旧入口均删除。四个正文不变，其余只调整明确登记的资源或导入位置；SQL、事务、参数和执行开关保持。

- 环境文件指向和 caller cwd 语义保持原样，包括历史 `ops/.env` 指向，不借迁移改为另一份环境文件。默认及显式备份输出地址也保持。
- 两个诊断改用共享纯身份规则，原 facade 和新入口导出的函数身份相同，数据层不再依赖 match workspace。
- `_tmp_gb14_dup_attribution.mjs` 原导入错误地指向已经不存在的 `server/backend/db/player_account_record.js`，现明确修至数据层真实文件；这项修复单独登记，没有作为“相同解析结果”放行。
- 数据层显式声明其脚本实际使用的 dotenv；仍为现有 `^17.4.2`，离线、关闭生命周期脚本更新 lock 后，只有 `server/db` 的依赖声明改变，其余包条目和已锁定版本完全一致。历史元数据对照可完整恢复原 lock。
- `user:create` 和 `db:backup-accounts` 名称及参数保持，直接执行数据层新文件。用户创建 CLI 用模拟数据库驱动做七种原生新旧对照，核对 SQL、profile 参数、错误、退出码及连接关闭，网络调用为零。其他迁入脚本未执行真实维护。

10 个脚本的原生语法、27 个非 builtin 导入、不同根目录下的资源地址，以及默认/相对/绝对备份输出均核验。106 项迁移及原保护专项、295 项历史元数据/依赖专项、397 项数据层测试与 3 个 smoke、244 项后台账号测试、原 551 保护、adapter 冻结检查和边界检查通过。无 backend 目录的离线安装和临时 PostgreSQL 标准维护 8 组验收也通过；该验收不执行这些历史数据脚本。

上一批文档中事故脚本的分类数由误写的 49 更正为实际 47，原迁移总数 130 不变。当前 140 个分类为归档 41、诊断 30、事故 50、迁移/备份 17、根目录工具 2。

剩余 42 个涉及数据库能力的 backend 脚本继续待拆，其中包括业务/平台编排和验收辅助脚本。特定历史环境/备份目录兼容仍保留，不能宣称全部历史脚本支持任意独立部署布局。证据位于 `output/adapter-browser-isolation/context-*`。未连接生产数据库，未执行真实历史维护、提交或部署。

## 后续批次：三份混合账号修复脚本的数据访问拆分（2026-10-20）

[changmen 扩展] `fix-river-dedupe-pm.mjs`、`fix-river-prune-players.mjs`、`fix-sh01-river-accounts.mjs` 同时依赖数据库与后台缓存，故保留后台编排，将 10 处 SQL 的真实实现抽到 `rds/maintenance/profile_repairs.js`，通过公开子入口提供 9 个限定用途的数据操作。后台脚本不再持有连接池，也不再包含 SQL；数据层只导入本包的连接池模块，没有导入后台缓存或平台代码。

修复计划、账号字段构造、参数、日志、默认写入/dry-run、缓存刷新顺序及原连接关闭时机均保留。没有新增旧路径兼容入口，不计入此前 140 个整文件迁移。独立抽取记录核对完整前后源码、原 SQL 字面量、参数及数据层实现；历史验证只有在真实新实现完整存在时才恢复旧源码，原 551 清单和订单冻结范围不变。

31 个原生 Node 新旧模拟场景核对 SQL、查询参数、输出、错误、退出码、缓存与关闭顺序，包括无变更、缺少用户、外属账号、缺少 player，以及数据库就绪/读写、缓存和关闭失败；均通过，网络调用为零。专项及既有保护 84 项、数据层 397 项与 3 个 smoke、后台账号 244 项、边界、adapter 冻结及原 551 保护通过。无 backend 的离线安装可导入新公开接口，原 8 组临时 PostgreSQL 标准维护验收也通过；该验收不执行历史账号修复。

按上一批 42 项剩余清单，三项已拆出直接数据访问，仍有 39 项待审，包括平台/后台编排和验收辅助脚本；不能将这些项目全部视为必须整文件迁入数据层。本批不代表后端/RDS 整体隔离验收完成。证据位于 `output/adapter-browser-isolation/profile-repair-*`。未执行真实历史修复，未连接生产数据库，未提交或部署。

## 提交发布前复核修正（2026-10-20）

[changmen 扩展] 全量检查发现旧 loader、registry、工具目录仍有三个非 workspace 的 `package.json`，其公开入口指向已退役文件，现删除这些残留清单。真实 workspace 及运行实现不变；历史物化仅在完整核对新位置的包清单和所有公开目标后返回旧清单，不向运行时注册别名。

RDS 副本与直接 SQL 例外退役时，当前保留边界策略已更新，但两个更早的元数据对照测试尚未接入精确历史视图。新增有限记录仅接受这两组已审退役变换，核对 44 份主资产、管理查询实现及空例外清单后，恢复原策略全文继续比较原提交；原 551 保护、历史策略原文和范围均未重录。完整旧版 Git 物化测试明确使用 30 秒超时，所有原断言保持。该复核不执行实际发布或 RDS 维护。
