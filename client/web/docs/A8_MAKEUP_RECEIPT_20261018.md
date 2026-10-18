# A8 基础与双腿结果表验收（2026-10-18）

## 业务规则

[A8 可证实] 以本地 `A8/index0706.js` 为基础：普通馆到指定时间才检测；手动补单与 `waitTime=-1` 保持接口成功消费、不额外检测；拒单继续下一候选；每次成功只消费一次配置次数。基准回放继续使用 `src/stores/betting/makeupConsumer.fixture.ts`。

[changmen 扩展] 按用户确认的结果表：PM `delayed` 是提交成功、拒单检测未结束。PM 持续检测，传统馆按原有时间检测；先确定的一腿保存结果，等另一腿。超时策略判拒按拒单处理。

| PM | 另一腿 | 处理 |
|---|---|---|
| 成交 | 等待检测 | 继续等 |
| 成交 | 未拒单 | 完成 |
| 成交 | 拒单 | 补另一腿 |
| 拒单（含超时策略判拒） | 未拒单 | 补 PM |
| 拒单 | 拒单 | 结束，不补 |

## 本次修复

- [changmen 扩展] 传统馆已受理的回执与 PM 一样独立于队列取消。旧队列取消或被替换后仍检测、绑定原 Link、记录原账号次数；不会删除或扣减新队列。
- [A8 可证实] 传统馆恢复收尾顺序为：检测 → 绑定/安排补绑 → 计数 → 消费队列。通知在业务收尾之后执行。
- [changmen 扩展] 受理后先保存原回执。新增的 `pendingRegularReceipt` 只记录固定检测时刻、已确定的拒单结果及实际绑定 ID。刷新后未检测的只等剩余时间；已检测的直接收尾，不查询最新订单重新改判，也不重新下注。
- [changmen 扩展] 传统馆没有即时返回 orderId 时仍保留受理回执，检测后记录真实订单 ID。赛事离盘的清理不会删除仍待收尾的原回执。
- [changmen 扩展] 队列仍存在时沿用 A8 的同盘口禁止新增套利规则；没有新增经典 FOK 预检、历史查询等待或手工准备门控。

两腿检测的生产编排本轮未改。新增组合测试验证 PM 先完成后仍等待另一腿，并在双方都有结果后使用实际配对函数判定补单方向。原有 PM 超时判拒、成交证据矛盾、手动多次补单、免检测等测试继续运行。

## 验证与边界

- 两项先前失败的 OB 复现已转为永久回归；绑定等待时可从会话恢复原回执，取消后原单正常绑定和计数。
- 额外覆盖：普通馆无即时 orderId、刷新时只等剩余时间、剩余时间为零仍检测、确定结果不改判、查询失败续查不重下、补单关闭仍收尾已受理原单。
- 完整固定 FOK 基线仍为 `219535c8` 与 VPS `75b1efac66625e5f2bc9884a965b244bfaf337ed`，逐项登记本次精确变更，不替换旧哈希或豁免目录。

本次保证以本地收到受理回执且浏览器存储可用为前提；不承诺在回执到达前页面退出、存储完全不可写时仍能恢复。本轮没有扩展既有内存补绑队列为跨刷新持久化系统。

未提交、未推送、未发布。测试结果与日志见本文件后续验收记录。

## 验收记录

- 双腿结果表、原回执恢复、取消重建、绑定等待、经典手动/免检测路径：161 项行为回归通过；独立 RAY 订单轮询用例通过。
- A8/FOK 精确边界：7 个测试文件、238 项通过（`output/a8-finalize-boundaries.log`）。
- `node scripts/verification/verify-fok-execution-parity.mjs`：180 项比较、20 项确认故障场景、45 项原有门控场景通过（`output/a8-finalize-fok-parity.log`）。
- `npm run check:fok-vps`：551 个原固定文件全部校验通过（`output/a8-finalize-fok-vps.log`）。
- 全仓 `npm test`：14 个任务成功；前端 515 个文件、4611 项测试通过，3 项跳过（`output/a8-finalize-full-regression-final.log`）。
- 前端 `vue-tsc -b`：通过（`output/a8-finalize-typecheck-final.log`）。

## 查询异常与取消交错修复

[changmen 扩展] 已受理原单的查询异常不等于拒单。此前初次检测直接抛错、后台检测仅给当前队列退避，旧队列取消后会丢失原单后续核验。本轮将 PM/PF 与普通馆的异常续查统一交给同一个原单任务；无论异常先发生还是取消先发生，都只继续核验原单，不调用下注接口。

任务按原队列对象去重；主循环识别已经存在的续查任务，避免同时恢复同一笔原单。普通馆沿用原定检测时刻，只等待剩余时间；确定结果后仍走已有绑定、计数及队列消费。PM 超时策略判拒照旧按拒单结束核验，抛出的查询异常才继续重试。账号、凭据或登录会话撤销后停止任务；续查进行中撤销，也不会继续绑定、计数或修改新队列。

新增 59 项行为测试覆盖：初次检测/刷新恢复、OB/PM/RAY（含无即时 orderId）、保留/取消/替换队列、异常前后取消、连续两次查询异常、账号/凭据/会话撤销，以及计数/通知异常不重开已完成原单。原始 PM、OB 两个失败复现已通过（`output/makeup-query-reproductions.log`）。

