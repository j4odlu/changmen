# 浏览器职责隔离：行情订阅与连接生命周期

[changmen 扩展] 本轮按完整依赖组迁移，保留现有业务逻辑、模块单例及旧公开入口。全部工作在 master 当前目录完成，本轮不提交、推送、部署或迁移数据库。

## 已迁移范围

18 个完整模块迁入 `client/packages/venue-browser`，模块内仅修改 import/export 的依赖路径：

- 电竞与体育 WebSocket：ws、sportMarketWs；各自连接、心跳、超时、重连与停止逻辑保持原样。
- 订阅与广播：marketQuoteHub、sportQuoteHub；消费者合并、初始快照、同集短路、强制重订、ready microtask 和体育会话保活保持原样。
- 连接配置与协议：wsConfig、sportWsConfig、api。
- 浏览器模式与偏好：pmWsSourceMode、pmMarketWsMode、pmUserWsMode、pmRoutingPreference、pmTransportMode、pmOrderSubmitMode。
- 状态与指标：pmMarketClientMetrics、pmExecutionMetrics，以及 shared/venueWsStatus。
- 宿主已注入能力与地址转换：shared/changmenAuthToken、shared/changmenWsBase。

另将 pmTokenQuote 的完整时间戳状态与过滤函数段迁入 liveQuoteState。原写 fo 与纠偏操作保留，并调用同一个迁出的时间戳函数；行情总线直接引用新状态模块，不依赖写 fo 的实现。

原入口转出同一实现，不创建工厂实例或第二份状态。采集器、旧本地簿服务、只读行情宿主与 Polymarket 公共入口直接引用新包。浏览器包新增 client-core 依赖，仅用于既有 relay origin 解析；该依赖不产生环，前端构建仍是 9 个 workspace，backend/RDS 闭包仍排除浏览器包。

浏览器包现在有 44 个显式子路径导出。生产发布范围未缩减。

## 验证与问题处理

- 精确迁移记录覆盖 26 个既有文件和 19 个新增实现。逐模块核对全部源码，仅允许 module specifier 变化；时间戳状态按完整原始片段核对。锁文件只新增浏览器包到 client-core 的依赖边。
- 新增 18 项新旧入口运行时导出身份检查。
- 新增混合入口连接测试：两个电竞消费者只建立一个连接、体育独立连接；重连后恢复全部订阅；删除一个消费者保持连接，最后一个退出才停止；停止后不会额外重连。
- 现有连接测试继续覆盖心跳、超时、官方访问失败回退、订阅/ready 时序及体育独立生命周期。
- 初次运行发现两个旧订阅测试文件的 spy 仍挂在旧转出层；全量回归又发现采集器和只读宿主的两个 mock 仍指向旧路径。四个测试文件已改为监视新实现入口，保持所有行为断言不变；采集退出、宿主资产读取及混合入口复查 24 项通过。
- 两条源码负向用例因修改更早被精确检查拒绝而需同步预期报错；另有三处历史测试需要先还原本轮迁移再比较实现或锁快照，修正后 22 项复查通过。未改旧基线或扩大豁免。
- 定向源码检查：5 个文件、362 项通过。
- 行情/连接/报价定向回归：33 个文件、320 项通过。
- 前端类型检查通过。
- 最终完整源码检查：115 个文件、2,759 项全部通过。
- 最终前端全量回归：534 个文件通过、3 个沿用跳过；4,857 项通过、4 项沿用跳过。
- 边界、导出、接口契约及 24 步 catalog 冒烟检查通过。
- npm 打包预览包含 46 个文件，44 个导出目标全部在包中。
- 隔离安装、vue-tsc 类型检查及 Vite 生产构建通过：9 个 workspace、9 个源码目录、无 server 目录、package-lock 不变。安装使用离线缓存并禁用安装生命周期脚本，不代表线上部署验收。
- `git diff --check` 通过；构建保留既有的大 chunk 和混合导入提示，无构建错误。

日志：`output/venue-browser-lifecycle-20261019/`。

## 剩余工作

行情订阅与连接主体本轮已迁入浏览器包；尚未迁移的私有用户通道、账号鉴权、签名、订单请求与编排应作为下一依赖组梳理。保留平台 registry/Node loader 的基础设施职责，继续保持旧入口兼容。整体职责拆包完成后再做统一验收与发布整理。
