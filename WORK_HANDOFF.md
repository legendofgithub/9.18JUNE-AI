# June AI 工作交接（2026-08-20）

## 1. 当前结论

本轮已完成多用户模型服务隔离、账号安全、管理员审计与最小后台、Stripe 支付代码接入、备份/日志/指标、社群二维码、基础埋点、前端关键路径自动化测试，以及本机 HTTPS + Nginx + SSE 部署演练。

还未达到“可正式收费上线”状态：Docker Desktop 安装被下载源阻断，真实 Stripe 密钥与线上域名证书未提供，因此容器级生产编排和真实支付闭环尚未完成。GitHub 的本地 `origin` 已移除，但远端仓库如果仍为 public，历史代码仍可能公开，需要仓库所有者在 GitHub 上转 private 或删除远端仓库。

## 2. 已完成

### model_services 多用户隔离

- `model_services` 主键从全局 `id` 改为 `(id, owner_id)`。
- `model_entries` 主键改为 `(id, service_owner_id, service_id)`，并通过复合外键关联服务。
- 启动迁移会把旧 SQLite 表重建成新结构并迁移已有数据；执行前已备份。
- 仓储按 owner 组合主键取数，第二个用户初始化不会再撞全局主键。
- 新增两个用户分别初始化 5 个预设服务的测试，以及旧表结构数据迁移测试。

### 账号安全与审计

- 新增按账号 + IP 的登录限流、失败窗口和临时锁定。
- 新增账号禁用：禁用后不能登录，旧 token 访问 `/api/auth/me` 和商业 API 均被拒绝；管理员账号不允许禁用。
- 新增管理员解锁登录限流操作。
- 新增 `audit_logs` 表、管理端查询接口，以及登录锁定、禁用登录、管理员禁用/启用/解锁的审计记录。

### 真实支付代码接入

- 新增 `PaymentService`，使用 Stripe Checkout Session REST API。
- Stripe 模式下，后端创建 Checkout Session，订单保存 `provider_order_id` 与 `payment_url`，前端跳转 Stripe 支付页。
- 新增 `/api/payments/stripe/webhook`：校验 `Stripe-Signature` 与时间窗，只信任 `checkout.session.completed` 发放权益；客户端手动确认在 Stripe 模式下被拒绝；回调写入 `payment_events` 供对账。
- 已用模拟 Stripe Checkout 和签名 webhook 完成后端测试；尚未真实扣款。

### 管理后台

- 后端新增 `/api/admin/overview`、`users`、`orders`、`audit-logs`、用户禁用/启用和登录解锁接口。
- 前端新增 `#/admin` 最小后台：指标卡、用户表、订单表、审计日志表、禁用原因输入与确认。
- 非管理员访问会回首页。

### 备份、日志、监控

- `backend/scripts/backup.py`：SQLite 在线一致性备份、完整性检查、保留策略、容器 sidecar 循环执行。
- `backend/scripts/clean_test_data.py`：dry-run、按邮箱删除测试用户、`--reset-commerce` 清理订单/权益/路径/模型服务密钥/支付事件/埋点但保留账号与审计；删除前强制备份。
- 新增 `/metrics`：请求数、5xx 数、SSE 请求数、运行时长。
- 新增 JSONL 请求日志；生产 compose 配置 Nginx/API 容器日志和备份 sidecar。

### 社群二维码与埋点

- 首页社群卡改为真实二维码渲染，不再使用占位框。
- 二维码地址由 `VITE_COMMUNITY_URL` 配置；当前仍是默认 `https://june.ai/community`，需要替换成真实入口。
- 新增 `/api/analytics/events` 一方埋点：匿名 session ID、白名单简单属性；前端记录路由、登录成功、发起支付、支付确认/回调检测。

### 前端关键路径自动化

- 新增 Playwright 配置和 `frontend/e2e/critical-path.spec.ts`。
- 覆盖首页二维码、登录、购买、Stripe 支付页打开、回调后成功页、管理后台指标/审计、禁用用户 payload。
- 测试 mock 网络，不依赖真实 Stripe。

### 生产部署演练

- 安装本机 Nginx 1.31.4，生成 localhost 自签证书，新增 `deploy/nginx/local-rehearsal.conf`。
- 已验证 Nginx 配置语法、HTTPS `/health`、`/metrics`、静态资源、真实登录/下单/启动训练师/聊天 SSE。
- 发现并修复两个真实问题：
  - Vite 插件在 dev 阶段误清理 `dist`，导致后端启动找不到 assets；已限制插件只在 build 阶段运行。
  - SSE 响应体执行时请求级 DB session 已关闭；改为覆盖完整 ASGI 响应生命周期的中间件，并补流式响应测试。

