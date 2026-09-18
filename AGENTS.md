# June AI 项目说明（AI 助手自动加载）

## 项目是什么

June AI：面向零基础用户的「Vibe Coding 变现训练」**免费**产品。用户 BYOK 连接自己的 AI 工具，在 10 个必经节点引导下做出可售卖的最小商业 MVP。核心特色是**无限追问链**（层级/次数不限、逐层压缩 + 总量封顶、结论可采纳为交付物）。已完成 注册登录 → 免费启动 → 训练流程 → 完成归档 → 管理审计 的完整闭环（支付链已于 2026-09-18 整体移除，orders/products/entitlements 相关代码已不存在，勿重新引入）。

- 定位：本地可测试的免费产品，**不是**生产上线版本（Docker 编排未实际运行过；支付链已整体移除）。
- 产品演变：AI 扫盲学堂 → 超级个体训练官 → Vibe Coding 训练官 → June AI 登录门禁态。**不要用早期定位理解当前产品。**

## 技术栈与结构

- 后端：FastAPI + SQLite，分层架构 routes / services / repositories / models。
  - 核心文件：`backend/app/services/`（agent_service.py、commerce_service.py、payment_service.py、mvp_service.py）、`backend/app/repositories/commerce_repo.py`、`backend/app/models/database.py`
  - Harness 工作台：`backend/app/services/tool_registry.py`（路径沙箱工具）、`backend/app/routes/harness.py`
- 前端：React 19 + TypeScript + Vite + Zustand + Tailwind 4，hash 路由。
  - 核心文件：`frontend/src/components/commerce/`、`frontend/src/stores/useCommerceStore.ts`、`useHarnessStore.ts`
- 桌面版：PyInstaller 打包（`desktop.py`、`JuneAI.spec`、`build-desktop.bat` → `dist\JuneAI\JuneAI.exe`）。
- 部署：`docker-compose.yml` + `docker-compose.production.yml`、`deploy/nginx/`、`deploy/monitoring/`（Prometheus/Alertmanager，代码就绪未实跑）。

## 常用命令

```powershell
# 后端测试（注意：用 backend/.venv，根目录 .venv 的系统 Python 已失效）
cd backend && .venv/Scripts/python.exe -m pytest tests -q

# 前端
cd frontend && npm run dev        # 开发，http://localhost:5173
npm run typecheck && npm test -- --run && npm run build

# 后端开发服务
cd backend && .venv/Scripts/python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

测试：`pytest tests -q --ignore=tests/test_desktop_runtime.py` → **102 passed**（该文件因本机 FastAPI 版本漂移无法收集，业务测试不受影响；测试数以实跑为准，不要写死）。
已修复 `app/main.py` 前端静态托管使用 `app.frontend()` 导致的 FastAPI 版本漂移——只要 `frontend/dist` 存在，生产与桌面模式下后端会直接 `AttributeError`，现已改为 `StaticFiles` 挂载 + SPA fallback。

## 硬性边界（违反会破坏产品承诺）

1. 用户侧主流程**不得**出现技术叙事（API、Base URL、框架、数据库、Prompt 工程等）；用户是零基础商业者。
2. AI 响应中的服务端 `<tracking>` 元数据不得暴露给前端/API 响应。
3. 已完成（completed）的路径：主对话、追问、节点修改、重新启用、补课全部拒绝；口头说"没完成"不改变客观完成状态。
4. 付费课程内容只在服务端，不提供任何导出/批量复制接口；不得向用户夸大防截图能力。
5. 不重新引入自动访客身份（guest-...@june.local）；不迁移/重写历史路径。
6. 不承诺收入；产品只承诺确定性交付物。
7. 任何真实 API Key、支付密钥、数据库敏感信息不得写入代码、日志或文档。
8. 破坏性数据库操作前必须先备份（参考 `backend/backups/` 惯例）。
9. 管理员密码只存在于本地 `backend/.env` 或部署环境变量，不入源码。
10. **无限追问是产品承诺**：不得给追问加次数、层级、额度上限。层级无限时靠「逐层压缩 + 总量封顶」控制体积（`MvpService._ancestry_blocks` / `FOLLOW_UP_BUDGET`），不得改成硬截断或直接丢弃祖先上下文。
11. 追问结论必须能回流：`stream_follow_up` 结束要写 `thread_states.summary`，用户可「采纳为交付物」写入当前节点。删掉这两条就等于把追问变成闲聊，破坏产品闭环。
12. 路径归档后仍禁止提问与采纳（`_reject_completed`），但 `build_report` 必须输出「追问探索记录」。

## 追问链实现方式（改动前必读）

- 线程是 `parent_thread_id` 自引用的树，`main` 派生的第一层是 L2，逐层 +1，深度不限。
- 上下文组装：`_build_follow_up_messages` 批量预载线程节点/状态/消息后由 `SessionRepository.walk_ancestry` 内存回溯（与 `get_thread_ancestry` 语义一致，消除逐层查询的 N+1）；distance 0/1/2/更远分别保留 12/6/4/2 条、每条 1200/600/400/300 字符；远层优先用 `summary`；总量超 `FOLLOW_UP_BUDGET` 时从头部截断。
- 膨胀保护：`get_recent_messages` 取代无上限的 `get_all_messages`，详情接口每条链最多返回 100 条。
- 追问前端入口在 `CoachChatPanel`（中栏「跟练对话」tab）+ `FollowUpWindow`（可堆叠悬浮窗），Agent 工作台是并列 tab，不要再把追问塞回 Harness 流程。

## 深入阅读

- `WORK_HANDOFF.md` —— 最新交接状态：已完成能力、验证结果、未完成项、关键文件索引
- `产品状态.md` —— 产品全景：演变链路、商业模式、API 清单、登录体系、上线待办
- `docs/harness-api.md`、`docs/harness-data-model.md` —— Harness 工作台接口与数据模型
- `COMMERCIALIZATION.md` —— 商业化文档
