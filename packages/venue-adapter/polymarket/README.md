# Polymarket 场馆模块

[changmen 扩展] 2026-10-14 按用户授权，在现有官方判定上恢复价格提前判定（覆盖 10-12 的仅官方策略）：客户端和服务端优先认 CLOB `tokens[].winner === true`；缺少官方赢家时，`outcomePrices` 中唯一价格 ≥0.99 的 token 提前判赢、其它 token 判输。价格必须在 [0,1] 内且与 token 完整一一对应。价格判定沿用原输赢/盈亏回写，但不写 `pmSellState=settled`，保持卖出能力；官方结果到达后可覆盖价格结果并正式结算。部分卖出按剩余仓位核算，卖光只更新赛果、不覆盖卖出盈亏。市场关闭或 `proposed` 本身不能判赛果；现有下单价格风控不变。

这次策略修改独立于下述目录迁移，两个受影响完整模块由 `scripts/verification/pm-settlement-policy-boundary.mjs` 精确核验。其余模块继续使用原迁移、FOK/VPS 基线；原冻结清单和基线提交不变。

[changmen 扩展] 2026-10-11 按功能整理现有实现，后续细分 orders/submission 并迁移根目录测试。本次只移动完整文件和调整相对模块引用，不改变函数、订单状态、请求、等待、重试、调度、持久化或首次双腿流程。下表实现文件数包含子目录，不含测试及兼容出口。

| 目录 | 职责 | 文件数 |
| --- | --- | ---: |
| `fok/` | 原 FOK provider、成交确认、确认任务和深度设置 | 4 |
| `gtc/` | 已有 GTC 提交准备、下单及事实读取 | 保持原样 |
| `auth/` | API 凭证、L2 鉴权、账号公开身份 | 3 |
| `wallet/` | 余额、合约、Deposit Wallet、RPC、Relayer 和钱包准备 | 8 |
| `transport/` | 端点、HTTP 出口、出海选择及可达性 | 8 |
| `markets/` | 市场索引、采集、解析、体育发现及市场资格 | 9 |
| `quotes/` | 行情总线、报价写入、价格转换和 tick 状态 | 9 |
| `realtime/` | 市场/用户 WebSocket、报文解析、连接及来源设置 | 10 |
| `orders/` | 原单/成交读取、状态解释、确认上下文、费用、同步及持仓事实 | 17 |
| `submission/` | 下单预检、签单准备、报价约束、手动卖出和未知提交恢复 | 12 |
| `diagnostics/` | 订单追踪和执行/市场指标 | 3 |

FOK/GTC 只是 PM 下单模式；共用模块按功能归类，不各复制一套。`orders/confirmation/legOutcome.ts`、`orders/confirmation/marketDelay.ts` 等仍保持原确认语义；目录归类不把这些能力扩展为新的监控或编排。

较多的订单与提交文件进一步分组：

| 子目录 | 现有职责 | 实现文件数 |
| --- | --- | ---: |
| `orders/facts/` | 状态/类型、成交后证据、交易哈希和失败事实 | 5 |
| `orders/history/` | 订单历史、activity、存储订单加载和同步窗口 | 5 |
| `orders/confirmation/` | 原腿确认、市场延时上下文和原心跳能力 | 3 |
| `orders/positions/` | 逻辑持仓与订单来源 | 2 |
| `submission/preflight/` | 预检、检测价、下单选项、金额与份数 | 5 |
| `submission/client/` | Builder、提交时钟、签单客户端缓存和提交模式 | 4 |
| `submission/recovery/` | 原提交日志及未知提交恢复 | 2 |

`orders/` 直接保留 `pmClientApi.ts`、`pmFee.ts`；`submission/` 直接保留 `pmManualSell.ts`。完整文件名和函数体不变，不因目录名增加流程或拆分函数。上一轮新增的内部平铺路径没有生产消费者和 package exports，本次直接更新根兼容出口及兼容测试至新实现，不叠加一层兼容文件。

根目录 `index.ts` 和原模块路径继续保留。根目录旧模块只有一次 `export *`，完整实现位于对应功能目录；新旧路径共享函数、缓存、配置、监听器和任务。实现内部的相对依赖仍指向原模块入口，保留原调用方及测试 mock 的路径和动态加载时点。没有新增功能目录的聚合 `index.ts` 或框架注册。

原根目录 72 个测试迁入 `tests/` 并按功能分组，见 [测试目录说明](tests/README.md)。原测试路径不留测试壳，避免重复执行；静态/动态引用、mock 目标和断言保持，只有两份源码契约测试的根目录定位随位置调整。`gtc/` 原实现及相邻测试不动。

实现精确映射见 `scripts/verification/pm-functional-source-relocation.mjs`；`node scripts/verification/verify-pm-functional-relocation.mjs` 恢复旧相对引用后逐文件全文核验。测试映射及 mock 路径迁移见 `scripts/verification/pm-test-source-relocation.mjs`。既有 FOK/VPS 检查仍读取迁移后的完整源码，固定基线不变。根目录从 158 个文件减少至 86 个，保留的 TypeScript 文件主要是原公开入口兼容出口。

迁移是本地位置调整，不代表整批未提交改动已具备发布条件。上一轮范围与验收证据见 `output/pm-functional-folders-20261011/`；后续子目录与测试迁移证据见 `output/pm-subfolders-20261011/`。
