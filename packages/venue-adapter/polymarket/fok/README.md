# PM FOK 模式实现

[changmen 扩展] 2026-10-11，按用户要求把既有实现迁入本目录。FOK/GTC 只是 PM 下单模式；这里不增加套利编排、订单监控体系或补单能力。

| 文件 | 保留的原职责 |
| --- | --- |
| `bet.ts` | 原 FOK 预检、构单与提交；原 provider 的余额/列表方法也随完整模块保留，不在此次移动中拆分 |
| `orderSettlement.ts` | 原 FOK BUY/SELL 成交确认、等待及明确挂簿订单的收尾 |
| `settlementJob.ts` | 原确认任务与时间上下文；包括已有 FOK 卖出调用 |
| `pmFokDepthBufferMode.ts` | 原 FOK 深度缓冲运行配置与计算 |

上一级同名文件是兼容再导出，旧消费者继续使用原路径。实际实现与状态只保留一份；不要把兼容文件改成包装调用，不要复制 provider、预检缓存或确认任务。鉴权、订单事实/列表、费用及其它共用脚本仍在上一级。

本次只调整相对依赖路径，其余完整源码与固定 `219535c8`、VPS `75b1efac66625e5f2bc9884a965b244bfaf337ed` 相同。持续核验（仓库根目录）：

```text
node scripts/verification/verify-pm-fok-relocation.mjs
npx vitest run scripts/verification/pm-fok-source-relocation.test.mjs
```

旧入口/新实现导出、配置与任务单例测试在 `../fokRelocation.test.ts`。本目录纳入原电竞冻结检查；本次用户明确授权的迁移通过 `ALLOW_ESPORT_TOUCH=1` 验收，未来修改仍受冻结保护。VPS 固定基线与 manifest 不变。

完整位置、命名与暂停边界见 [布局研究](../../../../docs/PM_ORDER_MODE_MODULE_LAYOUT_PLAN.md)。本次移动的验收通过不代表当前整批工作区发布保护通过；历史阻断项继续保留。
