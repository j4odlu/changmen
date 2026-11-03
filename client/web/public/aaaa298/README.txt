aaaa298 公开账户监控与研究报告

入口：/aaaa298/index.html
研究：/aaaa298/research/index.html
纯价格策略研究：/aaaa298/research/price-only.html

交易监控由访问者浏览器请求 Polymarket 公开接口；无需钱包密钥。
关闭页面后停止刷新，不是 VPS 后台持续采集。实时刷新需要访问者网络可访问 PM。
内置历史快照与研究报告是固定样本，研究截至日期在各页面中注明。
CSV 下载为 gzip 压缩包，解压后可用表格软件打开。
仅提供研究和只读监控，不执行跟单交易。

本目录通过现有 Vite public 目录随前端构建、GitHub Actions 验证发布。
重新打包：在仓库根运行 node client/web/scripts/package-aaaa298.mjs。
打包源为本地 output/aaaa298-tracker 与 output/aaaa298-price-logic；
生产构建使用本目录已提交文件，不依赖这些本地源文件。
manifest.json 记录各发布数据文件的 SHA-256 和字节数。
