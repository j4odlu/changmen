# 浏览器职责拆包累计验收与后端安装隔离

> [changmen 扩展] **文档状态（2026-10-22）：历史迁移与验收记录。文中的旧目录、兼容入口、workspace 数量、未提交及未部署状态仅对应各自批次；当前布局见 [WORKSPACE_LAYOUT](./WORKSPACE_LAYOUT.md)，安装与发布见 [INDEPENDENT_DEPLOYMENT](./INDEPENDENT_DEPLOYMENT.md)**

> 2026-10-20 更新：前文保留首轮验收记录；私有通道、账号执行、采集和市场宿主全部迁移后的最新验收见末节。

日期：2026-10-19。Git 基线：3126c8de0462aaca96b96be432618fd852285755，master 本地累计改动。

[changmen 扩展] 本轮复查前面纯函数、类型与异常、共享状态、行情宿主、独立 workspace、前端消费者和 Worker 入口的累计改动，并推进后端独立安装验证。未修改业务运行源码、数据库结构或数据；未 commit、push、部署或执行迁移。

## 发现与修复

原后端安装实验通过 require.resolve(packageName) 抛错来证明浏览器包不存在。这项判断有漏洞：仅提供子路径 exports 的包即使已安装，解析根入口仍会抛 ERR_PACKAGE_PATH_NOT_EXPORTED。

在当前完整安装中已复现：@changmen/venue-browser 的 package.json 存在，/pm-book-source 可解析，包根入口却抛出上述错误。原来的顶层 workspace 链接集合检查仍能发现多余的顶层 workspace；本次修正补足缺失的物理目录检查，不表示生产已经误装浏览器依赖。

修复与推进：

- assertBackendBrowserPackagesAbsent 检查每个选定后端 workspace 的 Node 包查找目录，拒绝实际可见的浏览器包目录，不导入或执行浏览器代码。
- 安装实验使用上述检查，替换原来可能误判的根入口检查，并记录 browserPackagesAbsent。
- 后端安装策略和 Node 声明检查均显式加入 @changmen/venue-browser；后端、resolver 的四种依赖声明及传递生产依赖均覆盖。
- 补充只提供子路径入口的回归样例，覆盖根 node_modules、backend 嵌套安装及另一个后端 workspace 的嵌套安装。

本轮业务代码未变化，既有迁移记录和固定源码 hash 未修改，生产安装命令和发布范围保持原样。

## 累计改动审查

- 迁出纯函数保留原函数体、校验、舍入和异常信息。
- 原异常入口导出同一个构造函数，instanceof 语义不变。
- 旧入口与新包共享同一套偏好变量、tick Map 和监听器 Set。
- 行情宿主仍创建一个冻结对象；观察函数身份、资产集合的实时读取及取消订阅保持原样。
- Worker 仅保留一个组合入口，原 URL、启动参数及诊断工厂不变；新旧入口以不同顺序加载均只启动一次。
- 19 个明确导出全部被 npm pack 预览包含；旧 orderBook、wsBookShadow 入口固定保留。

## 验证结果

日志目录：output/venue-browser-acceptance-20261019/。不同测试组存在重叠，不累计为总测试数。

| 检查 | 结果 |
| --- | --- |
| 后端安装策略及目录漏检回归 | 10 项通过 |
| Node 依赖边界回归 | 40 项通过 |
| verification-control | 110 文件、2,743 项通过 |
| verification-node | 9 项通过 |
| test:checks | 边界、导出、契约、冻结检查及 24 步 catalog smoke 通过 |
| 发布控制与本地发布/回滚集成 | 106 项 Node 测试及 shell 集成通过 |
| 完整前端回归 | 528 文件、4,821 项通过；原有 3 文件、4 项跳过 |
| 服务端及其依赖测试 | turbo 强制执行 12 组，全部通过，未使用缓存；保留原有 skipped / expected fail |
| 独立前端安装、类型检查、生产构建 | 9 个 workspace、9 个源码目录，不含 server，全部通过 |
| 独立后端安装、路由编译、依赖解析、loader | 全部通过 |
| npm pack --dry-run | 21 个文件，19 个公开入口全部包含 |
| git diff --check | 通过 |

前端构建仍生成 pmMarketData.worker-6o1jiZ-N.js（24.15 kB），与上一轮日志的 Vite 文件名哈希一致；未声称逐字比较两份产物。原有大 chunk、静态/动态导入重叠提示仍存在。最初的临时 pack 输出解析命令误按数组读取 npm 的对象格式，修正读取方式后全部入口验证通过；没有为此修改项目源码。

