# 浏览器 adapter 隔离：纯工具模块

[changmen 扩展] 以 3126c8de0462aaca96b96be432618fd852285755 为起点，继续解除客户端实现对旧 adapter 的反向依赖。本批暂未提交或部署。

## 改动

将 pmTickPrice、pmBuyOrderShares、pmMarketOrderOptions 的唯一实现迁入 client/packages/venue-browser/polymarket/。原 quotes/、submission/preflight/ 路径仅转导出，更早的 polymarket 根入口不变。

三个模块只在内部引用 tick 工具，不再依赖旧 adapter。bookMetadata、executionMath、executionSimulation 共四处 import 改用这些本地实现；没有改动计算公式、精度、舍入、输入校验、异常类型或错误消息。

没有修改行情订阅、缓存、Worker 生命周期、实际交易流程、数据库结构或数据，也没有调整 package.json、lockfile、workspace、发布范围或依赖版本。

## 验收方式

- venue-browser-leaves.json 登记三个完整源文件、四处 import 变更及三项兼容入口；独立 hash 固定记录。
- 新位置源码逆转 import 后必须逐字等于本批起点；既有更早基线继续比较完整原文，不替换基线或放宽目录规则。
- 旧入口加实现、转错路径、新实现丢失或修改，以及未登记的消费者改动，均在检查中失败。
- 运行测试比较旧入口、中间入口、新入口的函数身份；既有 tick、原始算法对照和前端回归继续覆盖原行为。
- 独立前端安装实验包含新目录，在没有 server 源码的临时目录完成类型检查及生产构建。

本机验证日志位于 output/venue-browser-isolation-20261019/leaves-*.log。

| 检查 | 结果 |
| --- | --- |
| 迁移、身份、历史基线与算法定向回归 | 8 文件、389 项通过 |
| Actions 同命令 verification-control | 105 文件、2,707 项通过 |
| 前端完整回归（单独复验） | 523 文件、4,809 项通过；原有 3 文件、4 项跳过 |
| test:checks | 边界、导出、契约及 24 步 catalog smoke 通过 |
| 独立前端安装、类型检查和生产构建 | 8 个 workspace、9 个源码目录，无 server；全部通过，临时目录已清理 |

第一次将完整前端回归与构建等检查并行执行时，三个既有用例发生 5 秒/10 秒超时。其它检查结束后，不改代码、不改测试时限，使用同一命令单独复跑，完整回归通过；初次日志保留为 leaves-frontend.log，复验为 leaves-frontend-recheck.log。构建仍有原有大 chunk 和静态/动态导入重叠提示。不同测试组存在交叉，不累加数量。

## 剩余工作

当前目录仍归 @changmen/venue-adapter workspace，尚不能单独安装。原十个模块指向旧 adapter 的直接 import 从 13 处减少至 9 处（6 处运行时引用、3 处类型引用）。

后续顺序：抽离订单参数类型及纯规则/错误类；明确深度偏好和 tick 状态的唯一所有者；再设计行情观察、订阅资产列表等宿主端口。所有状态都必须保持单实例和原初始化、订阅、清理时序。消除反向依赖之后，才建立独立 workspace。

后续类型与纯规则拆分已在本地继续推进，最新状态见 [VENUE_BROWSER_CONTRACTS_20261019.md](./VENUE_BROWSER_CONTRACTS_20261019.md)。本文件的 9 处引用及验证数字描述前一小批的验收点。
