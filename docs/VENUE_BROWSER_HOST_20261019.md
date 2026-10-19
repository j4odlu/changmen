# 浏览器隔离：只读行情宿主拆分

[changmen 扩展] 本轮解除 client/packages/venue-browser 对旧 adapter 的最后两处直接引用。前几批本地改动一并参加验证；未提交、推送、部署或执行数据库迁移。

## 实现与行为

浏览器目录的 pm-book-source.ts 现在提供 createReadonlyMarketSource，只接收 observe 和 subscribedAssets 两个函数并冻结对象。没有创建时读取、订阅、注册全局宿主或可重新配置状态。

packages/venue-adapter/browser/pm-book-source-host.ts 负责接入现有行情源，在模块加载时调用工厂一次。observe 字段直接使用原 observePmMarketStream 函数；subscribedAssets 每次调用 getPolymarketQuoteConsumerAssetIds("esport")，不缓存资产列表。原公开 polymarket/orderBookSource 入口和中间 browser/pm-book-source 入口转出同一冻结对象。原模块导入行情观察、报价 hub 的先后顺序保持不变。

client/packages/venue-browser/pm-book-source.ts 是内部源码路径，并非 package exports。其导出从绑定宿主的 pmOrderBookSource 改为纯工厂，唯一直接引用旧导出的兼容性测试已更新为检查宿主对象。应用仍使用原公开入口，调用方和生命周期代码没有改动。

订单计算、预检、默认开关、Worker 创建、订阅权限、账号、服务端和数据库代码均不在本轮业务修改范围。行情通知、即时状态回调、异常传递与取消观察沿用原函数。

## 校验方式

venue-browser-host.json 固定工厂、兼容入口、宿主接线和一项归属清单变更。校验器精确验证新源码，再还原此前完整源码，继续执行既有历史基线检查。旧记录和 hash 不变，没有扩大目录豁免。

回归覆盖公共入口身份、冻结属性、创建时无资产读取、资产集合实时变化、esport 参数、观察函数身份、即时状态、后续通知、取消监听、原 disposer 和异常传递。依赖检查扫描全部浏览器 TypeScript 文件，只允许目录内引用及两个既有基础包，防止直接反向依赖重新出现。

本目录仍归现有 @changmen/venue-adapter workspace；workspace 清单、package exports、依赖与锁文件保持不变，发布范围继续保守处理。下一轮再建立独立 workspace，并同步安装闭包和发布检查。

以上为宿主拆分完成时的状态。后续独立 workspace 注册见 [VENUE_BROWSER_WORKSPACE_20261019.md](./VENUE_BROWSER_WORKSPACE_20261019.md)。

## 验证记录

日志目录：output/venue-browser-host-20261019/。

| 检查 | 结果 |
| --- | --- |
| 宿主、兼容入口及完整源码定向检查 | 5 文件、17 项通过 |
| Actions 同命令 verification-control | 108 文件、2,721 项通过 |
| 完整前端回归 | 526 文件、4,818 项通过；原有 3 文件、4 项跳过 |
| test:checks | 边界、导出、契约、冻结检查及 24 步 catalog smoke 通过 |
| 独立安装、前端类型检查与生产构建 | 8 个 workspace、9 个源码目录，无 server；全部通过 |
| git diff --check | 通过 |

各组存在重叠，不累计测试总数。本机验证不替代 Linux Actions、真实登录操作或线上验收。

本轮验证没有失败或超时。独立安装使用 npm ci --offline --ignore-scripts，随后按原构建命令执行 vue-tsc 与 Vite；锁文件不变，临时目录已清理。原有大 chunk 及静态/动态导入重叠提示仍存在。未发现本轮业务行为回归。
