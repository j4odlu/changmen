# 浏览器职责隔离：行情 tick 元数据

> [changmen 扩展] **文档状态（2026-10-22）：历史迁移与验收记录。文中的旧目录、兼容入口、workspace 数量、未提交及未部署状态仅对应各自批次；当前布局见 [WORKSPACE_LAYOUT](./WORKSPACE_LAYOUT.md)，安装与发布见 [INDEPENDENT_DEPLOYMENT](./INDEPENDENT_DEPLOYMENT.md)**

[changmen 扩展] 本轮先复查上一轮纯报价迁移，再继续执行行情元数据职责拆分。工作位于 master 当前目录；本轮不包含提交、推送、部署或数据库迁移。

## 复查与实现

报价迁移的源码及 workspace 检查 9 项通过，相关前端/报价回归 47 项通过，未发现上一轮引入的业务错误。

`client/packages/venue-browser/polymarket/pmTickMetadata.ts` 现在承载原模块的完整缓存、队列、loader 槽、tick 监听器和重连监听器。迁移只移除 HTTP 获取函数，并将两个内部依赖指向同包的 pmTickState、pmTickPrice；其余源码逐字保持原样。

原 adapter `quotes/pmTickMetadata.ts` 保留 HTTP 获取函数并转出缓存接口。HTTP 函数的动态加载顺序、token 处理、URL、transport 调用和返回值不变。前端仍在原 applyMode 位置通过 setPmTickBufferLoader 接入 fetchPmTickBufferTickSize，没有新增初始化调用或缓存实例。

pmTickBuffer、pmArbPriceBufferMode 的缓存读取和前端 pmTickBufferQuotes 的缓存/调度调用改用浏览器包入口；原根入口、嵌套入口和 pmTickBuffer 公开导出继续有效。浏览器包新增一个显式导出，总计 25 个，仍仅依赖 shared 与 pm-market-data-browser。

## 行为验收

- 新旧入口暴露同一组缓存函数，共享唯一状态；同一 tick 更新只通知一次。
- 请求实际并发上限仍为 4；缓存清空、模式切换不会提前释放在途槽位。
- 排队任务可按原规则移除；清空前、重连前或新 WS 更新前发出的 HTTP 响应不能覆盖新状态。
- 已确认 tick 的读取、10 分钟刷新、5 秒重试及重连补查保持原样。
- 原 HTTP 直连、扩展、VPS 以及官方访问失败回退测试继续通过；均使用 mock，不真实下单。

精确迁移记录覆盖 5 个既有文件和 1 个新增缓存实现，接入现有完整源码检查。未修改旧基线或旧迁移记录。初次定向检查发现一条旧负向测试仍预期返回修改后的源码；拆分后改动会被更早的精确校验拒绝，已同步为断言该拒绝，保护能力保留。

## 验证记录

- 定向源码检查：5 个文件、361 项通过。
- 定向运行回归：6 个文件、106 项通过。
- 完整源码检查：114 个文件、2,755 项全部通过。
- 前端全量回归：532 个文件通过、3 个沿用跳过；4,838 项通过、4 项沿用跳过。
- 边界、包导出、接口契约及 24 步 catalog 冒烟检查通过。
- npm 打包预览：27 个文件，25 个显式导出目标全部包含在包中。
- 隔离安装、vue-tsc 类型检查及 Vite 生产构建通过：9 个 workspace、9 个源码目录，无 server 目录，package-lock 未改变。安装使用离线缓存并禁用安装生命周期脚本；本地构建验证不代表线上部署验证。
- `git diff --check` 通过。构建仍有既有的大 chunk 和混合导入提示，无构建错误。

日志目录：`output/venue-browser-metadata-20261019/`。

## 下一步

元数据职责拆分完成后，继续梳理行情订阅与 WebSocket 宿主的依赖组。优先确定资产集合、监听器、连接和重连状态的唯一归属，再迁移完整依赖组；不能因新旧入口并存重复创建连接、订阅或定时器。账号与订单浏览器实现排在订阅生命周期之后。整体隔离尚未完成，仍按上一轮方案的边界和验收条件推进。
