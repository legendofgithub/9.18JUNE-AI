# June AI · 无限追问的 AI 辅助伴学系统

June AI 是一个免费、单用户、打开即用的 AI 伴学助手：连接你自己的 AI 工具（BYOK，AI 使用费用由你自己的模型账户承担），通过主对话与**无限追问链**把一个想法一步步做成可用的成果。产品面向零基础使用者，不教编程语言或实现框架，也没有任何收费环节——完全免费，打开产品直接进入对话界面。

三条核心特色：

1. **追问层级与次数都不限**：线程树逐层生长，对任意一句话继续追问，深度与次数没有上限。
2. **越问越聚焦的记忆**：近层保留原文、远层自动压缩成结论，总量封顶也不失忆。
3. **结论一键采纳为交付物**：聊过的每一步都沉淀为产出，写入当前节点。

> 当前定位：**本地单用户免费工具**，不是生产上线版本（Docker 生产编排就绪但未实跑）。登录系统与管理后台已整体移除，打开即用。

## 核心能力

- **打开即用**：无登录、无门槛。打开产品直接进入对话界面（「AI 伴学助手」面板），所有数据归属固定本地身份 `local`。
- **10 节点顺序推进**：把一个想法拆成 10 个顺序节点——想清楚做给谁、定下可验收的结果、写出需求简报、选最小形态、让 AI 产出第一版、迭代到可试用、补齐交付说明、准备触达素材、完成一次真实交付、复盘下一步。节点按顺序客观完成、不可跳过；全部完成后路径归档锁定（口头说"没完成"不改变客观状态）。
- **无限追问链（核心特色）**：任意节点可发起层级不限的追问（线程树自引用，逐层 +1，深度与次数无上限）。上下文按距离分级压缩（近层 12 条原文、远层逐步压缩到 2 条结论），总量超预算从头部截断，不丢弃祖先、不加次数上限。追问结论写入 `thread_states.summary`，可一键「采纳为交付物」回流当前节点。
- **Harness 工作台**：服务端持久化的项目工作区，Agent 支持 OpenAI-compatible function calling（6 轮工具迭代、工具超时 10s、SSE 过程输出）。内置文件工具受路径沙箱约束，`write_file` 必须用户审批后原子替换，执行过程可 trace 回放，服务重启可恢复中断现场。
- **BYOK 连接 AI 工具**：用户只看到「选择 AI 工具 + 访问密钥」，不暴露 Base URL 等技术细节。密钥加密存储、API 不回传明文；连接失败按 401/402/429/5xx 分类为用户可读文案。已保存密钥自动复用。
- **Windows 桌面版**：PyInstaller 目录版打包，自动起本地服务并打开浏览器，数据落在 exe 旁 `data\` 目录。
- **运维就绪**：`/metrics` 指标、JSONL 请求日志、SQLite 在线备份（保留策略 + 异地复制）、Prometheus/Alertmanager 编排、依赖安全扫描、一方埋点。

## 使用流程

1. 打开产品（开发模式 `http://localhost:5173`，或后端直托 `http://localhost:8000`，或双击桌面版 exe）——直接进入「AI 伴学助手」对话界面。
2. 首次使用选择你的 AI 工具并填入访问密钥，点击「连接并开始对话」；已保存密钥自动复用。
3. 在主对话里推进当前节点；想继续弄清任何一步，在「跟练对话」tab 或悬浮追问窗里追问，层级不限。
4. 追问出的结论点「采纳为交付物」写入当前节点，按顺序完成 10 个节点。
5. 全部完成后查看归档内容与完整推进报告（归档后只读，不能补课或继续提问）。

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

桌面版数据保存在 `JuneAI.exe` 旁的 `data\` 目录（可用环境变量 `JUNE_DESKTOP_DATA_DIR` 指定其他位置）。不要单独复制 exe——它需要同目录运行时文件，分发用 `JuneAI-Windows-x64.zip`。

## 验证

```powershell
# 后端（91 passed，2026-09-21 实测；test_desktop_runtime.py 因本机 FastAPI 版本漂移无法收集，--ignore 绕过）
cd backend && .venv\Scripts\python.exe -m pytest tests -q --ignore=tests\test_desktop_runtime.py

