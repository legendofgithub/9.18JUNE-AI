# June AI · Vibe Coding 变现训练官

June AI 帮助不学技术的用户，用自然语言指挥 AI 做出一个可试用、可售卖、可交付的最小商业 MVP。产品不教编程语言、实现框架或实现原理，只围绕「变现目标」推进：谁付费、卖什么结果、怎么做出第一版、怎么收款、怎么获客、怎么完成第一次交付。

用户购买的是一次性解锁超级个体训练师人格的权限（39 元）。启动后连接自己的 AI 工具（BYOK，AI 使用费用由用户自己的账户承担），系统自动装载训练官 skill、初始化节点清单、主对话、无限追问链和商业 MVP 推进报告。

> 当前定位：**本地可测试的商业化 MVP**。支付为沙箱模式（Stripe 代码已接入但未真实扣款），Docker 生产编排就绪但未实跑。不要把仓库当作生产可上线版本使用。

## 核心能力

- **完整商业闭环**：注册登录 → 购买支付 → 权益解锁 → 训练流程 → 完成归档 → 管理审计。未付费不能启动训练师；未登录只能看到营销页。
- **10 节必修训练路径**：付费人群画布 → 可售卖结果 → 商业需求简报 → 产品形态 → 第一版 MVP → 5 分钟迭代 → 报价收款 → 获客素材 → 首次销售 → 变现复盘。节点按顺序客观完成，全部完成后路径归档锁定（口头说"没完成"不改变客观状态）。
- **无限追问链**：任意节点可发起层级不限的追问（线程树自引用，逐层 +1）。上下文按距离分级压缩（12/6/4/2 条），总量超预算从头部截断，不丢弃祖先、不加次数上限。追问结论写入 `thread_states.summary`，可一键「采纳为交付物」回流当前节点。
- **Harness 工作台**：服务端持久化的项目工作区，Agent 支持 OpenAI-compatible function calling（6 轮工具迭代、工具超时 10s、SSE 过程输出）。内置文件工具受路径沙箱约束，`write_file` 必须用户审批后原子替换，执行过程可 trace 回放，服务重启可恢复中断现场。
- **BYOK 连接 AI 工具**：用户只看到「选择 AI 工具 + 访问密钥」，不暴露 Base URL 等技术细节。密钥加密存储、API 不回传明文；连接失败按 401/402/429/5xx 分类为用户可读文案。
- **支付**：沙箱确认幂等；Stripe Checkout Session + 签名 webhook（HMAC + 时间窗校验）已接通并测试，只信任 `checkout.session.completed` 发放权益，回调写 `payment_events` 供对账。
- **账号安全与管理后台**：按账号 + IP 登录限流与临时锁定、账号禁用全链路生效、`audit_logs` 审计；`#/admin` 提供指标卡、用户/订单/审计表、禁用与解锁操作。
- **多用户隔离**：`model_services` / `model_entries` 复合主键按 owner 隔离，存量表自动重建迁移。
- **Windows 桌面版**：PyInstaller 目录版打包，自动起本地服务并打开浏览器，数据落在 exe 旁 `data\` 目录。
- **运维就绪**：`/metrics` 指标、JSONL 请求日志、SQLite 在线备份（保留策略 + 异地复制）、Prometheus/Alertmanager 编排、依赖安全扫描、一方埋点。

## 使用流程

1. 打开产品（开发模式 `http://localhost:5173`，或后端直托 `http://localhost:8000`，或双击桌面版 exe）。
2. 注册/登录，在首页购买 39 元解锁（管理员账号直接解锁，不走支付）。
3. 进入模型服务页 `#/studio`，点击「启动超级个体训练师人格」，首次需连接 AI 工具密钥。
4. 主对话推进当前节点，追问链弄清商业动作，按顺序提交交付物。
5. 全部完成后查看归档内容与商业 MVP 推进报告（归档后只读，不能补课或继续提问）。

## 本地启动

**注意：必须用 `backend/.venv`（根目录 `.venv` 的系统 Python 已失效）。旧的 `run.bat`/`setup.bat` 启动链已移除。**

方式一（最简单）：前端已有构建产物时，只启动后端即可获得完整产品：

```powershell
cd backend
.venv\Scripts\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8000
# 打开 http://localhost:8000
```

方式二（前后端分离开发，前端热更新）：

```powershell
# 窗口 1
cd backend && .venv\Scripts\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8000
# 窗口 2
cd frontend && npm run dev    # http://localhost:5173
```

方式三（Windows 桌面版）：

