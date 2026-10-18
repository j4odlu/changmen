# 后端独立安装：八进程候选验证

[changmen 扩展] 本批建立验证用安装清单和可重复执行的离线实验，不启用生产安装 profile，不调整 archive、组件分类、发布范围、进程启动或回滚。原行情、经典 `legacy` FOK、551 项固定保护、HTTP 预检及本地簿/旁路默认关闭保持。未 commit/push 或部署。

## 解决的缺口

之前的真实定向安装验证以 `@changmen/backend` 为入口，包括开发工具时覆盖 15 个 Node workspace。生产发布还启动独立采集器与行情 hub，不能把单个 workspace 的安装通过当作整个后端发布的充分证据。

`scripts/deploy/backend-install-profile.mjs` 读取现有 `verify-backend-processes.mjs` 的 8 个进程定义，与原 PM2 配置核对名称、工作目录、script 和 Node interpreter。按实际进程所属 package 求包含编译工具的声明依赖集合，未知本地目标、浏览器依赖、漏进程或重定向入口均拒绝。

| 生产进程 | 安装根 |
| --- | --- |
| `changmen-esport` | `@changmen/backend` |
| `changmen-pm-sports` | `@changmen/polymarket-sports` |
| `changmen-polymarket-collector` | `@changmen/polymarket-esports-collector` |
| `changmen-pm-football-collector` | `@changmen/polymarket-football-collector` |
| `changmen-predictfun-collector` | `@changmen/predictfun-collector` |
| 3 个现有 PM/PF market hub | `@changmen/ws-forward` |

当前为 6 个安装根、18 个 Node workspace，包含原 loader、registry、adapter 打包工具与后端编译依赖。已暂停的 SXBet 进程未被启用。CLI 仅输出清单，拒绝额外 install/activation 参数；`productionEnabled:false`、`archiveSlimmingEnabled:false`。

## 可重复的真实实验

运行 `scripts/testing/backend-install-isolation.mjs`，通过 `CHANGMEN_TEST_NPM_CLI` 指定已有 npm JavaScript CLI；可用 `CHANGMEN_TEST_NPM_CACHE` 指向已准备的离线缓存。不会在工作区执行安装。

1. 创建两个全新的系统临时目录，从 Git 跟踪及非忽略候选文件复制必要 Node 源码和原完整 workspace manifests。原 root package/lock 原字节保留；不复制 `.env`、`.npmrc`、私钥或 backend storage。不裁剪或重写锁文件。
2. 对照目录运行全量 `npm ci --include=dev`；候选目录运行原清单生成的六个 `--workspace` 选择和 `--include-workspace-root=false`。两侧均显式 `--offline --ignore-scripts`，不访问包网络、不执行安装生命周期。
3. 精确核对候选 `node_modules/@changmen` 链接等于 18 包清单，不能缺包或带回 browser workspace；两侧运行原路由编译命令。
4. 只读追踪八个真实入口的字面量 import/require，实际解析依赖但不执行服务；对比导入者、目标相对路径、版本和文件 hash，以及未解析/未知输入。两侧有相同未解析字面量目标也会失败，不能只凭“同样缺失”通过。目录 URL 按资源记录，`require.resolve` 使用真实 CJS 规则；出现漂移立即失败，不能通过减少扫描或隐藏未知记录变绿。
5. 在禁止 fetch/Socket.connect 的独立进程内验证浏览器包不可解析、原 loader 模块身份、registry/ESM 预加载、OB/PB/Ray session 与 resolver 导出；不启动 HTTP/WS 服务或连接数据库。
6. 报告绑定当前 commit、文件树及源码输入指纹，核对运行前后稳定；失败结果覆盖旧成功结果，保留本次日志和临时目录便于审查。

纯清单拒绝用例放在现有 `scripts/deploy/*.test.mjs`，随发布控制入口持续执行；解析对比拒绝用例纳入既有 verification suite。完整安装实验本批手动执行，尚未增加到 Actions，也不作为新的生产放行条件。

## 保留的边界

