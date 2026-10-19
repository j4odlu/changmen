# 浏览器隔离：共享状态的唯一实现

[changmen 扩展] 先复查前两批未提交改动，再迁移深度偏好与 tick 控制状态。复查的 6 个测试文件、23 项检查通过，包括错误类身份和原算法对照，未发现业务行为回归。当前本地各批拆分仍未提交、推送或部署。

## 范围与行为

将 packages/venue-adapter/polymarket/fok/pmFokDepthBufferMode.ts 和 quotes/pmTickState.ts 的完整实现迁入 client/packages/venue-browser/polymarket/。原路径仅转导出，更早的根目录入口保持不变。深度偏好源码逐字保持；tick 源码仅将 tick 价格工具改为同目录引用。

executionMath 和 executionSimulation 分别改用新位置的偏好工具、tick 状态。原十个浏览器模块对旧 adapter 的直接引用从 4 处减至 2 处，仅剩 pm-book-source.ts 的行情观察与订阅资产列表。没有调整 workspace、依赖、锁文件或发布范围。

偏好变量、默认值、getter 副本、倍数规范化、tick Map、两个监听器 Set 均保留原实现。没有引入工厂、全局重新配置、重复状态、额外定时器或网络请求。保留旧帧拒绝、重复帧抑制、同时间不同 tick 的原处理、book 时间戳过滤、监听器异常隔离、重连及取消订阅行为。clearPmTickStateForTests 仍仅清空 tick，不额外清空监听器。

## 验证边界

venue-browser-state.json 精确登记两个完整实现、两个消费者 import 和两项兼容入口。独立 hash 固定记录，新位置还原相对 import 后逐字比较 Git 起点。所有既有源码基线、前两批记录和 hash 不变；旧入口追加实现、重定向或新状态源码丢失/修改均拒绝。

原完整源码检查在精确跟随新转发入口后仍执行原断言，未删除或放宽业务判断。另将早期纯工具校验器的默认文件读取锚定到模块所在仓库，补齐其从子工作区调用时的路径解析；回归覆盖状态和早期纯工具的这两种调用。

状态测试混用原入口、中间入口和新入口，核对所有运行时导出函数的身份，跨入口设置/读取/重置偏好，更新/查询/清空 tick，接收/取消通知，以及监听器抛错后其他监听器仍获通知。

通用依赖扫描目前有 188 项未静态解析输入；其中三项位于本轮校验链中的计算文件 URL，属于校验器读取已固定清单的路径，不是业务运行时依赖。没有将它们豁免，也没有据此缩小发布范围。明细见 output/venue-browser-state-20261019/component-unknown.json。

本机验证日志位于 output/venue-browser-state-20261019/。本轮不执行生产部署或数据库迁移。

## 最终验证

| 检查 | 结果 |
| --- | --- |
| 推进前复查 | 6 文件、23 项通过 |
| 状态共享、清理、历史源码及关联行为回归 | 9 文件、393 项通过 |
| Actions 同命令 verification-control | 107 文件、2,718 项通过 |
| 完整前端回归 | 525 文件、4,815 项通过；保留原有 3 文件、4 项跳过 |
| test:checks | 边界、导出、契约、冻结检查及 24 步 catalog smoke 通过 |
| 独立安装、前端类型检查与生产构建 | 8 个 workspace、9 个源码目录，无 server；全部通过，临时目录已清理 |

本轮验证未出现失败或超时。原有大 chunk 和静态/动态导入重叠提示仍存在。安装实验禁用 npm 安装生命周期脚本，构建按原命令执行；不替代 Linux Actions 或线上验收。未发现本轮业务回归，各测试组有交叉，不累计总数。

## 下一步

为行情观察和订阅资产列表明确宿主接入方式，保持原只读 source 对象身份、观察回调、订阅集合及清理时序。解除这最后两处引用并完成闭包与安装验证后，再建立独立 workspace；当前目录仍归现有 @changmen/venue-adapter workspace。

后续宿主拆分见 [VENUE_BROWSER_HOST_20261019.md](./VENUE_BROWSER_HOST_20261019.md)。
