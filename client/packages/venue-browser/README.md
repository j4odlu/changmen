# @changmen/venue-browser

[changmen 扩展] pm-book-diagnostics/ 是从 packages/venue-adapter/browser/ 迁入的唯一诊断实现。旧路径仅转导出，历史公共入口、观察槽和运行类保持相同身份。

polymarket/ 存放继续从旧 adapter 迁出的三个纯模块：pmTickPrice、pmBuyOrderShares、pmMarketOrderOptions。它们仅相互引用，不依赖旧 adapter；旧 quotes/、submission/preflight/ 及更早入口转出同一份函数。诊断模块直接使用本地纯模块，计算公式、舍入、参数校验和错误消息均保持原样。

同目录的 pmOrderOptions、pmPriceValidity、pmPriceError 分别承载原订单参数类型、价格合法性判断、报价错误类及其识别函数。旧预检/报价模块保留类型转出或同一函数、构造函数的转出，不复制定义；instanceof 和原异常处理继续有效。原订单参数类型迁出后，预检模块的编译运行时代码保持完全一致。

pmFokDepthBufferMode 与 pmTickState 是深度偏好及 tick 控制状态的唯一实现。原 fok/、quotes/ 和更早入口仅转导出；新旧调用共享原偏好变量、tick Map 及监听器 Set，不创建额外状态容器。初始化值、重复帧/旧帧处理、重连通知、取消订阅及测试清理语义保持原样。

pm-book-source.ts 提供纯 createReadonlyMarketSource 工厂，只冻结传入的两个只读回调，创建时不订阅、不读取资产。行情宿主 pm-book-source-host.ts 在模块加载时创建唯一 pmOrderBookSource，沿用原 observePmMarketStream 函数，并在每次读取时查询 esport 资产集合。原公开 polymarket/orderBookSource、browser/pm-book-source 和 browser/pm-book-source-host 入口转出同一对象；pm-book-source.ts 导出工厂，pm-book-source-host.ts 导出绑定宿主的对象。

本目录是独立私有 npm workspace @changmen/venue-browser，不依赖旧 adapter、服务端或数据层。package.json 明确列出 131 个子路径 exports，没有通配入口或根聚合 barrel。内部模块使用相对引用；adapter 和 web 经声明的依赖及 @changmen/venue-browser/... 入口消费。共享模型与契约来自 client-core，HTTP DTO 来自 api-contract；行情协议与纯规则分别来自 pm-market-data-browser、shared。鉴权签名所需的第三方依赖由本包直接声明，版本与迁移前一致。Vue 使用与 web 一致的可选 peer，由宿主提供同一运行时。

polymarket/marketMessage、bookQuote、wsQuotes 分别承载原 WS 报文类型、盘口类型及最低卖价读取、行情帧解析。解析层只引用本目录的类型与纯函数，不加载旧 API 或综合 parse 模块。电竞和体育行情总线直接使用包入口；旧 api、parse、wsQuotes 入口继续转出同一类型或函数。价格/数量处理、消息顺序、时间戳选择及异常行为保持原样。

polymarket/marketStream 是行情观察流的唯一实现，保存连接 epoch、帧序号和观察者集合。WebSocket 生产者、旧订单簿服务及行情宿主直接使用本包入口；旧 realtime/marketStream 路径只转导出。协议类型来自 pm-market-data-browser。观察者上限、立即通知、故障移除、旧连接过滤及无观察者时不读取时钟的行为均不变；本模块不持有连接、订阅或定时器。

pm-book-diagnostics/marketData.worker 是唯一 Worker 组合入口，导入它会按原逻辑调用 startPmBookWorker，并传入 createPmBookDiagnostics。前端本地 Worker 文件和旧 adapter Worker 文件只导入该入口，同一模块图只执行一次。应用仍使用原本地 Worker URL；诊断客户端、网关判断和 BookConsumerPort 类型直接来自所属包。旧 orderBook、wsBookShadow 公共导出固定保留，不因应用引用减少而删除。

