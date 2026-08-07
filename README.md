# June AI 伴学系统 v2.0

AI 伴学工具 —— 通过悬浮窗交互、追问链机制和流式 AI 对话，解决传统 Chat 界面难以进行沉浸式学习的问题，帮助学习者将细节问题追问到底，进入心流状态。

## 核心概念

日常 AI 学习中的一个痛点：在传统的 Chat 窗口中，对话是线性的，学到中途冒出的疑问很难在不丢失上下文的情况下深入追问。June AI 通过**悬浮窗 + 追问链**的设计，让学习者可以选中任意 AI 回复中的文字或截图，打开子对话线程，逐层深入追问，形成树状知识探索路径，直到彻底理解。

## 功能特性

- **主对话** — 与 AI 伴学助手自由对话，SSE 流式输出，打字机效果实时呈现
- **文字追问** — 选中 AI 回复中的任意文字，右键发起 L2/L3 多层追问
- **截图追问** — 截图窗口叠加，选中屏幕内容即可跟进提问
- **追问树** — 每一次追问生成独立的子线程，父层对话历史自动注入上下文，保证 AI 回答的连贯性
- **DeepSeek 驱动** — 对接 DeepSeek Chat (V3) 和 DeepSeek Reasoner (R1) 模型，支持配置 API Key
- **安全认证** — Bearer Token + Query 参数双通道鉴权，所有 `/api/` 接口受保护
- **持久化存储** — SQLite + SQLAlchemy ORM，支持会话、消息、追问线程级联管理
- **进程守护** — 内置 Watchdog，崩溃自动重启，不掉线
- **端到端测试** — 10 条核心链路自动化验证，覆盖鉴权、CRUD、异常路径

## 项目结构

```
ai-study-tool/
├── backend/                        # Python FastAPI 后端
│   ├── app/
│   │   ├── main.py                 # 应用入口，lifespan 管理，异常处理器，CORS
│   │   ├── core/                   # 核心基础设施
│   │   │   ├── config.py           # Pydantic Settings 分环境配置
│   │   │   ├── security.py         # TokenAuthMiddleware（Bearer + query）
│   │   │   ├── exceptions.py       # 统一业务异常类（JuneException 基类）
│   │   │   └── response.py         # 统一响应格式 Result<T>
│   │   ├── models/
│   │   │   ├── database.py         # SQLAlchemy ORM（sessions/messages/threads）
│   │   │   └── schemas.py          # Pydantic 请求/响应模型
│   │   ├── repositories/           # 数据访问层（Repository 模式）
│   │   │   └── session_repo.py     # 会话仓库（get/find/exists 命名规范）
│   │   ├── services/               # 业务逻辑层
│   │   │   ├── session_service.py  # 会话服务（主对话 + 追问编排）
│   │   │   ├── deepseek.py         # DeepSeek API 流式对话
│   │   │   └── thread_manager.py   # 追问线程生命周期管理
│   │   ├── routes/                 # 接口层（薄控制器）
│   │   │   ├── sessions.py         # 会话 CRUD + SSE 流式接口
│   │   │   └── models.py           # 模型列表与 API Key 配置
│   │   └── utils/
│   │       └── sse_utils.py        # SSE 事件构造工具
│   ├── tests/
│   │   ├── test_core.py            # 异常、响应、配置、Token、数据库集成测试
│   │   ├── test_session_repo.py    # Repository 层测试（16 条全 CRUD）
│   │   ├── test_session_service.py # Service 层测试（含流式 mock）
│   │   └── test_deepseek_service.py # DeepSeek 服务测试
│   ├── e2e_test.py                 # 端到端验证脚本（10 条核心链路）
│   ├── requirements.txt
│   ├── .env.example                # 生产环境配置模板
│   └── .env                        # 本地配置（不提交）
│
├── frontend/                       # React + TypeScript 前端
│   ├── src/
│   │   ├── App.tsx                 # 应用根组件
│   │   ├── components/
│   │   │   ├── chat/               # 对话组件（MessageList, MessageBubble, InputBar）
│   │   │   ├── float/              # 悬浮追问窗（FloatWindow, FloatWindowLayer）
│   │   │   ├── layout/             # Header（含 Token 状态指示器 + 设置弹窗）
│   │   │   ├── menu/               # 右键上下文菜单
│   │   │   └── ScreenshotOverlay.tsx
│   │   ├── services/
│   │   │   └── sseService.ts       # SSE 流式通信（含 Token 管理）
│   │   ├── stores/
│   │   │   └── useJuneStore.ts     # Zustand 全局状态（悲观 CRUD）
│   │   ├── types/
│   │   │   └── index.ts            # TypeScript 类型定义
│   │   └── utils/
│   │       └── floatManager.ts     # 悬浮窗管理工具
│   ├── package.json
│   └── vite.config.ts
│
├── setup.bat                       # 首次安装（依赖 + 虚拟环境）
├── run.bat                         # 日常启动（watchdog + vite）
├── watchdog.py                     # 进程守护（health 探测 + 自动重启）
└── README.md
```

