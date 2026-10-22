# PM GTC 监控卡片独立发布验收

> [changmen 扩展] **文档状态（2026-10-22）：历史 GTC 显示发布验收。版本与部署结论仅对应当次执行；当前存储边界见 [GTC_COMPAT_RETIREMENT](./GTC_COMPAT_RETIREMENT_20261014.md)，恢复接口见 [PM_GTC_RECOVER_API](./PM_GTC_RECOVER_API.md)**

2026-10-12（Asia/Shanghai）。基线：`38883ca32a42ec53e6647446f39aac87c62c50b5`。

## 范围与行为

[changmen 扩展] 将本地 PM GTC 监控卡片的布局单独提取到当前已发布的普通订单列表：展示监控状态、成交、挂单、TAKER／MAKER、买入限价、成交均价和最近核对时间；取消剩余挂单按钮使用本地卡片样式。不再折叠显示 GTC 详情。

显示数据来自现有执行记录。TAKER／MAKER 采用既有定点份额计算，排除 FAILED 成交，且只有原单累计数量和有效明细一致时才显示；证据不足显示待核实。均价采用已核实成交本金除以成交份额，零成交显示 —，不把限价当成交均价，也不把未知费用当零费用。

原订单状态、核对完成判定和撤单资格直接沿用原 gtcOrderCardView、gtcPmReconciled 和 gtcCanCancel。没有复制本地尚未发布的监控模块、撤单入口或新增撤单资格限制。撤单函数逐字保留上一发布版本，包括确认框、`./runtime` 的 cancelGtc、原单 ID 和异常隔离；按钮继续受 `readOnly || !view.canCancel` 保护，OrderDetails 的用户、账号、原单身份和 revision 校验不变。

PM 同步异常、另一腿同步异常、核对完成提示、成交冲突、撤单诊断消息全部保留；新增撤单状态标签不隐藏原诊断。没有启动额外查询、修改执行记录、写财务订单或改变统计。准备中、拒单、DELAYED、零余量及各撤单状态的资格与线上原版一致。

实际业务源码只修改 ProgressPanel.vue、新增 monitorCardView.ts；其余代码改动为新增 20 项监控回归，以及 3 个原有回归文件适配卡片结构和按钮文案。原有保护断言保留，没有重设基线、扩大豁免或增加跳过。

## 发布前验收

| 检查 | 结果 |
| --- | --- |
| 完整前端回归 | 454 个文件，3558 项通过，0 失败，1 项既有跳过 |
| 定向回归 | 7 个文件、73 项通过：监控展示、精确份额、未知证据、零成交、均价与费用、终态、原撤单入口、取消确认／异常、只读及身份保护、异常独立恢复、普通列表与 App 恢复 |
| app:build | vue-tsc 与 Vite 生产构建通过；补回撤单诊断后再次通过完整回归和构建 |
| test:checks | 边界、adapter 冻结保护、client-core、API 契约与 23 步 catalog smoke 通过 |
| 发布保护 | 27 项部署 Node 回归通过；独立范围脚本核对撤单函数与基线完全一致、操作禁用表达式保留 |

server、packages、stores、runtime、services、domain、扩展、工作流和部署脚本均无 diff；GTC execute、recovery、financialOrder、api、executionIdentity、orderCardView、pollingPolicy、syncStatus、OrderDetails、orderDisplayProjection 和 displayRecords 均无改动。下注、拒单检测、补单、恢复、财务统计、删除和首次入库通知保持原实现。

执行控制继续使用 pm_gtc_executions；不带入 orders 并表，不执行数据库迁移、回填或读写切换。本地主工作区既有未提交修改保留在原处。

## 部署后核对

仅发布前端，核对公开版本和资源；后端版本、8 个 PM2 进程 PID、目录、重启计数及健康状态与发布前比较。按相同历史日期逐条核对监控原单身份、普通列表财务行身份、零成交和已核对原单、PM／另一腿异常提示、卖出／改绑与只读撤单保护，保存截图。

验收不实际下注、撤单、卖出、补单、删除或改绑。生产数据库核对只使用 READ ONLY 事务，最后 ROLLBACK。证据保存在 `output/pm-gtc-monitor-display-release-20261012/`，部署后另补本地验收结果，不为补记结果额外触发发布。
