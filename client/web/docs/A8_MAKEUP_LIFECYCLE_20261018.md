# 补单完成、恢复与计数核验（2026-10-18）

本次修复限于 `loseOrder` 消费、原单确认收尾和队列持久化；不改提交参数、价格/金额计算、场馆状态判定或经典 FOK 预检。尚未发布。

## 行为依据与边界

- [A8 可证实] 本地参考 `A8/index0706.js` 的 `jb`：普通馆到指定时间再查拒单；手动补单、`waitTime=-1` 按接口成功消费；拒单继续下一个候选；每次只消费一次 `betCount`；已受理的补单检测结束后记录账号次数。对应行为 fixture 为 `src/stores/betting/makeupConsumer.fixture.ts`。
- [changmen 扩展] PM `delayed` 是提交成功、拒单检测未结束；继续核验原单。成交后结束该腿，策略超时判拒按拒单处理。有矛盾的部分成交证据仍由既有 adapter 策略处理，本次不改此策略。
- [changmen 扩展] 已受理原单的确认和绑定独立于补单队列；取消/重建只控制后续补单，不删除旧单事实、不扣新队列次数。
- [changmen 扩展] PM/PF 确认路径先保存已收到的原单 ID；PM 另保存原始 USDC 提交快照，恢复时不以人民币计划额推算原单。

## 本轮两个根因

1. 完成后只把 ID 加入批量删除集合，等其它队列也处理完才保存出队。在另一盘口等待时刷新，会读到已成交的旧队列并重发。现在每笔完成时立即消费并保存，清除原单锁和扣减次数合并为一次 `LOSEORDER` 写入。
2. 原账号计数依赖旧队列仍存在。等待回执或绑定时取消/重建，旧单虽然成交和绑定成功，却跳过计数。现在在确认收尾中按原账号、原方向计数；队列身份检查只限制队列修改。同一结果对象重复收尾不会重复计数。

## 验证矩阵

| 路径 | 核验结果 |
|---|---|
| PM 完成，另一个盘口仍在预检等待，随后刷新 | 已保存出队，不重新提交 PM |
| PM 受理，检测尚未结束 | 确认前已保存原 ID 和 USDC；恢复只续查原单 |
| 发送/绑定/金额恢复过程中取消或重建 | 旧单仍确认、绑定、计数；新队列金额和次数不变 |
| target 成交或判拒；anchor 成交或判拒 | target 检测结束计数；anchor 仅成交计数；保留原方向 |
| 待确认、账号/凭据/会话撤销 | 待确认不计数、不重复提交；撤销后停止脱离队列的续查 |
| 手动次数为 3；同轮有多个候选 | 每轮只消费一次；依次剩余 2、1、删除 |
| 日志、通知、计数或保存出队时异常 | 已完成的内存消费不被重新开放；绑定失败保留重试项 |
| PM 超时策略判拒 | 清原锁，恢复正常补单候选流程 |
| 普通馆指定时间检测；手动/免检测成功消费 | 保持 A8 行为 |

行为测试：`loseOrder.test.ts`、`loseOrderStore.test.ts`、`pmSubmissionRecovery.test.ts`、`runArbBetRound.test.ts` 及完整前端回归。固定基线检查保留 `219535c8` 与 VPS `75b1efac66625e5f2bc9884a965b244bfaf337ed`，在旧登记之后叠加本次逐项固定变更，没有替换旧哈希或豁免目录。

这些测试覆盖已收到受理回执的恢复路径。页面在收到回执前退出、浏览器存储完全不可写或已取消原单的内存观察任务随页面退出而消失，不在本次刷新恢复保证范围内；没有新增经典 FOK 历史查询门控或持久化全局计数台账。

## 本机验收结果

- `npm test`：14 个任务成功；前端 515 个文件、4595 项测试通过，另有 3 项跳过。
- `npm run typecheck:frontend`：通过。
- 补单、恢复、队列持久化与轮次行为：106 项通过（`output/pm-lifecycle-behavior.log`）。
- A8/补单/FOK 精确边界：6 个文件、202 项通过（`output/pm-lifecycle-protection-final.log`）。
- `node scripts/verification/verify-fok-execution-parity.mjs`：180 项比较、20 项确认故障、45 项原有门控场景通过。
- `npm run check:fok-vps`：551 个原固定文件全部校验通过。
- 另行运行的 `pm-legacy-input-parity.test.mjs` 有 1 项既有差异：`server/collectors/polymarket-sports/parse_sport.js` 的 `elapsed` 已在当前 HEAD 提交 `1a0f4c02` 中从 truthy 判断改为 `!= null`，旧线上快照仍是 truthy 判断。该文件与 HEAD 无差异，本轮未改它，也未更新或豁免该测试。证据见 `output/pm-lifecycle-protection-regression.log`。

未提交、未推送、未发布。
