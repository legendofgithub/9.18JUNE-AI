# June AI 架构文档

> 2026-09-10 基于当前代码绘制。配合 `docs/architecture-review.md`（业界对标与改进路线）阅读。

## 1. 系统上下文

```mermaid
graph TB
    subgraph 用户侧
        U[零基础商业用户<br/>浏览器 / Windows 桌面版]
    end
    subgraph 本机或服务器
        subgraph FE[前端 React 19 SPA]
            W[WorkspaceView 三栏工作台]
            FUP[CoachChatPanel + FollowUpWindow<br/>追问链入口]
            HW[ProjectWorkspace<br/>Agent 工作台]
            ADM[AdminView 管理后台]
            ST[useCommerceStore / useHarnessStore<br/>Zustand]
        end
        subgraph BE[后端 FastAPI]
            MW[TokenAuth + Observability 中间件]
            RT[routes: auth / commerce / harness / admin / models]
            SV[services: mvp / agent / commerce / payment / auth / admin]
            TR[tool_registry 路径沙箱工具]
            RP[repositories: commerce / session / harness]
        end
        DB[(SQLite<br/>SQLAlchemy)]
        LLM[用户的 AI 工具<br/>OpenAI-compatible API]
        STRIPE[Stripe Checkout<br/>+ 签名 Webhook]
    end
    U -->|HTTPS / hash 路由| FE
    ST -->|REST + SSE| MW
    MW --> RT --> SV --> RP --> DB
    SV -->|BYOK 服务端代理| LLM
    SV -->|创建 Session| STRIPE
    STRIPE -->|checkout.session.completed<br/>HMAC 验签| RT
```

## 2. 商业闭环数据流

```mermaid
graph LR
    A[注册 / 登录<br/>限流 + 锁定] --> B[下单 39 元解锁]
    B --> C{支付方式}
    C -->|沙箱| D[幂等确认 confirm]
    C -->|Stripe| E[Checkout Session<br/>Webhook 验签发放权益]
    D --> F[(entitlements)]
    E --> F
    F --> G[启动超级个体训练师<br/>BYOK 密钥加密保存]
    G --> H[10 节点按序完成]
    H --> I[completed 归档锁定<br/>_reject_completed]
    I --> J[build_report<br/>含追问探索记录]
    G -.-> K[audit_logs / metrics / 埋点]
```

## 3. 无限追问链（核心机制）

```mermaid
sequenceDiagram
    participant FE as FollowUpWindow / CoachChatPanel
    participant API as POST /mvp-runs/{id}/follow-up (SSE)
    participant MVP as MvpService.stream_follow_up
    participant SR as SessionRepository
    participant LLM as 用户 BYOK 模型

    FE->>API: thread_id / parent_thread_id / level / query
    API->>API: metrics.inc(follow_up_total, depth)
    API->>MVP: ensure_run_available + _reject_completed
    MVP->>SR: upsert_thread / upsert_thread_state / add_message_once
    MVP->>SR: 批量预载 load_session_threads / load_thread_states / load_recent_messages_bulk
    MVP->>SR: walk_ancestry 内存回溯（语义同 get_thread_ancestry，64 层防环护栏）
    MVP->>MVP: _ancestry_blocks 按 distance 0/1/2/远 保留 12/6/4/2 条<br/>远层用 thread_states.summary；总量超 FOLLOW_UP_BUDGET 头部截断
    MVP->>LLM: messages（含系统提示词 + 追问链上下文 + 当前追问）
    LLM-->>MVP: 流式增量（<tracking> 元数据服务端剥离）
    MVP->>SR: add_message_once + update_thread_summary（结论沉淀）
    MVP-->>FE: SSE delta / done（结论可「采纳为交付物」）
```

关键不变量（改动前必读 `AGENTS.md` 硬性边界 10-12）：

- 层级、次数无上限；上下文靠「逐层压缩 + 总量封顶」控制，不硬截断、不丢祖先。
- 每次追问结束必须写 `thread_states.summary`；结论可采纳写入当前节点交付物。
- 归档路径拒绝追问与采纳。
- 上下文组装已批量预载（2026-09-10）：链深扩展的查询成本为 0，深链与首层追问同为 ~33 条固定 SQL（`backend/scripts/verify_deep_chain.py` 可复验）。

## 4. Agent 工作台（Harness）

```mermaid
graph LR
    subgraph 服务端
        AR[agent_service<br/>function calling 循环<br/>最多 6 轮 / 工具超时 10s]
        TLR[tool_registry<br/>list/read/search/write_file<br/>save_memory/create_document]
        SB[路径沙箱 safe_file_target<br/>项目根约束]
        AP[写入审批状态机<br/>waiting_approval -> 原子替换<br/>旧文件入 _backups]
    end
    AR --> TLR --> SB
    TLR -->|write_file| AP
    AR -->|SSE: 上下文/增量/工具/审批/完成| FE2[ProjectWorkspace]
```

安全边界：无 shell、无删除、无项目外写入；trace 中 `write_file` 只记路径/字节数/SHA-256，完整内容放 `_pending` 短期快照，批准/拒绝/取消后清理。

## 5. 部署拓扑

```mermaid
graph TB
    subgraph 单机
        NG[Nginx<br/>TLS 终结 / 静态资源 / SSE 反代]
        API[FastAPI 容器<br/>/api /metrics]
        BK[备份 sidecar<br/>SQLite 在线备份 + 保留策略 + 异地复制]
        MON[Prometheus / Alertmanager<br/>可选编排]
    end
    NG --> API
    BK --> DB2[(SQLite / 数据卷)]
    MON -->|抓取 /metrics（Token 保护）| API
```

状态：本机 Nginx + 自签 HTTPS 演练已通过；Docker 生产编排代码就绪未实跑；真实域名证书与真实 Stripe 密钥未接入。