# 前端（typecheck + 6 unit tests + build，2026-09-21 实测）
cd frontend
npm run typecheck && npm test -- --run && npm run build

# Playwright E2E（critical-path / harness-workspace 两个 spec，mock 网络；2 passed，2026-09-21 实测）
npm run test:e2e
```

测试覆盖节点顺序与完成锁定、追问链上下文分级压缩与结论回流、BYOK 密钥不泄露、Harness 沙箱与文件审批、单用户身份归属等业务规则（对应 `backend/tests/` 的 commerce、follow_up_chain、security_hardening、harness_api 等测试文件）。

## 技术栈与结构

- **后端**：FastAPI + SQLite（SQLAlchemy），分层架构 routes / services / repositories / models。
  - `app/services/`：`mvp_service.py`（节点流程与无限追问链）、`agent_service.py`（Agent 循环）、`context_builder.py`（上下文组装）、`commerce_service.py`（推进流程）、`tool_registry.py`（路径沙箱工具）
  - `app/repositories/`：`session_repo.py`（线程树祖先链）、`harness_repo.py`、`commerce_repo.py`（节点种子与交付物）
  - `app/models/database.py`：建表与存量迁移
- **前端**：React 19 + TypeScript + Vite 6 + Zustand + Tailwind 4，hash 路由。
  - `src/components/commerce/`：伴学界面与工作台（`CoachLaunchPanel`、`CoachChatPanel`、`FollowUpWindow`、`ProjectWorkspace`、`WorkspaceView`）
  - `src/stores/`：`useCommerceStore.ts`、`useHarnessStore.ts`
- **桌面**：`desktop.py` + `JuneAI.spec` + `build-desktop.bat`
- **部署**：`docker-compose.yml` + `docker-compose.production.yml`、`deploy/nginx/`、`deploy/monitoring/`
- **运维脚本**：`backend/scripts/`（`backup.py`、`clean_test_data.py`、`security_scan.py`、`migrate_sqlite_to_postgres.py`）

## 当前状态与已知限制

| 项 | 状态 |
| --- | --- |
| 后端测试 | 91 passed（2026-09-21 实测，`--ignore=tests/test_desktop_runtime.py`） |
| 前端测试 | typecheck + vitest 6 passed + build 通过（2026-09-21 实测） |
| Playwright E2E | 2 个 spec 全部通过（2026-09-21 实测） |
| 部署 | 本机 Nginx + 自签 HTTPS 演练通过；Docker 生产编排就绪**未实跑**；无真实域名/证书 |
| 监控/备份 | 代码与配置就绪，未接入真实告警接收方与异地存储 |

## 硬性边界（改动前必读）

1. 用户侧主流程**不得**出现技术叙事（API、Base URL、框架、数据库等）；用户是零基础使用者。
2. AI 响应的服务端 `<tracking>` 元数据不得暴露给前端/API 响应。
3. 已完成（completed）路径的主对话、追问、节点修改、重新启用、补课全部拒绝。
4. 引导内容只在服务端，不提供导出/批量复制接口；不夸大防截图能力。
5. 不重新引入自动访客身份；不迁移/重写历史路径。
6. 不承诺收入，只承诺确定性交付物。
7. 真实密钥不入代码/日志/文档；破坏性数据库操作前先备份（`backend/backups/` 惯例）。
8. 追问链不做次数/层级硬上限，靠逐层压缩 + 总量封顶控制体积；追问结论必须能采纳为交付物。

## 深入文档

- [`WORK_HANDOFF.md`](WORK_HANDOFF.md) —— 最新交接状态：已完成能力、验证结果、未完成项、关键文件索引
- [`产品状态.md`](产品状态.md) —— 产品全景：状态摘要、演变链路、商业模式与 API 清单（含历史档案记录）
- [`docs/harness-api.md`](docs/harness-api.md) / [`docs/harness-data-model.md`](docs/harness-data-model.md) —— Harness 工作台接口与数据模型
- [`deploy/README.md`](deploy/README.md) —— 部署说明（Nginx 演练、监控编排、备份）