```powershell
.\build-desktop.bat    # 产物 dist\JuneAI\JuneAI.exe 与 dist\JuneAI-Windows-x64.zip
```

桌面版数据保存在 `JuneAI.exe` 旁的 `data\` 目录（不可写时回退 `%LOCALAPPDATA%\JuneAI`），首个注册账号自动成为本机管理员。不要单独复制 exe——它需要同目录运行时文件，分发用 `JuneAI-Windows-x64.zip`。

## 验证

```powershell
# 后端（102 passed；test_desktop_runtime.py 因本机 FastAPI 版本漂移暂时无法收集，--ignore 绕过）
cd backend && .venv\Scripts\python.exe -m pytest tests -q

# 前端（8 unit tests + typecheck + build）
cd frontend
npm run typecheck && npm test -- --run && npm run build

# Playwright E2E（critical-path / harness-workspace 两个 spec，mock 网络）
npm run test:e2e
```

测试覆盖商品定价、支付幂等、未付费拒绝启动、完成锁定、权限隔离、追问链上下文与回流、BYOK 密钥不泄露、Stripe webhook 验签、登录限流、多用户隔离迁移等业务规则。

## 技术栈与结构

- **后端**：FastAPI + SQLite（SQLAlchemy），分层架构 routes / services / repositories / models。
  - `app/services/`：`mvp_service.py`（路径与追问链）、`agent_service.py`（Agent 循环）、`commerce_service.py`、`payment_service.py`（Stripe）、`tool_registry.py`（沙箱工具）、`auth_service.py`（限流/锁定）
  - `app/repositories/`：`commerce_repo.py`、`harness_repo.py`、`session_repo.py`（线程树祖先链）
  - `app/models/database.py`：建表与存量迁移
- **前端**：React 19 + TypeScript + Vite 6 + Zustand + Tailwind 4，hash 路由。
  - `src/components/commerce/`：商业页面与工作台（`CoachChatPanel`、`FollowUpWindow`、`ProjectWorkspace`、`AdminView`）
  - `src/stores/`：`useCommerceStore.ts`、`useHarnessStore.ts`
- **桌面**：`desktop.py` + `JuneAI.spec` + `build-desktop.bat`
- **部署**：`docker-compose.yml` + `docker-compose.production.yml`、`deploy/nginx/`、`deploy/monitoring/`
- **运维脚本**：`backend/scripts/`（`backup.py`、`clean_test_data.py`、`security_scan.py`、`migrate_sqlite_to_postgres.py`）

## 当前状态与已知限制

| 项 | 状态 |
| --- | --- |
| 后端/前端测试 | 102 + 8 通过，Playwright 2 个 spec |
| 支付 | 沙箱可用；Stripe 代码+验签测试完成，**未真实扣款**，生产模式 fail closed |
| 部署 | 本机 Nginx + 自签 HTTPS 演练通过；Docker 生产编排就绪**未实跑**；无真实域名/证书 |
| 监控/备份 | 代码与配置就绪，未接入真实告警接收方与异地存储 |
| 上线待办 | 真实支付、密码找回、管理员 2FA、退款对账后台、依赖扫描跑通修复 |

## 硬性边界（改动前必读）

1. 用户侧主流程**不得**出现技术叙事（API、Base URL、框架、数据库等）；用户是零基础商业者。
2. AI 响应的服务端 `<tracking>` 元数据不得暴露给前端/API 响应。
3. 已完成（completed）路径的主对话、追问、节点修改、重新启用、补课全部拒绝。
4. 付费内容只在服务端，不提供导出/批量复制接口；不夸大防截图能力。
5. 不重新引入自动访客身份；不迁移/重写历史路径。
6. 不承诺收入，只承诺确定性交付物。
7. 真实密钥不入代码/日志/文档；破坏性数据库操作前先备份（`backend/backups/` 惯例）。
8. 追问链不做次数/层级硬上限，靠逐层压缩 + 总量封顶控制体积；追问结论必须能采纳为交付物。

## 深入文档

- [`WORK_HANDOFF.md`](WORK_HANDOFF.md) —— 最新交接状态：已完成能力、验证结果、未完成项、关键文件索引
- [`产品状态.md`](产品状态.md) —— 产品全景：演变链路、商业模式、API 清单、登录体系
- [`docs/harness-api.md`](docs/harness-api.md) / [`docs/harness-data-model.md`](docs/harness-data-model.md) —— Harness 工作台接口与数据模型
- [`deploy/README.md`](deploy/README.md) —— 部署说明（Nginx 演练、监控编排、备份）
