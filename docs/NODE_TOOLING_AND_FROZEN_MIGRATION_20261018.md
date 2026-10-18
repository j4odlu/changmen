# 第二批目录隔离与冻结包迁移方案

[changmen 扩展] 2026-10-18，基于 `master` / `02b5092c` 执行下一步第 1、2 项及第 3 项方案：核对剩余目录、迁出两个 Node 工具实现、设计冻结文件后续迁移。冻结包、Chrome 扩展和探针本批不搬迁；生产安装、运输、激活及默认交易模式保持。

## 已完成的 Node 工具归位

两个 JS 实现及两个 `.d.ts` 声明迁入 `devtools/runtime-tooling`，包名为 `@changmen/runtime-tooling`。旧 `packages/shared/tooling` 四个文件仅转导出；没有复制第二套算法。原端口算法和两份声明逐字保持。Vite 两个消费者直接引用新包并声明 devDependency；storage 的运行版本与开发端口入口声明 production dependency，原公开入口继续工作。

旧工具目录增加独立 `@changmen/runtime-tooling-compat` workspace，仅持有转导出及 canonical 工具依赖。`packages/shared/package.json` 原字节保持，不以 production、optional 或 peer 方式把 Node 工具带入浏览器运行依赖图。普通根安装与现有宿主命令不变；仅安装 shared 本体不能被当作包含 Node 兼容工具的独立安装证明。

新源码目录在迁移同批进入前端、后端来源过滤及无 Git 归档遍历，保留所有原排除规则。新增工具变更仍须双端构建/发布，因此分类器为精确 `devtools/runtime-tooling/` 前缀保留 full；其他 devtools 分类不扩大。浏览器经新包名或旧 shared 路径到达 Node 工具均被拒绝。

`runtime-tooling-migration.json` 登记六份元数据的精确逆变换及本次两处来源覆盖补充；还原后继续沿原六份迁移证明校验同一个 `a233e205` 完整历史元数据，并沿既有覆盖证明校验 `abdfce46` 全文。原证明 JSON、551 manifest/hash、保留契约和前端构建输入原 hash 均不改。lock 仅改变已审 workspace、宿主声明与链接记录，外部包版本、来源、integrity 不变。

## 真实安装结果与限制

四个全新临时目录用原根 package/lock 离线、禁生命周期安装，验证 frontend runtime、frontend build、storage runtime 和 legacy runtime。前端运行声明及实际 npm 运行依赖图仍是 7 个 workspace；构建图增加本工具，为 8 个。完整 backend 声明闭包为 15 个、RDS 为 4 个；八生产进程候选安装清单增加同一个工具，成为 19 个，生产安装配置未切换。

实际 frontend runtime 目录仍有 8 个 workspace 链接：npm 对构建用本地 file/workspace 依赖可能在 `omit=dev` 下留下链接。运行图不含工具，构建与服务端图含工具，已分别核对；这项结果不认证物理最小安装或 Linux/native/lifecycle 行为。新旧 Node 导出具有相同函数身份；端口默认值与非法覆盖校验通过；安装探测的网络尝试为 0。

首轮 optional peer 方案被实际安装图否定，现已删除；没有为其扩大前端运行白名单或修改通用 peer 遍历算法。首轮发布分类遗漏由新增负向测试发现并修正。单独安装 legacy workspace 的夹具曾错误要求未安装的 shared 顶层包，已改为测试实际安装的兼容包入口；web/storage 两组仍保留原 shared 命名空间的函数身份断言。失败和修复后证据分别保留。

完整门禁首轮另发现旧工具目录排除断言、兼容入口数量和历史 lock 比较未随本次迁移更新。现按唯一真实工具文件、增加四个兼容入口及先还原本批 lock 的顺序核对；实际当前 manifest/lock 一致性和原外部依赖逐项检查保留，原历史清单不扩项放行。

## 剩余逐文件清单

[机器清单](audits/FOLDER_MIGRATION_INVENTORY_20261018.json) 登记当前 888 个路径的候选目标、原始字节 hash、源码归属、551 保护、保留组、静态消费者和未解析加载数量。其中包含 44 份需保留的 backend SQL/基线兼容副本；306 个路径命中固定保护。清单只是方案，未给冻结搬迁或删除旧入口授权。

| 剩余目录 | 路径数 | 候选归属与前置条件 |
| --- | --- | --- |
| `packages/client-core` | 37 | 候选 `client/packages/client-core`；其中 25 个固定保护文件，先建立完整迁移保护 |
| `packages/arb-core` | 14 | 候选 `client/packages/arb-core`；其中 11 个固定保护文件，同样保持经典 FOK 数学及调用语义 |
| `packages/venue-adapter` | 616 | 浏览器候选归 client；Node 与共享元数据的目标按入口分别核对，未决目标显式为空 |
| `chrome-extension` | 84 | 候选 `client/chrome-extension`；先核对用户已加载目录、开发脚本、manifest、打包与产物路径 |
| `devtools/platform-probes` | 93 | 候选 `server/devtools/platform-probes`；先核对资源根、CLI 分派、瘦包复制和 Node 解析 |