## 架构设计

### 后端三层分层

```
Interface (routes/)  →  Application (services/)  →  Domain (repositories/)
       ↑                        ↑                         ↑
  薄控制器层              业务编排层                 数据访问层
  HTTP 参数提取           CRUD 协调                 get/find/exists
  统一响应包装            事务管理                   SQLAlchemy ORM
```

**依赖规则：**
- routes 依赖 services，services 依赖 repositories
- services 使用构造函数注入（`SessionService(repo, deepseek, thread_mgr)`）
- 不存在循环依赖，每层职责清晰

### 统一响应格式

所有 API 接口返回 `Result<T>` 格式：

```json
{
  "code": 200,
  "message": "操作成功",
  "data": { ... },
  "timestamp": 1718697600000
}
```

异常由全局 `GlobalExceptionHandler` 统一捕获，业务异常抛出 `JuneException` 系列即可。

### 安全认证

- **Token 传递方式**：请求头 `Authorization: Bearer <token>` 或 URL 参数 `?token=<token>`（SSE 兼容）
- **首次启动**：自动生成 64 位 hex token 并提示复制
- **公开路径**：`/health`、`/docs`、`/assets/*`、`/index.html`、`/` 无需认证
- **认证失败**：返回 HTTP 401，响应体包含 `{code: 401, message: "未授权访问..."}`

## 技术栈

| 层面     | 技术                                           |
|----------|------------------------------------------------|
| 后端     | Python 3.10+, FastAPI 0.115, Uvicorn 0.30      |
| 数据库   | SQLite + SQLAlchemy 2.0 ORM                    |
| 配置     | Pydantic Settings 2.5（分环境模板）            |
| 前端     | React 19, TypeScript 5.7, Vite 6, Tailwind CSS 4 |
| 状态管理 | Zustand 5                                      |
| AI 模型  | DeepSeek Chat (V3) / DeepSeek Reasoner (R1)    |
| 通信     | SSE (Server-Sent Events)，sse-starlette 2.1    |
| 测试     | pytest 9.1 + pytest-asyncio，E2E 自动化脚本    |
| 守护     | watchdog.py（每 10s health 探测，连续 3 次失败重启）|

## 快速开始

### 前置条件

