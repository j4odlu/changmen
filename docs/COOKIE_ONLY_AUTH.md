# changmen Cookie 单轨登录

[changmen 扩展] 2026-10-05 将网页登录、HTTP、实时连接及插件身份核验统一到服务端浏览器会话。场馆 token/JWT、PM 私钥和订单签名不受影响。

## 已执行的阶段

1. 审计：上线前生产过去 7 天仍有 3 次旧 REFRESH 成功。已有 Cookie 会话可原样继续使用；JWT-only 客户端须刷新网页并重新登录。不把未过期 refresh 记录误当作活跃客户端证明。
2. 单轨切换：后端 `AUTH_MODE=cookie`、`WEB_AUTH_COOKIE_ENABLED=1`，网页 `VITE_WEB_COOKIE_AUTH=1`，插件至少 1.3.74。Cookie 登录不签发 JWT/refresh token；网页不加载、保存或发送应用 JWT，不向旧续期接口回退。HTTP/实时连接拒绝 JWT；旧 Client_Login/Client_RefreshToken/Client_Logout 返回明确迁移提示，改用 /auth/login、/auth/session、/auth/logout。退出继续校验 CSRF 和登录批次。
3. 物理清理：暂缓。显式回滚模式及测试仍保留旧实现；历史表/登录批次字段不删除。观察迁移拒绝和用户恢复情况后，才移除这些代码及旧 refresh 数据；与阶段 2 的运行行为无依赖。

## 会话与有效期

Cookie 只是传递随机会话凭证；服务端核验归属、登录批次、证书、空闲及绝对有效期。当前浏览器会话空闲期限 8 小时、绝对期限 7 天；正常鉴权会更新活跃时间，网页定期 /auth/session 核验也属于活动。不是永不过期。PM 插件解锁会话依然独立，身份核验失败不向新页面返回私钥。

## 回滚

先恢复前一套后端/网页发布目录及部署前环境备份，再核对 Cookie 与旧模式的配套配置。`AUTH_MODE=dual` 仅为明确回滚保留；仅修改模式不会自动把现有网页变成 JWT 客户端。禁止删除 JWT_SECRET：目前旧实现及相关服务端密钥派生仍依赖该配置。无需删除数据库历史表、清空现有 Cookie 或强制所有 Cookie 用户重新登录。