规划图登记 6,956 个依赖位置，保留 164 个未知位置；其范围与日常门禁不同，不替代日常 185 项通用 unknown 或 20 条共享不确定记录。空消费者列表只说明当前静态图未找到，不能证明无动态加载、脚本、资源或外部消费者。Node/shared adapter 文件的未决目标不能自动按父目录搬成前端实现。

## 冻结包迁移设计：本批仅出方案

首先迁移 client-core，再迁移 arb-core；两者通过后才处理 adapter Node 基础设施。每批独立提交。目录中的非冻结元数据与受保护实现分开登记，但包声明、真实实现、旧入口及保护检查必须作为同批原子变更。

| 关键冻结入口 | 后续候选方向 | 必须保留的行为 |
| --- | --- | --- |
| `loader/adapter_paths.mjs` | `server/packages/venue-node-loader` | 真实单例、缓存及 reset、ESM/CJS 加载时机、外部根优先级、预加载和 backend 解析路径 |
| `registry/paths.js`、`registry/feeds.js` | `server/packages/venue-node-registry` | 与 loader 一致的 manifest、平台资源根、文件选择与瘦包语义 |
| `registry/adapters.ts` | 客户端 adapter 注册目录 | 浏览器 adapter 实例、工厂与采集/下注注册时序 |
| `registry/index.ts`、`meta.ts`、`icons.ts` | 逐导出核对纯元数据与浏览器资源能力后确定 | manifest 唯一来源、平台顺序、图标文件/URL；barrel 不能把浏览器 adapter 混入 Node |

真正搬迁受保护实现前，需评审以下完整保护方案；现有冻结文件与保留契约本批逐字保持：

1. 固定原 551 manifest、历史 commit 和每个原 hash，新增显式的旧路径 → 唯一 canonical 路径映射；不得录制新基线。检查原入口的完整薄包装文本，并检查 canonical 全文按已审路径变换精确还原原文件。旧、新路径任何一个缺失、改向或未登记差异都失败。
2. 分别核对静态 import、计算 loader、package exports、Vite alias、锁文件、资源读取、瘦包复制与部署归档；不能只改 import。`import.meta.url`、createRequire、dirname、CHANGMEN_LAYOUT 的位置语义逐项验证；不复制第二套 loader 或根定位算法。
3. 单一真实实现，旧路径仅兼容。新旧导出、模块状态与缓存必须相同；CJS/ESM、原目录与无 Git 归档、已使用的根覆盖及既有打包布局须保持。未知外部根不认证。
4. 负向样本至少包括 canonical 篡改、旧入口改向、双实现、丢失资产/导出、lock 外部依赖漂移、Node 导入浏览器、绕过映射及部分迁移。只新增文件名白名单不能作为完整保护。
5. 原经典 `legacy` FOK 的价格、金额、深度、双腿顺序、单次提交、确认、补单和订单绑定不变。有效凭据下缓存为空仍自动准备签名器；锁定、退出、撤销和凭据变更保护继续有效。不得增加手动准备、历史等待或拒单门控；必须跑行为回归、FOK 等价和 551 全保护。
6. 若完整还原与资源语义无法证明，保留该冻结实现原位并列明剩余项，不以复制、junction、删保护或整目录豁免宣称完成。旧 SQL/CLI 只有确认全部消费者退役后才另批移除。

本方案尚未实现冻结路径映射或执行上述包搬迁。既有保留契约要求单独审查迁移兼容设计；下一批评审对象就是精确映射、旧包装及 canonical 完整源码保护，不以本规划文档自动解冻。

## 本机验收与提交范围

本批新旧导出、来源覆盖、安装声明及精确还原专项通过；四组干净安装、后端 12 个无缓存任务、生产类型/构建、FOK 等价、551/551 和独立 Node 保护 9 项通过。完整门禁连同来源测试及前端工具共 91 文件、2,535 项通过；前端 515 文件、4,701 项通过，保留 3 项既有跳过；发布控制 95 项及 shell 切换/回滚演练通过。文件清单与源码稳定核对写入 `output/node-tooling-isolation-20261018/`，历史失败单独保留。

本轮仅建立第二批本地提交，不 push、触发 Actions 或部署。未跑本次完整 22 阶段、临时 PostgreSQL 或浏览器长稳；这些仍需绑定最终发布提交。精简安装、瘦包、独立发布 C–E、拆仓、本地簿及旁路均未启用。真实 CODEOWNERS 负责人仍待补充，模板不等于已启用审查。