## 3. 验证结果

- Backend：`86 passed`。
- Frontend typecheck：通过。
- Frontend unit test：`1 passed`。
- Frontend build：通过。
- Playwright E2E：`1 passed`。
- 本机 Nginx config test：通过。
- HTTPS `/health`、`/metrics`、静态资源：200。
- HTTPS SSE：200、`text/event-stream`、多帧增量返回，`june_sse_requests_total` 增加。
- 可见浏览器点按验证：注册、登录、购买、沙箱支付、进入模型服务、管理后台禁用用户完成；1440x900 与当前视口无横向溢出。

## 4. 数据清理状态

本地 `backend/june.db` 当前：

- 用户：仅保留 `tony` 管理员。
- 订单：0；MVP 路径：0；模型服务：0；埋点：0。
- 审计日志：保留 1 条。

删除前备份：

- `backend/backups/june-20260820-115252.db`
- `backend/backups/june-20260820-105055.db`
- `backend/backups/june-20260820-104954.db`

## 5. 未完成与外部依赖

1. Docker 容器级生产演练：本机原无 Docker；winget 官方源和 Microsoft Store 源下载均无字节，安装未成功，生产 compose 尚未实际 `up`。
2. 线上 HTTPS 域名与证书：已完成 localhost 自签演练，尚未配置真实域名、DNS 和正式证书。
3. 真实支付扣款：代码和签名回调测试已完成，缺真实 Stripe 密钥、Dashboard webhook 和一次真实测试支付。
4. GitHub 远端：本地 `origin` 已移除，但 GitHub 上已有仓库的可见性和历史仍需仓库所有者处理。
5. 真实社群入口：二维码已完成，`VITE_COMMUNITY_URL` 仍需替换。
6. 监控告警与备份异地化：指标和日志已具备，尚未配置 Prometheus 采集、告警、日志外发、异地备份。
7. 上线前补项：密码找回、管理员 2FA、退款/对账后台、安全扫描与依赖漏洞处理。

## 6. 关键文件

- 数据库与迁移：`backend/app/models/database.py`
- 商业仓储：`backend/app/repositories/commerce_repo.py`
- 登录安全：`backend/app/services/auth_service.py`
- 支付：`backend/app/services/payment_service.py`
- 商业服务：`backend/app/services/commerce_service.py`
- 管理服务：`backend/app/services/admin_service.py`
- API：`backend/app/routes/commerce.py`、`backend/app/routes/admin.py`
- 观测：`backend/app/core/observability.py`
- 备份/清理：`backend/scripts/backup.py`、`backend/scripts/clean_test_data.py`
- 前端状态：`frontend/src/stores/useCommerceStore.ts`
- 管理后台：`frontend/src/components/commerce/AdminView.tsx`
- 支付页：`frontend/src/components/commerce/PaymentView.tsx`
- 埋点：`frontend/src/services/analyticsService.ts`
- E2E：`frontend/e2e/critical-path.spec.ts`
- 生产编排：`docker-compose.production.yml`
- 部署说明：`deploy/README.md`
- 本机 Nginx 演练：`deploy/nginx/local-rehearsal.conf`

## 7. 继续执行的最短路径

1. 手动安装 Docker Desktop，确认 `docker --version` 可用。
2. 准备生产 `.env`：`JUNE_ENV=production`、`JUNE_API_TOKEN`、`JUNE_AUTH_SECRET`、`JUNE_ADMIN_PASSWORD`、`JUNE_PUBLIC_BASE_URL=https://真实域名`、`JUNE_PAYMENT_PROVIDER=stripe`、`JUNE_STRIPE_SECRET_KEY`、`JUNE_STRIPE_WEBHOOK_SECRET`。
3. 替换真实域名证书挂载路径。
4. 执行：

```powershell
cd D:\AI\claude-code-project\ai-study-tool
cd frontend
npm ci
npm run build
cd ..
docker compose -f docker-compose.yml -f docker-compose.production.yml config
docker compose -f docker-compose.yml -f docker-compose.production.yml up --build -d
docker compose -f docker-compose.yml -f docker-compose.production.yml ps
```

5. 配置 Stripe webhook 为 `https://真实域名/api/payments/stripe/webhook`。
6. 用测试卡完成一次真实 Stripe 测试支付，确认支付页、签名回调、订单 paid、entitlement、`payment_events` 全链路。
7. 在真实域名浏览器发起模型聊天，确认 SSE 增量输出。
8. 在 GitHub 仓库设置中转 private，或删除远端仓库。