后端实验在临时目录分别执行完整与选定 workspace 的离线 npm ci，覆盖八个生产进程、六个安装根及 19 个 workspace。386 个可达源码文件、1,053 处字面量依赖解析一致，未解析项为零。选定安装中各后端 workspace 的包查找目录未出现受限浏览器包。原 loader 与兼容入口身份、registry、平台预加载及共享 catalog bundle 均通过验证，探针网络尝试为零。实验期间源码指纹稳定，锁文件不变。

## 验证边界及下一步

当前证据支持本地累计拆包与安装隔离未出现回归，不等同于绝对无 bug 或完整线上验收。后端仍有 11 处动态路径未能静态解析，两种安装的这部分证据相同；没有把它们计算为已验证的完整运行闭包。

独立安装使用 --offline --ignore-scripts，本机 Windows 结果尚不覆盖 Linux lifecycle / native optional dependencies，也未启动生产服务或执行真实登录、下单。下一步将独立安装验证接入 Linux CI，再依据该环境的结果决定是否缩小实际后端发布包。现有生产安装与发布流程继续保持不变。

用户已有的 ARCHITECTURE、matcher README 以及合场一致性、PM 对侧溢价审计/方案文档未改动。

## 2026-10-20 最终累计验收与提交范围

[changmen 扩展] 本阶段完成 PM 浏览器业务实现的职责拆包。旧 `packages/venue-adapter/polymarket` 只保留平台注册组装、聚合与转出入口；原函数、状态容器和连接实现已归入客户端包。公共契约与平台常量由 `@changmen/client-core` 提供，订单簿协议与核心由 `@changmen/pm-market-data-browser` 提供，其余已迁移的浏览器实现由 `@changmen/venue-browser` 提供。其他平台尚在旧 adapter 中，不属于“全部隔离完成”的结论。

浏览器包现有 131 个明确子路径导出，打包预览包含全部目标。旧入口和新入口共享账号缓存、监听器、Vue 响应式状态及构造函数；Vue 由 web 提供同版本范围的可选 peer。模块正文与原依赖目标均有完整比较。订单簿工厂仅调整 Worker 资源相对路径，原授权回调、创建时机、module 类型、名称和停止释放行为不变；通过旧公开入口单独构建也生成了含原诊断工厂的 Worker。

本地验收结果：

| 检查 | 当前结果 |
| --- | --- |
| 源码与边界回归 | 118 文件、2,772 项通过 |
| 前端全量回归 | 537 文件、4,950 项通过；原有 3 文件、4 项跳过保持不变 |
| 前端严格类型检查 | 通过 |
| 边界、导出、接口契约及 catalog smoke | 通过，24 步 smoke 完成 |
| 独立前端安装与生产构建 | 9 个 workspace，无 server 目录，锁文件不变 |
| 后端及其依赖 | 强制执行 12 组测试全部通过，0 缓存复用 |
| 发布与回滚控制 | 106 项 Node 测试及本地 shell 发布/回滚集成通过 |
| 当前锁文件的独立后端安装 | 完整安装与选定安装的路由编译、依赖解析、loader、registry 和预加载全部通过 |

后端独立安装覆盖 19 个 workspace，386 个可达源码文件、1,053 处字面量依赖解析一致，未解析项为零；仍有 11 处原有动态路径未静态认证。各选定后端 workspace 的查找路径均没有浏览器包，loader 探针网络尝试为零，验证期间工作区源码指纹稳定。没有执行生产数据库迁移或线上写操作。

迁移期间修复了源码测试继续读取旧转出文件的问题，并保留全部业务断言。行情总线源码测试增加了实现存在性断言，避免仅检查转出文件而误通过。新旧入口身份、跨入口状态及 Worker 行为都有运行时回归。

提交清单包含本阶段累计的 539 个文件，六份用户已有的合场一致性/溢价分析文档或文档改动独立保留。日志与清单位于 `output/venue-browser-final-acceptance-20261020/`；最终前端与源码回归、前端独立构建记录位于 `output/venue-browser-market-hosts-20261020/`。

暂存区 `git diff --cached --check` 唯一提示为新路径 `client/packages/venue-browser/polymarket/submission/pmManualSell.ts:843` 的末尾空行。已通过固定迁移记录还原原文件，确认迁移前后均以两个换行结尾；为保持模块正文逐字一致，保留这一原有格式。没有放宽仓库空白检查规则。

发布策略保持保守：按当前变更计划需要前后端一起发布，并先完成后端。Linux Actions 仍须针对最终提交执行既有发布检查和临时 PostgreSQL 验证，不能将上述 Windows 本地结果当作线上验收。生产安装范围、数据库结构和迁移流程均未改变。本阶段先形成可审阅的本地提交，尚未 push 或部署。
