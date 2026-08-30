# June AI Harness Data Model

SQLite 使用 additive migration。新增表不重写既有 `mvp_runs`、追问树、订单和支付数据。

## 归属与项目

- `harness_projects`：项目归属 `owner_id`，并绑定 `mvp_run_id`。路径归档后项目只读。
- `sessions` 新增 `owner_id`、`project_id`、`summary`、`permission`，兼容原有训练师会话。
- `messages` 新增 `owner_id`、`project_id`、`tokens`、`meta_json`，`role` 支持 `user | assistant | tool`。

## 内容与记忆

- `harness_files`：项目沙箱文本快照索引与内容。
- `harness_memories`：项目级 `preference | summary | fact | lesson | todo`。
- `harness_documents`：服务端生成的 Markdown 文档。

## 执行与观测

- `agent_runs`：一次执行的输入、权限、迭代数、状态、错误和脱敏上下文摘要。
- `agent_events`：append-only trace 时间线。
- `tool_calls`：工具入参摘要、结果、状态、审批状态和耗时。文件读取和写入只保存路径、字节数和 SHA-256，不保存全文。

状态集合为 `running | waiting_approval | waiting_tool | finished | failed | cancelled | rejected`。服务重启时，`running/waiting_tool` 标记为 `failed(interrupted)`；`waiting_approval` 保留现场等待用户处理。

## 工作区磁盘

`JUNE_WORKSPACE_ROOT` 控制根目录，默认 `backend/workspaces`。实际布局：

```text
workspaces/
  {project_id}/...             # 项目沙箱
  _backups/{project_id}/...    # 写入前备份
  _pending/{project_id}/...     # 等待审批的短期写入快照
```

数据库是项目、消息和 trace 的权威来源；磁盘文件用于快照和原子写入。批准、拒绝或取消后会删除 pending 快照。生产部署应把该目录挂载到独立卷并纳入现有备份策略。
