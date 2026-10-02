# 管理员用户证书模块

[changmen 扩展] 管理后台 `/admin/certificates` 提供用户证书签发、公开证书登记、吊销和列表。前后端都只允许完整管理员，团队负责人没有权限。认证层服务整个站点：Client_*、原生 HTTP、matcher、私有 WebSocket、Cookie 恢复和刷新凭证共同校验证书归属及吊销状态。

## 身份与兼容

- 登记表 `client_certificates` 以 SHA-256 指纹作为主键，绑定不可变的 `users.id`。用户改名不需要换证；已登记证书不能重新绑定、复活或覆盖。
- 旧证书保持原来的 CN 和安装方式，仅登记公开 PEM 到对应用户。迁移不操作玩家账号、比赛、订单或用户密码。
- 新证书 CN 为 `cm-user-{userId}`，SAN URI 为 `urn:changmen:user:{userId}`。用户仍使用当前用户名和密码登录，证书归属校验使用 userId。
- `CLIENT_CERT_REGISTRY_ENABLED=1` 必须在增量 schema、可信指纹头和旧证书登记均完成后开启。
- `CLIENT_CERT_LEGACY_ENABLED=1` 仅用于迁移中临时兼容未登记旧证书的 CN；已登记证书被吊销/过期/错误归属时绝不回退。迁移完整后建议置 0，此时已登记旧证书仍正常登录。
- 旧 Cookie/refresh 行中指纹为空时，在可信证书归属校验后仍按原 CN 接受；新凭证同时绑定指纹，不能拿另一张证书恢复它。

## 模块边界

| 组件 | 职责 |
|---|---|
| `server/backend/core/certificates/routes.js` | 管理权限、HTTP 接入和签发/登记/吊销编排 |
| `core/certificates/issuer.js` | OpenSSL 信任链验证、客户端证书及加密 PKCS#12 生成 |
| `server/db/rds/client_certificate_store.js` | 指纹归属、吊销事务、公开证书与管理审计持久化 |
| `core/auth/identity.js` / `login_service.js` | 消费证书校验结果，输出统一用户身份 |
| `client/web/src/views/AdminCertificatesView.vue` | 管理页面和一次性下载安装包 |

所有持久化访问经 `@changmen/db`；证书模块不修改业务账号与订单。根 CA 私钥仅在本地用于签中间 CA，不上传服务器。线上中间 CA 使用 pathlen:0、clientAuth 用途，文件目录 700、私钥 600。

## 配置与迁移

运行 `node server/backend/scripts/ops/migrations/apply-client-certificate-schema.mjs`。这是独立、可重复的增量迁移，仅新增证书/审计表和凭证指纹列。部署脚本识别该文件，只执行证书迁移，不触发全库 schema、账号归属回填或订单迁移。

签发配置：`CERT_ISSUER_CERT`、`CERT_ISSUER_KEY`、`CERT_ISSUER_CHAIN`（中间 CA + 根证书公开链）、`CERT_CA_BUNDLE`（根证书）；可选 `CERT_OPENSSL_BIN`。后台不允许上传根 CA 私钥。未启用登记校验或签发文件未配置时不可签发。

Caddy API 域名继续使用 `require_and_verify` 和根 CA 信任池；可信代理传入 `X-Changmen-Client-Fingerprint {http.request.tls.client.fingerprint}`，无证入口剥离同名头。Node 只信任 loopback 注入。原静态 leaf 白名单在登记迁移完整、认证登记校验启用之后移除，避免每次签发都需要重新部署 Caddy。

## 签发、补发和吊销

安装包密码 12–128 位、有效期 1–365 天（默认 180），RSA 2048/SHA-256。PKCS#12 加密，密码不进入命令行；临时私钥目录限制权限并在成功/失败后清理。数据库只保存公开证书及元数据。安装包仅签发响应提供下载，丢失需补发；补发不自动吊销旧证书，用户安装确认后再吊销。

吊销同步撤销该证书对应 Cookie 和刷新凭证；JWT 和私有 WS 每次业务鉴权也检查登记表。禁止吊销当前管理请求使用的证书，防止把当前管理员锁在外面。保留签发、登记、迁移和吊销审计。

这是应用层吊销，TLS 握手仍可完成；公开行情保持原有匿名访问策略。没有部署 CRL/OCSP，不能声称吊销后 TLS 握手也失败。

## 验证

单元测试覆盖不可变归属、改名、吊销/过期拒绝、迁移兼容、伪造代理头、普通用户和负责人拒绝，以及真实 OpenSSL 签发。隔离 PostgreSQL 验证旧会话兼容、新会话指纹、刷新轮换和吊销事务；测试只允许 loopback 专用库。部署前运行 `npm test`、`npm run app:build` 和部署计划测试。