- Python 3.10+
- Node.js 18+
- DeepSeek API Key（在 [platform.deepseek.com](https://platform.deepseek.com) 获取）

### Windows 用户

**前置条件：** Python 3.10-3.12（推荐）、Node.js 18+ 已安装并在 PATH 中。

**首次运行（仅一次）：**
```
双击 setup.bat
```

自动完成：创建虚拟环境 → 安装 Python 依赖 → 安装 Node.js 依赖。大约需要 2-5 分钟（看网速）。

> **常见安装问题：** 如果报 `pydantic-core` 编译错误（`Rust/Cargo not installed`），
> 说明 pip 没找到预编译的 wheel 包。请升级 pip 后重试：
> ```
> .venv\Scripts\python.exe -m pip install --upgrade pip
> .venv\Scripts\pip.exe install -r backend\requirements.txt
> ```

**日常启动：**
```
双击 run.bat
```

自动完成：启动 watchdog 守护后端（端口 8000）→ 启动前端 Vite（端口 5173）。后端崩溃自动重启，无需手动管理。

**可选配置 DeepSeek API Key：** 编辑 `backend\.env`，将 `DEEPSEEK_API_KEY=sk-your-deepseek-api-key-here` 替换为你的真实 Key。不配也能用（mock 模式）。

### Mac / Linux 用户

```bash
# 首次：安装依赖
cd backend && python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt && cd ..
cd frontend && npm install && cd ..

# 启动后端
cd backend && uvicorn app.main:app --host 0.0.0.0 --port 8000 &

# 启动前端
cd frontend && npm run dev
```

Mac/Linux 暂无 watchdog，建议用 `while true; do ...; done` 或 systemd 实现守护。

### 首次配置 Token

1. 启动后端后，控制台会打印 API Token（或查看 `.env` 中的 `JUNE_API_TOKEN`）
2. 打开 `http://localhost:5173`
3. 点击右上角 Header 区域的 Token 状态图标
4. 在设置弹窗中粘贴 Token，点击「验证」
5. 看到绿色 ✓ 即表示连接成功

## API 概览

| 方法   | 路径                                | 说明                    | 认证  |
|--------|-------------------------------------|-------------------------|-------|
| GET    | `/health`                           | 健康检查                | 否    |
| GET    | `/api/status`                       | 系统状态（DB、Token）   | 是    |
| POST   | `/api/sessions`                     | 创建会话                | 是    |
| GET    | `/api/sessions`                     | 会话列表                | 是    |
| GET    | `/api/sessions/{id}`                | 会话详情（含消息）      | 是    |
| DELETE | `/api/sessions/{id}`                | 删除会话（级联）        | 是    |
| POST   | `/api/sessions/{id}/chat`           | 主对话（SSE 流式）      | 是    |
| POST   | `/api/sessions/{id}/follow-up`      | 追问（SSE 流式）        | 是    |
| GET    | `/api/models`                       | 可用模型列表            | 是    |
| PUT    | `/api/config/api-key`               | 设置 DeepSeek API Key   | 是    |

**认证方式：**
```bash
# Bearer Token
curl -H "Authorization: Bearer <token>" http://localhost:8000/api/status

# Query 参数（SSE 场景兼容）
curl http://localhost:8000/api/sessions?token=<token>
```

## 测试

### 单元测试

```bash
cd backend
python -m pytest tests/ -v
```

共 56 条测试，覆盖：
- **Core 层**：异常类、响应格式、配置校验、Token 认证、数据库集成
- **Repository 层**：16 条全 CRUD（创建/读取/更新/删除/查询/级联）
- **Service 层**：会话编排、流式对话 mock、追问线程注册
- **DeepSeek 层**：API Key 管理、mock 流式响应、错误处理

### 端到端测试

```bash
cd backend
python e2e_test.py
```

10 条核心链路自动验证：
1. 健康检查（无需认证）
2. 无 Token 访问 → HTTP 401
3. 错误 Token → HTTP 401
4. 正确 Token → 系统状态正常
5. Query 参数 Token 访问
6. 创建会话
7. 获取会话详情
8. 不存在的资源 → JSON code:404
9. 删除会话（级联）
10. 删除后再次获取 → 404

## 进程守护

`watchdog.py` 提供生产级进程监控：

```
用法：python watchdog.py [--port 8000] [--interval 10] [--max-failures 3]

工作原理：
  - 每 10 秒向 http://127.0.0.1:8000/health 发送探测
  - 连续 3 次失败 → kill 旧进程 → 重启 uvicorn
  - 支持 Windows (CREATE_NEW_PROCESS_GROUP) 和 Linux (start_new_session)
  - 日志带时间戳，记录重启次数
```

`start.bat` 已集成 watchdog，无需单独配置。

## 配置参考

### 环境变量

| 变量              | 说明                        | 默认值            | 生产必填 |
|-------------------|-----------------------------|-------------------|----------|
| `JUNE_ENV`        | 运行模式（development/production）| `development` |  否   |
| `JUNE_DEBUG`      | 调试模式                    | `false`           | 否       |
| `DEEPSEEK_API_KEY`| DeepSeek API 密钥           | -                 | 是       |
| `JUNE_API_TOKEN`  | 接口鉴权 Token（≥16 字符）  | 自动生成          | 是       |
| `JUNE_DB_PATH`    | SQLite 数据库路径           | `backend/june.db` | 否       |
| `SERVER_PORT`     | 服务端口                    | `8000`            | 否       |

### 开发 vs 生产

**开发模式（`JUNE_ENV=development`）：**
- 允许不配置 `DEEPSEEK_API_KEY`（使用 mock 回复）
- 未配置 `JUNE_API_TOKEN` 时自动生成
- 启动不拦截，兼容开箱即用

**生产模式（`JUNE_ENV=production`）：**
- 强制校验 `DEEPSEEK_API_KEY` 和 `JUNE_API_TOKEN`
- 缺少任一必填项 → 启动失败，输出错误提示
- 关闭 DEBUG 日志

## 开发说明

- **数据持久化**：使用 SQLite + SQLAlchemy ORM，支持会话/消息/追问线程三表级联删除
- **Repository 命名规范**：`get_` 必须返回值否则抛异常，`find_` 可返回 None，`exists_` 返回布尔
- **追问线程管理**：空闲 600 秒自动清理超时线程，`ThreadManager` 独立生命周期
- **SSE 鉴权**：前端 EventSource 不支持自定义请求头，通过 URL `?token=` 参数传递
- **CORS**：开发模式默认允许 `localhost:5173` 和 `localhost:3000`

## 相关资源

- [DeepSeek API 文档](https://platform.deepseek.com/api-docs)
- [FastAPI 文档](https://fastapi.tiangolo.com/)
- [SQLAlchemy 2.0 文档](https://docs.sqlalchemy.org/en/20/)
- [Pydantic Settings](https://docs.pydantic.dev/latest/concepts/pydantic_settings/)
- [Zustand 文档](https://docs.pmnd.rs/zustand)
