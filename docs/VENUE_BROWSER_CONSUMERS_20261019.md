# 浏览器隔离：实际消费者与 Worker 入口收口

> [changmen 扩展] **文档状态（2026-10-22）：历史迁移与验收记录。文中的旧目录、兼容入口、workspace 数量、未提交及未部署状态仅对应各自批次；当前布局见 [WORKSPACE_LAYOUT](./WORKSPACE_LAYOUT.md)，安装与发布见 [INDEPENDENT_DEPLOYMENT](./INDEPENDENT_DEPLOYMENT.md)**

[changmen 扩展] 在独立 workspace 之后，前端开始直接消费所属包，移除诊断链路经过旧 adapter 中间入口的依赖。业务行为保持原样，未提交、推送、部署或执行数据库迁移。

## 改动

pmDynamicWsShadowWorker 直接从 @changmen/venue-browser 引入 officialGateway 与 WsBookShadowWorkerClient，BookConsumerPort 类型改从 @changmen/pm-market-data-browser/service 引入。保留原模块顺序，所有 import 后的业务语句与 Git 起点逐字一致。原路由、账号、网关过滤、候选集、监听器和停止逻辑未改动；行情宿主仍经原 adapter 公共入口接入。

将原 adapter Worker 的完整组合源码迁至 client/packages/venue-browser/pm-book-diagnostics/marketData.worker.ts，仅修改诊断工厂的相对 import。新增第 19 个明确 exports。前端 Worker 文件和旧 adapter Worker 文件均导入这个唯一组合入口；原本地 Worker URL、启动参数和可选诊断工厂不变，没有复制启动逻辑。

web 显式声明 @changmen/venue-browser 依赖，锁文件仅增加对应依赖边；workspace 数量、第三方版本与后端声明闭包不变。移除前端导入检查中两个已无消费者的深路径例外。

## 检查发现与修复

新增 Worker 跨入口测试最初位于 adapter 测试目录，导入前端宿主违反职责边界。已移动到前端宿主测试目录，没有扩大允许范围。

实际导出检查发现：应用不再引用旧路径后，自动 exports 扫描器会删除 orderBook 与 wsBookShadow 两个既有公共入口。现将两者登记为固定兼容导出，补充应用引用清零时仍保留入口的回归。adapter 原 package exports 未改动。

首次完整检查与本轮清单修正发生重叠，运行中的测试缓存了旧校验模块，产生 hash 不一致；该次结果无效。失败日志保留。所有修正完成后停止修改源码，以稳定清单重新执行完整检查。此前各轮固定记录和 hash 保持不变。

venue-browser-consumers.json 精确记录 10 个变更文件及唯一 Worker 源码。校验器还原本轮改动后继续执行已有完整源码检查，没有删除历史断言。前端工具迁移的原始源码 hash 仍在精确还原后验证。

## 验证

日志目录：output/venue-browser-consumers-20261019/。

| 检查 | 结果 |
| --- | --- |
| 前端宿主、Worker 多入口、路由及清理 | 3 文件、13 项通过 |
| 消费者完整源码、工具历史源码与固定导出回归 | 3 文件、21 项通过 |
| Actions 同命令 verification-control 最终复验 | 110 文件、2,734 项通过 |
| test:checks 最终复验 | 边界、导出、契约、冻结检查及 24 步 catalog smoke 通过 |
| 完整前端回归 | 528 文件、4,821 项通过；原有 3 文件、4 项跳过 |
| npm pack --dry-run | 21 个文件，19 个公开入口全部包含 |
| 独立安装、类型检查与生产构建 | 9 个 workspace、9 个源码目录，无 server；全部通过 |
| git diff --check | 通过 |

各组存在重叠，不累计测试总数。打包仅为预览；本机验证不替代 Linux Actions 或线上验收。

独立安装使用 npm ci --offline --ignore-scripts，随后执行原 vue-tsc 与 Vite 构建；锁文件不变，临时目录已清理。上一轮与本轮构建日志均生成 pmMarketData.worker-6o1jiZ-N.js，体积均为 24.15 kB，Vite 文件名哈希一致。日志已分别保存在 previous-build.log 和 build.log；未做两份产物文件逐字比较。

最终复验无失败，未发现业务行为回归。原有大 chunk 与静态/动态导入重叠提示仍存在。改动保留在 master 本地，未 commit、push 或部署。
