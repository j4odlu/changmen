# FOK/RAY 旧版恢复与 GTC 成交历史隔离修复

日期：2026-10-10。**[changmen 扩展]** 用户授权修复详细比较报告中的 F01 / F02，使 FOK 保持加入 GTC 配置前的交易行为。

后续状态：本报告保留第一轮 F01 / F02 修复记录。用户随后要求继续对齐，F03 / F04 的共享保存与混合分组已进一步隔离，并加入实际 PostgreSQL 对照和并发验证，见 [共享边界隔离验收](./FOK_SHARED_ISOLATION_2026-10-10.md)。

两个已复现差异已消除：RAY 收尾/监控回到旧版内容；GTC 成交不再写入 FOK 的计次、已用账号或 lastOdds。新实现经过旧/新实际模块的离线对照及完整前端回归。没有向场馆下单、撤单，没有写生产数据库、部署、commit 或 push。

## 基线与改动范围

主基线为 `219535c8`，2026-10-09 15:36，尚未增加 GTC 配置选项。此前只占位、不实际执行 GTC 的 `75b1efac` 对这些 FOK 业务文件也没有改变。

恢复的业务源码：

- `client/web/src/stores/betting/autoBet/phases/finalizeArbBet.ts`；
- `client/web/src/extensions/arbBet/rayRejectMonitor/runtime.ts`；
- `client/web/src/extensions/arbBet/rayRejectMonitor/match.ts`；
- `client/web/src/extensions/arbBet/rayRejectMonitor/autoMakeup.ts`；
- `client/web/src/extensions/arbBet/rayRejectMonitor/types.ts`。

以上文件恢复为 Git 基线内容，未在旧 FOK 监控中保留新增提前查单开关。相应 RAY 测试也恢复到基线；收尾测试另增加“原等待期间没有监控注册、完成确认后仅注册一次、随后才检查补单”的防回归断言。

恢复前文件保存在 `output/fok-ray-before-restoration-20261010/`，含 manifest，便于追溯。未覆盖工作区其它既有管理端、SDK、后端和账号修改。

## F01 修复结果

恢复为：

```text
place（含原有重试）结束
→ settleBothArbLegs（原等待/查单/绑定）
→ 取消失效锚腿的原补单队列
→ 注册 RAY 旁路监控
→ 原补单/计次/通知收尾
```

移除首次确认前的独立 1 秒查单、两阶段注册交接，以及与提前查单一并出现的匹配、保存、刷新、补单调度变化。传统 RAY 后续延迟拒单监控及其旧轮询机制仍保留。

运行旧版和当前实际 `finalizeArbBet`，使用相同依赖 mock：PM＋OB、PM＋RAY、RAY＋PM、RAY＋RAY 四个组合的调用序列和注册参数均一致。不同组合的“依赖相同”不等于真实场馆响应已实盘验收；源码恢复提供更强的本地等价证据。

## F02 修复结果

新增 `client/web/src/orderModes/gtc/successMarkers.ts`，保存 GTC 自己的：

- 次数：`PM_GTC_V2_COUNT` 命名空间；
- 已用账号：`PM_GTC_V2_ACCOUNTS` 命名空间；
- lastOdds：`PM_GTC_V2_ODDS` 命名空间。

历史按 owner/账号/盘口/方向隔离；同 execution/leg 有独立去重键。V2 是内部状态格式版本，产品执行范围仍为 GTC V1。旧 `PM_GTC_V1_COUNT` 键不阻止在独立存储中恢复已经确认的原单。

`pmGtc/runtime.ts` 不再 import 或调用 FOK `markSuccessfulBet`。列表恢复、原单迟到成交、对侧确认、手动 GTC 都使用独立标记；不修改 FOK 的 `successMarkers.ts`、`betTiming.ts`、`betFilters.ts` 或 `prepareArbAttempt.ts`。

自动 GTC 在原始双腿发送前检查其独立最大次数、lastOdds 和 noSameBet 反向账号限制，避免只隔离写入后把 GTC 自身的历史限制取消。这是发送前安全复核；GTC 仍复用既有预检/选号，不声称已经实现完全独立的 GTC 候选账号选择器。该新增复核只在 GTC 模块调用，FOK 不增加导入或条件分支。

