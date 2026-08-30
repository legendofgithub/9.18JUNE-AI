# June AI 工作交接（2026-08-22）

## 1. 当前结论

本轮已完成多用户模型服务隔离、账号安全、管理员审计与最小后台、Stripe 支付代码接入、备份/日志/指标、社群二维码、基础埋点、前端关键路径自动化测试，以及本机 HTTPS + Nginx + SSE 部署演练。

2026-08-21 新增 Harness 可用闭环：付费项目工作区已从 localStorage + 模拟回复升级为服务端持久化项目/会话/消息，具备上下文预算与压缩、安全文件工具、Agent 工具循环、SSE 执行过程、写入审批、取消/恢复、trace 回放和服务端权限强制。该轮不做向量库、LLM-as-judge、直接修改用户本地磁盘或外部系统操作。

2026-08-22 新增 Windows 桌面版打包：`build-desktop.bat` 会构建前端并用 PyInstaller 生成 `dist\JuneAI\JuneAI.exe`。桌面版为目录版应用，自动启动本机 FastAPI 服务、托管前端静态资源并打开浏览器；数据库、日志、Harness 工作区和持久化密钥写入 `data\`。首次注册用户自动成为本机管理员；源码 `backend\.env`、现有 SQLite 数据库和 API Key 不打包。

还未达到“可正式收费上线”状态：Docker Desktop 安装被下载源阻断，真实 Stripe 密钥与线上域名证书未提供，因此容器级生产编排和真实支付闭环尚未完成。GitHub 的本地 `origin` 已移除，但远端仓库如果仍为 public，历史代码仍可能公开，需要仓库所有者在 GitHub 上转 private 或删除远端仓库。

2026-08-23 补充：已加入可选的 Prometheus + Alertmanager 监控编排（`deploy/monitoring/`）、备份脚本的异地目录复制能力（`JUNE_OFFSITE_BACKUP_DIR` / `--offsite-dir`），以及依赖安全扫描脚本（`backend/scripts/security_scan.py`）。这些属于代码/配置准备，仍需真实环境接入后验证。


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

### Harness 可用闭环

- 新增 `harness_projects`、`harness_files`、`harness_memories`、`harness_documents`、`agent_runs`、`agent_events`、`tool_calls`，并为 `sessions/messages` 增加归属、项目、token 和 metadata 字段；迁移为 additive，不重写商业数据。
- 新增 `/api/harness/*`：项目、会话、文件快照、上下文、压缩、记忆、文档、Agent run/resume/cancel/approval/trace。
- Agent 支持 OpenAI-compatible function calling，最多 6 轮工具迭代，工具超时 10 秒；SSE 输出上下文、模型增量、工具开始/结束、审批、完成和错误。
- 内置 `list_files`、`read_file`、`search_files`、`write_file`、`save_memory`、`create_document`；没有 shell、删除或项目外写入工具。
- `write_file` 必须用户审批，批准后临时文件原子替换，旧文件进入 `_backups`。
- Trace 中的 `write_file` 只记录路径、字节数和 SHA-256；完整待写内容放在 `_pending` 短期快照，批准、拒绝或取消后清理。
- 服务重启时把中断执行标记为 failed(interrupted)，保留等待审批现场。
- 刷新页面后，会话详情携带最近一次 Agent run 与 trace；`waiting_approval` 会恢复审批入口，`waiting_tool` 可继续执行。
- `/metrics` 新增 Agent 运行、工具调用、工具失败、审批和取消计数。
- 前端新增 `useHarnessStore` 和 API 驱动 `ProjectWorkspace`；首次装载迁移旧 `june_project_workspace_{userId}`，本地 key 保留为备份。
- 工作台新增工具卡片、写入审批、继续/停止/重试、上下文组成、项目记忆、文件列表、服务端文档和 trace 面板。

### 生产部署演练

- 安装本机 Nginx 1.31.4，生成 localhost 自签证书，新增 `deploy/nginx/local-rehearsal.conf`。
- 已验证 Nginx 配置语法、HTTPS `/health`、`/metrics`、静态资源、真实登录/下单/启动训练师/聊天 SSE。
- 发现并修复两个真实问题：
  - Vite 插件在 dev 阶段误清理 `dist`，导致后端启动找不到 assets；已限制插件只在 build 阶段运行。
- SSE 响应体执行时请求级 DB session 已关闭；改为覆盖完整 ASGI 响应生命周期的中间件，并补流式响应测试。

### Windows 桌面版

- 新增 `desktop.py`：配置桌面运行环境、持久化随机认证密钥、单实例锁、动态端口、健康检查后打开浏览器。
- 新增 `JuneAI.spec`、`requirements-build.txt`、`build-desktop.bat`；打包产物为 `dist\JuneAI\JuneAI.exe` 目录版应用和 `dist\JuneAI-Windows-x64.zip` 分发包。
- `JUNE_ENV=desktop` 时使用可写数据目录；只读安装位置回退到 `%LOCALAPPDATA%\JuneAI`。
- 打包后 `/` 返回产品 HTML，而不是 FastAPI JSON；首个注册用户自动成为本机管理员，第二个用户保持普通账号。

## 3. 验证结果

- Backend：`84 passed`。
- Frontend typecheck：通过。
- Frontend unit test：`8 passed`。
- Frontend build：通过。
- Playwright E2E：`2 passed`。
- Windows EXE 实测：干净临时数据目录启动、`/` 返回产品 HTML、`/health` healthy、首注册用户 admin=true、第二用户 admin=false、`june.db` 与 `workspaces` 落在指定数据目录。
- 真实浏览器临时后端验证：登录、创建 Harness 项目、切换写入权限、SSE 工具调用、审批前不落盘、批准原子写入、继续执行、上下文与 Trace 回放通过；`1440x900` 和 `390x844` 无横向溢出。
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
6. 监控告警与备份异地化：指标和日志已具备，已补充 Prometheus/Alertmanager 可选编排、告警规则和异地备份目录复制能力；尚未在真实环境接入告警接收方和异地存储。
7. 上线前补项：密码找回、管理员 2FA、退款/对账后台尚未实现；依赖安全扫描脚本已加入，但尚未实际安装 `pip-audit` 并跑通修复。

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
- 依赖安全扫描：`backend/scripts/security_scan.py`
- 监控配置：`deploy/monitoring/prometheus.yml`、`deploy/monitoring/alerts.yml`、`deploy/monitoring/alertmanager.yml`、`deploy/monitoring/docker-compose.monitoring.yml`
- 前端状态：`frontend/src/stores/useCommerceStore.ts`
- Harness 状态：`frontend/src/stores/useHarnessStore.ts`
- Harness 工作台：`frontend/src/components/commerce/ProjectWorkspace.tsx`
- Harness API：`backend/app/routes/harness.py`
- Agent 编排：`backend/app/services/agent_service.py`
- 工具安全：`backend/app/services/tool_registry.py`
- 上下文：`backend/app/services/context_builder.py`
- Harness 仓储：`backend/app/repositories/harness_repo.py`
- 接口文档：`docs/harness-api.md`、`docs/harness-data-model.md`
- 桌面入口：`desktop.py`
- 打包配置：`JuneAI.spec`、`requirements-build.txt`、`build-desktop.bat`
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