- 定向安装不等于源码瘦包。冻结 loader/registry、adapter 资源、platform-probes 及 HTTP 静态资产继续使用原布局。浏览器 app 只复制 npm 发现 workspace 所需的 manifest；原冻结混合 adapter 的相邻资源仍保留。
- 字面量追踪不证明动态路径闭合。已有 PM loader 持续门禁保留；新报告明确列出可达未知/未解析项，不把“与对照一致”标记为完整运行闭包认证。
- 本机 Windows 的离线、禁生命周期安装不能认证 Linux native optional/postinstall，也没有模拟完整 8 个长驻服务的运行。RDS 仍是独立数据层，本批不执行生产结构维护。
- 生产仍是原 full archive、完整 `npm ci --include=dev` 和既有 8 进程激活；本批不能直接替换该命令。

## 验证记录

输入快照与检查日志在 `output/backend-install-profile-20261018/`；真实安装报告、两侧解析清单及日志在 `output/backend-install-isolation/`。

| 检查 | 本机结果 |
| --- | --- |
| 全新安装 | 全量 849 包；定向 396 包，精确 18 个 Node workspace 链接；原 package/lock 原字节不变 |
| 八进程字面量依赖解析 | 378 个源码文件、1,033 处解析，两侧零漂移、0 未解析目标 |
| 动态输入 | 11 处表达式保留：9 处原 adapter loader、2 处原 DB 查找；未假称完整闭包或为它们新增豁免 |
| 编译与原生加载 | 两侧原路由编译通过；候选 loader 原生模块身份、registry/ESM 预加载、OB/PB/Ray session、resolver 导出通过；浏览器宿主不可解析，网络尝试 0 |
| 持续拒绝检查 | 清单 7 项通过；发布控制 87 项及真实本地回滚集成通过 |
| 相关专项 | 3 文件 50 项通过；加入原 PM loader 来源/共享证据回归后 5 文件 146 项通过，集合有重叠不相加 |
| 原保护与边界 | FOK 等价、完整 551/551 与边界检查通过；原路径、内容和 manifest/hash 不变 |

初次扫描把合法目录 URL 当作文件、把 `require.resolve("iconv-lite/encodings")` 按 ESM 规则处理，产生两条工具误报；原安装和业务文件均正常。已保留初始报告，修正验证器并增加真实临时目录及缺失目标拒绝用例；最终两份全新安装重新完成后，上表未解析数为 0。未改 matcher 业务或其它历史脚本。

本批仅新增验证清单、字面量解析及离线实验等 5 个代码文件，没有业务源码、依赖声明、锁、工作流、实际安装/激活规则变化。没有为纯验证新增内容重建前端或重复完整 22 阶段；上一批完整审计仍是上一份输入的历史证据，正式提交仍需实际 Actions 对最终候选验收。当前机器身份及完整结果见 `result.json`，未提交候选不能正式封包。

## 当前安排与结论（2026-10-18 收口）

**Windows 离线安装与解析对照通过；精简安装优化暂缓，生产继续全量安装。** 以下事项仅在未来重新推进精简安装时处理，不是当前源码隔离候选沿用全量部署的前置条件；本地 WSL 不作为发布要求：

1. 在 Linux CI/隔离环境复现同一 profile，核对 npm/Node 身份，并验证原生命周期及 native optional 依赖；Windows `--ignore-scripts` 结果不能替代。
2. 在隔离配置下验证现有 8 个长驻入口的启动/健康与失败处理，控制网络和数据写入；本批不启动它们，不把解析成功当作运行成功。
3. 将安装报告与候选、锁、构建及完整运行资源清单绑定。冻结目录和 loader/HTTP 静态资源必须完整；若之后瘦包，另做 archive 内容与路径验证。
4. 另行评审 Actions/远端命令的切换及失败回滚证据，再启用 profile。原全量发布流程继续保留，独立发布 C–E、本地簿生产旁路均未因此放行。

随后进行过一次可选 Linux 实验：安装生命周期、原生工具执行及依赖解析对照通过，但八进程运行验收因临时 PredictFun 配置缺少 API key 而超时，不能宣称完整运行通过，也不能据此推断生产故障。实验已停止，子进程全部退出、临时数据库已关闭。新增四个 Linux 实验脚本已按原路径和 SHA-256 可恢复归档到 `output/source-isolation-closeout-20261018/archived-source/`，不在待提交范围；原始失败结果保留。

前一批已完成的五个安装清单/解析/测试文件保留，仅作验证工具，不启用生产 profile。此前已授权的 Actions 验收绑定和同次验证复用继续保留；本次没有增加门禁、修改安装命令或触发工作流。当前优先收口累计改动与文档，见[候选收口记录](audits/SOURCE_ISOLATION_CLOSEOUT_20261018.md)。