scripts/verification/venue-browser-layout.mjs 登记本包自己的依赖归属。declaredInstallClosure 的 sourceDirectories 与 workspaceDirectories 一致；前端构建闭包包含 9 个正式 workspace，无 server 目录。backend 和 RDS 安装闭包均不包含本包。独立前端安装验证入口为 node scripts/testing/frontend-install-isolation.mjs。

Node 运行入口禁止到达本目录。完整源码、旧转发入口和保守发布范围由边界检查持续验证；本地簿及对照的默认开关和实际预检路径均未改变。

polymarket/priceQuote 承载完整的纯报价转换与冻结报价校验。前端建腿/检测校验、报价偏好宿主和订单预检直接使用本包入口；旧 priceQuote 及 quotes/priceQuote 入口仍转出相同函数。禁用、百分比和 tick 模式的计算、舍入、上限、对象冻结和异常文本保持不变。

polymarket/pmTickMetadata 承载唯一的 tick 元数据缓存、监听器与请求队列，直接引用本包的 tick 状态和纯函数。HTTP 获取函数位于 polymarket/quotes/pmTickMetadata，沿用原 transport 与 API 调用；前端通过原 setPmTickBufferLoader 接入。旧 adapter 入口转出同一实现，新旧入口共享状态；并发上限、刷新间隔、重试、旧响应过滤和清理语义均不变。

行情生命周期依赖组已整体迁入：电竞/体育 WebSocket、订阅总线、WS URL 与端点协议、行情/用户源模式、路由及 HTTP/下单出口偏好、连接/执行指标，以及 shared/ 下的鉴权 getter、WS 地址转换和状态上报。liveQuoteState 承载原 pmTokenQuote 的行情时间戳保护状态。完整模块仅调整依赖路径，旧入口全部转出同一实现；采集器、旧本地簿服务和只读行情宿主直接消费新入口。client-core 用于既有 relay origin 解析，安装闭包无环且不引入服务端。

私有通道与账号执行依赖组位于 polymarket/auth、realtime/userWs、submission、wallet、fok、gtc、orders、transport 等目录，共迁入 70 个完整模块。账号凭证、L1/L2 签名、签名客户端缓存、私有订单/成交消息、确认任务、提交日志、未知提交恢复和手动卖出沿用原函数体、请求参数、动态加载时机及状态容器。旧路径仅转导出，不实例化第二套连接或缓存。

公共订单/平台契约及平台常量由 @changmen/client-core/contract 和 @changmen/client-core/shared/platforms 提供，保留旧 adapter 转出入口；registry 与 Node 消费者不会经这些入口加载浏览器包。shared/webBridge 是唯一浏览器宿主桥接状态，前端安装函数直接设置该实例。这里的私有用户通道指 PM 账号的订单/成交 WebSocket，与公开行情通道分开。

账号运行依赖继续迁入 8 个完整模块：wallet/balance、pmWalletPrepSdk、walletPrepUnified、relayer，transport/pmAutoTransport、pmOfficialReachability，quotes/pmArbPriceBufferMode 以及 markets/pmSportPrewarm。余额查询、钱包准备、自动路由、报价偏好和体育候选预热沿用原实现，旧入口仍转出同一函数与状态；SDK 选择、监听器通知、限流和动态加载时机不变。钱包准备由本包直接声明原有的 @polymarket/client 0.12.0，未升级版本。该轮精确迁移记录及回归测试位于 scripts/verification/venue-browser-account-runtime.*，覆盖模块正文、依赖目标、锁文件和旧入口。

采集与市场宿主继续迁入 9 个模块：markets/collect、marketIndex、pmFootballDiscovery、pmMapIdentityStore、pmMapOutcomeStore，shared/collectNotify，polymarket/realtime/orderBook/service、polymarket/orderBook 及 pm-book-source-host。原索引同步、行情写入优先级、赛果/身份缓存、响应式 tick、发现缓存和停采清理逻辑保持不变。订单簿工厂仍先检查原授权回调，再创建同名 module Worker；资源指向已有的 pm-book-diagnostics/marketData.worker.ts，未新增启动入口。旧 PM 目录只保留平台注册组装、聚合及转出入口，不再持有业务函数、缓存或连接实现；旧 adapter 的其他平台不在此结论内。精确迁移记录与检查位于 scripts/verification/venue-browser-market-hosts.*。
