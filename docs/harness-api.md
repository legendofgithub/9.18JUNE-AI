# June AI Harness API

所有 Harness API 均复用用户 Bearer Token，并按 `owner_id` 隔离。归档项目只允许读取列表、消息、上下文概览、文件索引和文档；创建、修改、上传、压缩、删除和 Agent 执行要求所属商业 MVP 路径仍为 `active`。

## 项目与会话

- `GET /api/harness/projects`：列出项目、会话、消息和权限。
- `POST /api/harness/projects`：创建项目；必须已购买、已启动训练师且存在 active MVP 路径。
- `PATCH /api/harness/projects/{id}`：更新标题或 metadata。
- `DELETE /api/harness/projects/{id}`：删除项目及服务端工作区数据。
- `POST /api/harness/projects/{id}/sessions`：创建会话。
- `PATCH /api/harness/sessions/{id}`：更新标题或权限。
- `DELETE /api/harness/sessions/{id}`：删除会话；每个项目至少保留一个。
- `POST /api/harness/projects/migrate`：一次性迁移旧 `localStorage` 项目快照。

权限值为 `read-only`、`workspace-write`、`full-access`。后两者仅在产品沙箱、记忆和文档内生效，不授予服务器 shell 或项目外文件能力。

## 文件、记忆与文档

- `POST /api/harness/sessions/{id}/files`：上传文本快照；单文件 10MB、单次 200 个、总量 100MB。
- `GET /api/harness/sessions/{id}/files`：列出文件索引，不返回全文。
- `GET /api/harness/sessions/{id}/memories`
- `POST /api/harness/sessions/{id}/memories`
- `DELETE /api/harness/memories/{id}`
- `GET /api/harness/sessions/{id}/documents`
- `POST /api/harness/sessions/{id}/documents`
- `GET /api/harness/documents/{id}/download`
- `DELETE /api/harness/documents/{id}`

上传和写入接口在服务端重新规范化路径，拒绝绝对路径、`..`、符号链接逃逸和二进制空字节。

## 上下文

- `GET /api/harness/sessions/{id}/context`：返回 token 预算、组成、截断状态和消息计数。普通用户不返回完整调试消息；管理员返回 `messages`。
- `POST /api/harness/sessions/{id}/context/compress`：生成早期对话摘要并替换后续打包时的早期历史。

## Agent 执行

- `POST /api/harness/sessions/{id}/run`
- `POST /api/harness/agent-runs/{id}/resume`
- `POST /api/harness/agent-runs/{id}/cancel`
- `POST /api/harness/agent-runs/{id}/approval`
- `GET /api/harness/agent-runs/{id}`

`run` 和 `resume` 返回 SSE。事件名为：

- `run.start`
- `context`
- `message.delta`
- `tool.start`
- `tool.end`
- `approval.required`
- `run.end`
- `error`

执行最多 6 轮工具迭代，工具超时 10 秒。`write_file` 只产生待审批变更；`approval` 批准后才写入，写入使用临时文件和原子替换，旧文件会备份到 `_backups`。
刷新页面后，项目列表中的当前会话会携带最近一次 `agentRun` 与 trace；若它处于 `waiting_approval`，前端会恢复审批入口。