重复原单事实只记一次；未确认/零成交/未知费用的 PM 及未确认的对侧不计成功。与当前登录用户不符的记录不写历史。

原反例修复后，当前选择 FOK，旧 GTC 5 份成交、本金 2.5、手续费 0：

| FOK 状态 | 成交前 | GTC 写入后 |
| --- | --- | --- |
| 同账号/盘口/方向次数 | 0 | 0 |
| lastOdds | 无 | 无 |
| 最大次数检查 | 通过 | 通过 |
| 新赔率 1.8 的检查 | 通过 | 通过 |
| 已用账号 | 空 | 空 |

相同原单在 GTC 独立历史中计次为 1。额外真实模块回归覆盖：已有真实 FOK 次数/赔率、双腿、重复事实、手动来源、切回 FOK 后迟到成交、旧 V1 键、恢复、零/未确认成交、不同 owner；FOK 状态均保持原值。GTC 的最大次数、赔率和反向账号限制仍能阻止新的 GTC 发送。

## 验证结果

| 检查 | 结果 |
| --- | --- |
| 旧版关键文件内容对照 | 21 个 FOK 业务文件与 `219535c8` 内容一致（比较规范化换行） |
| PM 既有函数体 | 29 个全部一致 |
| 网关预检、发送、自动入口、手动入口 | 4 个函数按 FOK 条件选择后的 AST 均与旧版一致；手动模式选择界面仍是已授权变化 |
| 实际自动入口差异执行 | 16 场景通过，含失败、异常、过滤和 9999 释放 |
| 实际收尾差异执行 | 4 个组合全部一致 |
| 实际 GTC/FOK 历史模块隔离复现 | 原反例不再改变 FOK 状态或筛选结果 |
| 完整前端/适配器测试 | 426 个测试文件通过、1 个跳过；3139 项通过、1 项原有跳过 |
| 测试格式整理后针对性复核 | 4 文件、59 项通过，与完整回归有重叠，不累计 |
| 前端类型检查 | `npm run typecheck:frontend -- --force` 通过 |
| 修改模块 lint | 通过 |
| 客户端/服务端边界 | `npm run check:boundaries` 通过 |
| 生产构建 | `npm run app:build` 通过；包含前端类型检查和 Vite 生产构建 |

复核产物：

- `output/verify-fok-design-fix-20261010.mjs` 和 `output/fok-source-comparison-fixed-20261010.json`：关键文件断言、29 函数及 4 分支结果。
- `output/verify-fok-runtime-fix-20261010.mjs`：断言 16 个入口场景和 4 个收尾组合一致，并运行实际独立 GTC 标记和实际 FOK 筛选模块。
- `output/fok-execute-differential-fixed-20261010.json`、`output/fok-finalize-differential-fixed-20261010.json`、`output/fok-gtc-isolated-state-fixed-20261010.json`。
- `output/fok-fix-full-frontend-tests-20261010.log`、`output/fok-fix-production-build-20261010.log`。

2026-10-09 的比较 JSON 和反例保留原样，不改写历史失败证据。

## 兼容边界

旧实现已运行的浏览器会话可能已把 GTC 计次写入 FOK 键，并覆盖旧 FOK lastOdds。这些聚合值没有完整来源日志，不能无损还原。因此不删除、不猜测扣减真实 FOK 历史。本修复阻断新写入，并从持久化事实恢复独立 GTC 历史；旧会话污染不属于已经完成的回溯修复。严格旧版对照固定初始状态，并覆盖新会话及已存在真实 FOK 历史的情况。

本次没有改变详细比较中的共享 SQL（F03）及混合组处理（F04），其有条件兼容/未进行真实 PostgreSQL 并发验证的边界仍保留。新增 PM 手动模式选择器、按 GTC 订单身份显示按钮及旧挂单持续核对都是用户要求的功能变化。

可以确认两个已复现的 FOK 行为差异已消除、相关旧交易模块和离线轨迹一致；不能据此声称整个产品界面、所有历史会话、数据库性能和所有线上响应“绝对一样”。
