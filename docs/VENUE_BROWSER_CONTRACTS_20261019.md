# 浏览器隔离：类型与纯规则拆分

> [changmen 扩展] **文档状态（2026-10-22）：历史迁移与验收记录。文中的旧目录、兼容入口、workspace 数量、未提交及未部署状态仅对应各自批次；当前布局见 [WORKSPACE_LAYOUT](./WORKSPACE_LAYOUT.md)，安装与发布见 [INDEPENDENT_DEPLOYMENT](./INDEPENDENT_DEPLOYMENT.md)**

[changmen 扩展] 本批接续未提交的三个纯工具迁移，源码基线仍为 3126c8de。所有本地拆分尚未提交、推送或部署；线上仍为 3126c8de。

## 改动范围

- 将 PolymarketOrderOptions 接口原样迁入 client/packages/venue-browser/polymarket/pmOrderOptions.ts，旧预检入口以 import type / export type 使用并保持对外导出。字段、可选性、tick 类型、版本值域均不变。
- 将 isValidClobPrice 原样迁入 pmPriceValidity.ts，旧检测模块导入并转出同一函数；仍只接受有限且严格位于 0 与 1 之间的价格。
- 将 PolymarketPriceAboveDetectionError 和 isPolymarketPriceAboveDetectionError 原样迁入 pmPriceError.ts。旧报价入口转出同一构造函数和识别函数，保留 name、message、bestAskPrice、detectionMaxPrice 及 instanceof 语义。
- executionMath、executionSimulation、shadowWorkerClient 的五处 import 改用客户端目录。原十个模块对旧 adapter 的直接引用从上一小批的 9 处降至 4 处，已没有类型反向引用。

未调整订单算法、计时、行情缓存、观察槽、Worker 协议、偏好读写、HTTP 请求、实际提交及回写流程。未调整 npm workspace、依赖版本、锁文件、发布范围或数据库；本轮未执行生产部署或数据库迁移。

## 源码与回归保护

venue-browser-contracts.json 登记三个原始定义及精确替换片段，由独立 hash 固定。还原导入/转出后，三个宿主模块必须与固定 Git 起点全文一致；新模块也必须逐字等于原始定义。类型迁出前后，预检模块编译生成的运行时代码另作完整比较，新类型模块不生成运行时依赖。

既有完整源码基线保持不变，上一小批记录和 hash 也保持不变。边界检查会检查所有新定义和五处消费者 import；丢失、篡改、改错目标或追加宿主逻辑都不能通过。

运行测试验证原路径、中间路径、新路径的函数/构造函数身份以及双向 instanceof；原有检测、报价回写、完整前端与算法对照回归继续执行。日志位于 output/venue-browser-contracts-20261019/。

首次完整检查发现两处验证脚本接入遗漏，均已修复：新校验器默认读取路径改为相对自身模块确定仓库根，避免在 adapter 工作区内执行时找错文件；类型还原接入历史检查链的最早入口，使各历史版本继续比较完整原文。另加两个回归，检查子工作区调用及历史入口对新类型篡改的拒绝。未修改历史 hash 或放宽断言。初次失败日志保留为 controls.log、checks.log，复验分别为 controls-recheck.log、checks-recheck.log。

## 最终验证结果

| 检查 | 结果 |
| --- | --- |
| 定向源码、入口身份、历史行为与算法对照 | 7 文件、372 项通过 |
| 验证脚本修复及故障注入回归 | 4 文件、48 项通过 |
| Actions 同命令 verification-control 复验 | 106 文件、2,714 项通过 |
| 完整前端回归 | 524 文件、4,811 项通过；保留原有 3 文件、4 项跳过 |
| test:checks 复验 | 边界、导出、契约、冻结检查及 24 步 catalog smoke 通过 |
| 独立安装、前端类型检查及生产构建 | 8 个 workspace、9 个源码目录，无 server，全部通过；临时目录已清理 |

前端回归与独立构建依次执行，本轮没有测试超时。构建仍有原有大 chunk 和静态/动态导入重叠提示。安装实验关闭 npm 安装生命周期脚本，构建本身按原命令执行；未替代 Linux Actions 或线上验收。各测试组有交叉，不累加数量。未发现本轮引入的业务行为回归。

## 下一步

剩余四处引用分别是深度缓冲偏好、tick 状态、行情观察、订阅资产列表。下一批先确定并迁移两个状态模块的唯一实现，验证新旧入口共享同一状态及通知；随后再处理行情宿主能力。全部反向引用解除且安装闭包验证通过之后，才建立独立 workspace。

上述四处引用为本批验收点；后续状态迁移已在本地继续推进，见 [VENUE_BROWSER_STATE_20261019.md](./VENUE_BROWSER_STATE_20261019.md)。