本轮日志：`output/makeup-query-behavior-final.log`、`output/makeup-query-typecheck-final.log`、`output/makeup-query-boundaries.log`、`output/makeup-query-fok-parity.log`、`output/makeup-query-fok-vps.log`、`output/makeup-query-full-regression.log`。继续保持未提交、未推送、未发布。

最终结果：全仓 14 个任务成功；前端 515 个文件、4670 项测试通过，3 项跳过；类型检查通过；255 项精确边界测试通过；经典 FOK 的 180 项比较、20 项确认故障、45 项原有门控场景通过；VPS 551 个固定文件全部核验通过。

## 场馆结果不能被上报失败覆盖

[A8 可证实] `index0706.js` 中 `uv.updateOrders` 先将场馆结果赋给 `e`，`saveOrders` 的异常在内部捕获，最后的 `return e` 位于 `catch/finally` 之后。因此，上报失败时仍保留已经查到的拒单或未拒单事实。

此前 changmen 的 `syncVenueOrders` 将保存异常抛给外层 `updateVenueOrders`，外层返回 `undefined`。普通馆确认层将其归为空列表，造成明确拒单被当作未拒单、补单队列被消费。独立复现包含 A8 原方法回放：修复前 2 项对照通过、1 项拒单保留失败；修复后 3 项全部通过（`output/makeup-real-sync-review-after.log`）。

本轮在 A8 刷新入口保留已获取的场馆结果；底层 `syncVenueOrders` 的失败抛错约定保持不变，直接调用方仍能执行原有会话保护。不增加拉单次数、等待、新下注或经典 FOK 门控。查询本身失败时的原有返回约定保持不变；正常空列表也保持 A8 语义。RAY 的持久化关联收尾仍只在正常保存完成后运行，保存失败时不会误记已保存。

新增 20 项永久回归：OB/RAY/PM 的拒单与未拒单、上报失败时保留统计和原 Link、正常空列表、查询失败的原返回约定，以及普通补单与原始套利腿经过真实订单同步链路的检测结果。旧固定基线和增量哈希均保留；只登记本次保存异常分支的精确修正。

最终实现保留底层同步抛错；已有的跨登录会话保护和 RAY 保存失败禁止认领绑定回归原样通过，没有通过放宽断言来取消保护。真实同步链路及这两个调用方共 49 项通过；精确边界 138 项通过；A8 原函数对照 3 项通过。

验证日志：`output/makeup-save-before-fix.log`、`output/makeup-save-behavior.log`、`output/makeup-save-real-chain-final.log`、`output/makeup-save-boundary.log`、`output/makeup-save-typecheck-final.log`、`output/makeup-save-fok-parity-final.log`、`output/makeup-save-fok-vps-final.log`、`output/makeup-save-full-regression-final.log`。本轮仍未提交、推送或发布。

最终验收：全仓 14 个任务成功；前端 515 个文件、4690 项测试通过，3 项跳过；类型检查通过；经典 FOK 180 项比较、20 项确认故障和 45 项原有门控场景通过；VPS 551 个固定文件全部校验通过。继续审查该异常分支及其调用方，未发现新的可复现补单问题。

## 确认型原单先保存结果再收尾

[changmen 扩展] A8 不含 PM；PM 的 delayed 检测与恢复属于 CHANGMEN 扩展。场馆层继续负责查询并输出待确认、成交或拒单，编排层负责记录结果、配对及收尾。本轮没有修改场馆检测实现。

已复现问题：PM 成交后等待 Link 绑定回执时刷新，旧队列只保留待确认原单，恢复后再次查询。后续查询耗尽触发超时判拒，原本已经成交的目标腿又进入补单。原独立复现的两个对照在修复后全部通过（`output/makeup-terminal-reproductions.log`）。

修复将确定结果写入队列的 `pendingVenueReceipt`，先保存到现有 sessionStorage，再开始异步绑定与拒单记录保存。回执绑定原单 ID 和账号，包含确定结果、实际绑定 ID 与诊断消息。恢复只完成绑定、计数和队列消费，不重新调用场馆检测；超时策略判拒的诊断仍保留。仍待确认的原单不保存终态，继续原单检测，不发送新下注。

同一原单的更新保留终态，更换原单或账号时清除；消费一次队列后清除，避免影响下一次配置消费。构造恢复对象时校验原单和账号一致。原队列取消或替换后，旧收尾不写入新队列。

新增 11 项永久回归覆盖：刷新后正常查询／超时的原复现、目标腿与锚腿的成交／拒单／超时策略判拒、未决原单续查，以及终态保存恢复和原单身份隔离。终态先保存、绑定后计数、一次消费及传统馆原等待规则保持原样；固定基线与旧增量哈希均未替换。

日志：`output/makeup-terminal-behavior-final.log`、`output/makeup-terminal-boundary-final.log`、`output/makeup-terminal-typecheck-final.log`、`output/makeup-terminal-fok-parity.log`、`output/makeup-terminal-fok-vps.log`、`output/makeup-terminal-full-regression.log`。恢复保证仍以受理回执已到达且浏览器存储可用为前提；本轮未将现有内存补绑队列扩展为跨刷新存储。未提交、推送或发布。

最终验收：全仓 14 个任务成功；前端 515 个文件、4701 项测试通过，3 项跳过；类型检查通过；267 项精确边界测试通过；经典 FOK 180 项比较、20 项确认故障和 45 项原有门控场景通过；VPS 551 个固定文件全部校验通过。
