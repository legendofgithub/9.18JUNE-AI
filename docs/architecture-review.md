# 架构评审：对标业界先进实践（2026-09-10）

> 结论先行：当前「单体 FastAPI + SQLite + React SPA + SSE」的选择**与产品阶段匹配**，不需要微服务化或引入消息队列。真正的差距在五个可渐进补齐的点：数据库并发上限、上下文工程的语义化、可观测性深度、追问质量评估体系、Agent 执行的持久化强度。**所有改进以不破坏「无限追问」产品承诺为前提**（AGENTS.md 硬性边界 10-12）。

## 1. 逐项对比

| 维度 | June AI 现状 | 业界先进实践 | 差距评估 |
| --- | --- | --- | --- |
| 数据库 | SQLite 单写者，复合主键多租户 | Postgres + 连接池 + 只读副本；pgvector | **P1**：多用户并发写入会撞 `database is locked`；迁移脚本已有（`migrate_sqlite_to_postgres.py`） |
| 上下文工程 | 规则压缩：distance 分级保留 + 摘要沉淀 + 尾部封顶 | 分层摘要（LLM 辅助 compaction）、向量召回相关历史、MemGPT 式记忆分层 | **P2**：规则摘要零成本且确定性好；缺「语义相关」召回——远层只按距离压缩，不按相关性选择 |
| 追问/Agent 评估 | 无质量评估，仅功能测试 | Golden 数据集 + LLM-as-judge 回归、prompt 版本 diff 评测 | **P2**：改提示词无回归护栏，回答质量靠人工 |
| 可观测性 | 计数器 + JSONL 日志 + 追问深度计数 | OpenTelemetry 分布式追踪、LLM 调用的 token/延迟/成本直方图、按用户计费口径 | **P2**：出问题只能看日志；token 消耗无口径（BYOK 下用户自担费用，更需要可见） |
| Agent 执行 | 6 轮循环、审批、断点恢复（重启标记 failed/interrupted） | 持久化执行（durable execution）、并行工具调用、自动重试与降级 | **P3**：现有循环简洁可审计，恢复机制已有；缺并行工具与重试策略 |
| 流式 | SSE（ASGI 生命周期修复过） | SSE 仍为主流选择；增加心跳、断线续传、背压 | **P3**：无心跳，代理超时风险；EventSource 自动重连会重放整段 |
| 支付可靠性 | 幂等确认 + webhook 验签 + payment_events 对账流水 | Outbox 模式、定时对账任务、自动退款流程 | **P3**：对账有数据无任务；退款未实现（已知） |
| 部署 | 单容器 + Nginx；备份 sidecar；监控编排未实跑 | 蓝绿/滚动发布、健康检查驱逐、多可用区 | **P4**：当前规模过度设计，上线后按需 |
| 安全 | 限流/锁定/审计/密钥加密/路径沙箱/验签 | 管理 2FA、密钥托管（vault）、内容级防泄漏 | **P3**：2FA 已在上线待办 |

## 2. 已执行（2026-09-10，本轮）

1. **追问链 N+1 消除**（语义零变化）：`_build_follow_up_messages` 批量预载线程/状态/消息后由 `walk_ancestry` 内存回溯。实测 30 层深链：随链深增长查询从 +3/层 降为 **0/层**（链深 1 与链深 30 均为 33 条固定 SQL）；末层 prompt 与优化前逐字节一致；11 个追问测试全过。
2. **追问观测指标**：`/metrics` 新增 `june_follow_up_total`、`june_follow_up_depth_total`（Prometheus 文本格式同步暴露）。
3. **深链验证工具**：`backend/scripts/verify_deep_chain.py`——30 层追问的运行时回归脚本，校验上下文完整性、预算封顶、摘要沉淀与查询成本，可进 CI。
4. **架构文档**：`docs/architecture.md`（本仓库首份架构图文档）。

## 2b. 已执行（2026-09-18 可维护性重构，四阶段八提交）

1. **后端仓储收口**：services 层 16 处 `repo.db` 穿透全部清零（admin 统计→`overview_stats()`；账号提权/模型服务写路径、mvp 的 artifact/event/tracking 落库、agent 迭代计数分别下沉 commerce_repo / harness_repo，方法自带 commit）。事务语义不变：routes 层零 commit + 请求末尾 rollback 的约束下，每条写路径的落库点收口进仓储。
2. **前端网络层统一**：`services/apiClient.ts` 收编双 store 重复的 authHeaders/request/streamRequest/streamEvents。
3. **类型按域拆分**：`types/commerce.ts` + `types/harness.ts`，清除 18 个遗留死类型；`types/index.ts` 变 re-export，消费方 import 路径不变。
4. **useCommerceStore 切片组合**：765 行拆为 auth/commerce/workspace/admin 四片 + storeShape 交集类型；对外 hook 名与全部 selector 名不变，消费组件零改动；删除无消费者的 `loadOrders`。
5. **ProjectWorkspace 拆分**：589 行拆为 AgentChatPanel / ProjectTreePanel / RightSidebarBody / workspace/report.ts；父组件 255 行只留布局、tab 状态与跨块状态。
6. **e2e 修复**：`harness-workspace.spec.ts` 补 Agent 工作台 tab 切换步骤（该失败在重构前已存在——8-30 引入 CoachChatPanel 默认 tab 后 spec 未跟进），现 Playwright 2/2 通过，Agent 审批流端到端护住重构后组件。
7. 验证基线：后端 102 passed + 深链脚本 OK；前端 typecheck + 8 unit + build + Playwright 2 passed。


## 3. 改进路线（按优先级，全部追问安全）

### P1 上线前置（真实用户 > 1 人时必须）

- **Postgres 迁移**：跑通现有迁移脚本 → compose 增加 Postgres 服务 → `connection_url` 切换。SQLite 保留为桌面版形态。追问链查询全部走 ORM，无需改动。
- **定时对账任务**：读 `payment_events` 与 Stripe API 核对订单状态（脚本 + cron 即可，不引入队列）。

### P2 质量与可见性（上线后一个月内）

- **OTel 接入**：trace 覆盖 follow-up / agent 两条链路；每次追问记录 token 用量、首字延迟、链深。
- **LLM 辅助摘要（可选增强）**：`_summarize_thread` 保持规则版为默认与兜底，预算充足时可选模型压缩，失败自动回落规则版——增强远层记忆而不改变封顶语义。
- **追问回归评测**：把 `verify_deep_chain.py` 的断言扩展为「上下文召回 golden 集」：固定 10 条深链 + 期望 prompt 必含/必不含片段，防 prompt 改动回归。

### P3 体验与韧性

- SSE 心跳与断线续传（Last-Event-ID）。
- Agent 工具并行调用与失败重试策略；webhook Outbox。
- 管理员 2FA（已在上线待办）。

### P4 规模化（用户量验证后再做）

- 读写分离、语义缓存、多可用区部署。
- pgvector 语义召回祖先链：与规则压缩并存，召回结果只做「补充上下文」不参与封顶计算，保证确定性不回退。

## 4. 明确不做

- 不引入消息队列/Kafka：单机 MVP 无此规模，徒增运维面。
- 不微服务化：分层单体 + 桌面双形态是产品特性，不是债务。
- 不给追问加任何形式的上限：见 AGENTS.md 边界 10；封顶只作用于「单次请求携带的上下文字符数」，不作用于链本身。
