aaaa298 公开账户监控与研究报告

入口：/aaaa298/index.html
研究：/aaaa298/research/index.html
纯价格策略研究：/aaaa298/research/price-only.html

交易监控由访问者浏览器请求 Polymarket 公开接口；无需钱包密钥。
关闭页面后停止刷新，不是 VPS 后台持续采集。实时刷新需要访问者网络可访问 PM。
内置历史快照与研究报告是固定样本，研究截至日期在各页面中注明。
CSV 下载为 gzip 压缩包，解压后可用表格软件打开。
仅提供研究和只读监控，不执行跟单交易。

持仓图默认以实际时间展示：红绿实线为双方持仓，红绿虚线为双方 PM 市场价格。
市场价格从 PM v2 prices-history 按本图 token 分别读取，不用 1－对方价格推算。
历史价格的采样间隔按接口实际返回显示；结算兑付点剔除，较长缺口断线。
鼠标或滑块选择交易步骤后显示对应历史参考价及采样时间，不代表该秒可成交报价。
切换交易步骤横轴会隐藏市场行情；重新勾选 PM 市场价格会恢复实际时间横轴。
pm-history.js 为价格加载与对齐模块源码，页面内嵌同一版本以支持本地打开。

本目录通过现有 Vite public 目录随前端构建、GitHub Actions 验证发布。
重新打包：在仓库根运行 node client/web/scripts/package-aaaa298.mjs。
打包源为本地 output/aaaa298-tracker 与 output/aaaa298-price-logic；
生产构建使用本目录已提交文件，不依赖这些本地源文件。
manifest.json 记录各发布数据文件的 SHA-256 和字节数。
