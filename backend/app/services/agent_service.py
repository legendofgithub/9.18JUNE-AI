import asyncio
import hashlib
import json
import os
import time
from pathlib import Path
from collections.abc import AsyncGenerator

from ..core.exceptions import JuneException, NotFoundException, ValidationException
from ..core.security import decrypt_api_key
from ..models.database import (
    AgentEventModel,
    AgentRunModel,
    HarnessProjectModel,
    MessageModel,
    SessionModel,
    ToolCallModel,
)
from ..repositories.commerce_repo import CommerceRepository
from ..repositories.harness_repo import HarnessRepository, normalize_relative_path
from .context_builder import ContextBuilder
from .tool_registry import ToolRegistry


PERMISSION_MODES = {"read-only", "workspace-write", "full-access"}
TEXT_EXTENSIONS = {
    ".txt", ".md", ".markdown", ".json", ".csv", ".tsv", ".yaml", ".yml",
    ".py", ".js", ".ts", ".tsx", ".jsx", ".css", ".html", ".xml", ".svg",
    ".log", ".ini", ".toml", ".sql", ".sh", ".ps1",
}


class AgentService:
    def __init__(
        self,
        harness_repo: HarnessRepository,
        commerce_repo: CommerceRepository,
        llm_service,
        workspace_root: Path,
        metrics=None,
    ):
        self.repo = harness_repo
        self.commerce = commerce_repo
        self.llm = llm_service
        self.metrics = metrics
        self.tools = ToolRegistry(harness_repo, workspace_root)
        self.contexts = ContextBuilder(harness_repo)

    # ---- access ----

    def list_projects(self, owner_id: str) -> list[dict]:
        return [self._project_detail(project) for project in self.repo.list_projects(owner_id)]

    def create_project(self, owner_id: str, title: str, mvp_run_id: str | None, metadata: dict) -> dict:
        run = self._active_run(owner_id, mvp_run_id)
        self._require_paid_model(owner_id, run.id)
        project = self.repo.create_project(owner_id, run.id, title, metadata)
        self.tools.project_root(project)
        return self._project_detail(project)

    def update_project(self, owner_id: str, project_id: str, title: str, metadata: dict | None) -> dict:
        project = self._require_active_project(owner_id, project_id)
        self._require_paid_model(owner_id, project.mvp_run_id)
        return self._project_detail(self.repo.update_project(project, title, metadata))

    def delete_project(self, owner_id: str, project_id: str) -> None:
        project = self._require_project_access(owner_id, project_id)
        self.tools.remove_project_files(project)
        self.repo.delete_project(project)

    def create_session(self, owner_id: str, project_id: str, title: str) -> dict:
        project = self._require_active_project(owner_id, project_id)
        self._require_paid_model(owner_id, project.mvp_run_id)
        return self._session_detail(self.repo.create_session(owner_id, project.id, title))

    def update_session(self, owner_id: str, session_id: str, title: str | None, permission: str | None) -> dict:
        session = self.repo.get_session(owner_id, session_id)
        project = self._require_active_project(owner_id, session.project_id)
        if permission and permission not in PERMISSION_MODES:
            raise ValidationException("权限模式不合法")
        self._require_paid_model(owner_id, project.mvp_run_id)
        return self._session_detail(self.repo.update_session(session, title, permission))

    def delete_session(self, owner_id: str, session_id: str) -> None:
        session = self.repo.get_session(owner_id, session_id)
        project = self._require_active_project(owner_id, session.project_id)
        self._require_paid_model(owner_id, project.mvp_run_id)
        sessions = self.repo.list_sessions(project)
        if len(sessions) <= 1:
            raise ValidationException("每个项目至少保留一个会话")
        self.repo.delete_session(session)

    def upload_files(self, owner_id: str, session_id: str, files: list[dict]) -> dict:
        session = self.repo.get_session(owner_id, session_id)
        project = self._require_project_access(owner_id, session.project_id)
        self._require_write(owner_id, project, session.permission)
        if len(files) > 200:
            raise ValidationException("单次最多上传 200 个文件")
        total = sum(len(str(item.get("content") or "").encode("utf-8")) for item in files)
        if total > 100 * 1024 * 1024:
            raise ValidationException("单次上传总量超过 100MB")
        saved = []
        for item in files:
            path = str(item.get("path") or "")
            suffix = Path(path).suffix.lower()
            mime_type = str(item.get("mime_type") or "text/plain")
            content = str(item.get("content") or "")
            if suffix not in TEXT_EXTENSIONS and not mime_type.startswith("text/"):
                raise ValidationException(f"仅支持上传文本类文件：{path}")
            if len(content.encode("utf-8")) > 10 * 1024 * 1024:
                raise ValidationException(f"文件超过 10MB 限制：{path}")
            if "\x00" in content:
                raise ValidationException(f"文件包含二进制空字节：{path}")
            target, relative = self.tools.safe_file_target(project, path)
            temporary = target.with_name(f".{target.name}.{os.urandom(6).hex()}.tmp")
            target.parent.mkdir(parents=True, exist_ok=True)
            try:
                with temporary.open("w", encoding="utf-8", newline="") as stream:
                    stream.write(content)
                    stream.flush()
                    os.fsync(stream.fileno())
                os.replace(temporary, target)
            finally:
                if temporary.exists():
                    temporary.unlink()
            record = self.repo.upsert_file(
                project,
                relative,
                str(item.get("name") or target.name),
                mime_type,
                content,
            )
            saved.append(self._file_detail(record))
        return {"files": saved, "count": len(saved), "totalBytes": total}

    def list_files(self, owner_id: str, session_id: str) -> list[dict]:
        session = self.repo.get_session(owner_id, session_id)
        self._require_project_access(owner_id, session.project_id)
        return [self._file_detail(item) for item in self.repo.list_files(session.project_id)]

    def get_context(self, owner_id: str, session_id: str, include_debug: bool = False) -> dict:
        session = self.repo.get_session(owner_id, session_id)
        project = self._require_project_access(owner_id, session.project_id)
        context = self._build_context(project, session)
        if not include_debug:
            context.pop("messages", None)
        return context

    def compress_context(self, owner_id: str, session_id: str) -> dict:
        session = self.repo.get_session(owner_id, session_id)
        project = self._require_active_project(owner_id, session.project_id)
        self._require_paid_model(owner_id, project.mvp_run_id)
        messages = self.repo.list_messages(session.id)
        summary = ContextBuilder.summarize(messages)
        self.repo.set_session_summary(session, summary)
        context = self._build_context(project, session)
        context.pop("messages", None)
        return {"summary": summary, "context": context}

    def add_memory(self, owner_id: str, session_id: str, memory_type: str, content: str) -> dict:
        session = self.repo.get_session(owner_id, session_id)
        project = self._require_project_access(owner_id, session.project_id)
        self._require_write(owner_id, project, session.permission)
        return self._memory_detail(self.repo.add_memory(project, memory_type, content))

    def list_memories(self, owner_id: str, session_id: str) -> list[dict]:
        session = self.repo.get_session(owner_id, session_id)
        self._require_project_access(owner_id, session.project_id)
        return [self._memory_detail(item) for item in self.repo.list_memories(session.project_id)]

    def delete_memory(self, owner_id: str, memory_id: str) -> None:
        memory = self.repo.get_memory(owner_id, memory_id)
        project = self._require_active_project(owner_id, memory.project_id)
        self._require_paid_model(owner_id, project.mvp_run_id)
        self.repo.delete_memory(memory)

    def add_document(self, owner_id: str, session_id: str, title: str, content: str) -> dict:
        session = self.repo.get_session(owner_id, session_id)
        project = self._require_project_access(owner_id, session.project_id)
        self._require_write(owner_id, project, session.permission)
        return self._document_detail(self.repo.add_document(project, title, content))

    def list_documents(self, owner_id: str, session_id: str) -> list[dict]:
        session = self.repo.get_session(owner_id, session_id)
        self._require_project_access(owner_id, session.project_id)
        return [self._document_detail(item) for item in self.repo.list_documents(session.project_id)]

    def get_document_content(self, owner_id: str, document_id: str) -> tuple[str, str]:
        document = self.repo.get_document(owner_id, document_id)
        self._require_project_access(owner_id, document.project_id)
        return document.title, document.content

    def delete_document(self, owner_id: str, document_id: str) -> None:
        document = self.repo.get_document(owner_id, document_id)
        project = self._require_active_project(owner_id, document.project_id)
        self._require_paid_model(owner_id, project.mvp_run_id)
        self.repo.delete_document(document)

    def migrate_projects(self, owner_id: str, projects: list[dict]) -> dict:
        if len(projects) > 100:
            raise ValidationException("一次最多迁移 100 个本地项目")
        created = 0
        sessions = 0
        messages = 0
        for payload in projects:
            project_result = self.create_project(
                owner_id,
                str(payload.get("title") or "迁移项目"),
                None,
                {"source": "localStorage", "folderName": str(payload.get("folderName") or "")},
            )
            created += 1
            project = self.repo.get_project(owner_id, project_result["id"])
            for session_payload in payload.get("sessions", []):
                if sessions >= 500:
                    break
                session = self.repo.create_session(
                    owner_id,
                    project.id,
                    str(session_payload.get("title") or f"会话 {sessions + 1}"),
                )
                sessions += 1
                for message in session_payload.get("messages", []):
                    if messages >= 5000:
                        break
                    role = message.get("role")
                    if role not in {"user", "assistant"}:
                        continue
                    self.repo.add_message(session, role, str(message.get("content") or ""))
                    messages += 1
        return {"projects": created, "sessions": sessions, "messages": messages}

    # ---- agent execution ----

    async def run(self, owner_id: str, session_id: str, message: str, temperature: float, permission: str) -> AsyncGenerator:
        session = self.repo.get_session(owner_id, session_id)
        project = self._require_active_project(owner_id, session.project_id)
        if permission not in PERMISSION_MODES:
            raise ValidationException("权限模式不合法")
        if permission != "read-only":
            self._require_write(owner_id, project, session.permission)
        self.repo.update_session(session, permission=permission)
        run = self.repo.create_agent_run(owner_id, project, session, permission, message)
        self.repo.add_message(session, "user", message)
        self.repo.add_agent_event(run, "run.start", {"message": message[:500]})
        self._metric("june_agent_runs_total")
        yield {"type": "run.start", "run": self._agent_summary(run)}
        async for event in self._execute(run, project, session, temperature):
            yield event

    async def resume(self, owner_id: str, agent_run_id: str, temperature: float = 0.55):
        run = self.repo.get_agent_run(owner_id, agent_run_id)
        if run.status not in {"waiting_approval", "waiting_tool"}:
            raise ValidationException("当前执行不能恢复")
        session = self.repo.get_session(owner_id, run.session_id)
        project = self._require_active_project(owner_id, run.project_id)
        self.repo.set_agent_status(run, "running")
        self.repo.add_agent_event(run, "run.resume", {})
        async for event in self._execute(run, project, session, temperature):
            yield event

    def cancel(self, owner_id: str, agent_run_id: str, actor: dict | None = None) -> dict:
        run = self.repo.get_agent_run(owner_id, agent_run_id)
        if run.status not in {"running", "waiting_approval", "waiting_tool", "failed"}:
            raise ValidationException("当前执行不能取消")
        project = self._require_project_access(owner_id, run.project_id)
        if run.status == "waiting_approval":
            for call in self.repo.list_tool_calls(run.id):
                if call.status == "waiting_approval":
                    self.tools.cleanup_pending(project, call.id)
        self.repo.set_agent_status(run, "cancelled", "用户取消执行")
        self.repo.add_agent_event(run, "run.cancelled", {})
        self._metric("june_agent_cancellations_total")
        self._audit(owner_id, actor, "harness.agent.cancel", "agent_run", run.id)
        return self.agent_trace(owner_id, agent_run_id)

    def decide_approval(self, owner_id: str, agent_run_id: str, tool_call_id: str, approved: bool, actor: dict | None = None) -> dict:
        run = self.repo.get_agent_run(owner_id, agent_run_id)
        call = self.repo.get_tool_call(owner_id, tool_call_id)
        if call.agent_run_id != run.id:
            raise NotFoundException("工具调用不属于当前执行")
        if call.status != "waiting_approval":
            raise ValidationException("该工具调用不在等待审批")
        if run.status != "waiting_approval":
            raise ValidationException("当前执行不在等待审批")
        project = self._require_active_project(owner_id, run.project_id)
        self._require_write(owner_id, project, self.repo.get_session(owner_id, run.session_id).permission)
        if approved:
            result = self.tools.apply_write(project, call)
            self.repo.finish_tool_call(call, "success", result)
            session = self.repo.get_session(owner_id, run.session_id)
            self.repo.add_message(session, "tool", json.dumps(result, ensure_ascii=False), {
                "toolCallId": call.id,
                "toolName": call.name,
            })
            self.repo.set_agent_status(run, "waiting_tool")
            self.repo.add_agent_event(run, "tool.approved", self._tool_payload(call))
            self._metric("june_agent_approvals_total")
            self._audit(owner_id, actor, "harness.file.write_approved", "tool_call", call.id, {
                "path": result.get("path"),
                "bytes": result.get("bytes"),
                "backupPath": result.get("backupPath"),
            })
        else:
            self.tools.cleanup_pending(project, call.id)
            self.repo.finish_tool_call(call, "rejected", {"approved": False})
            self.repo.set_agent_status(run, "rejected", "用户拒绝写入")
            self.repo.add_agent_event(run, "tool.rejected", self._tool_payload(call))
            self._metric("june_agent_approvals_total")
            self._audit(owner_id, actor, "harness.file.write_rejected", "tool_call", call.id)
        return self.agent_trace(owner_id, agent_run_id)

    def agent_trace(self, owner_id: str, agent_run_id: str) -> dict:
        run = self.repo.get_agent_run(owner_id, agent_run_id)
        events = self.repo.list_agent_events(run.id)
        calls = self.repo.list_tool_calls(run.id)
        return self._agent_detail(run, events, calls)

    def recover_interrupted(self) -> int:
        return self.repo.mark_interrupted_runs()

    async def _execute(self, run: AgentRunModel, project: HarnessProjectModel, session: SessionModel, temperature: float):
        try:
            for _ in range(max(0, 6 - run.iterations)):
                self.repo.normalize_agent_iterations(run)
                context = self._build_context(project, session)
                self.repo.save_agent_context(run, self._context_trace(context))
                yield {"type": "context", "context": self._public_context(context)}
                self.repo.add_agent_event(run, "context", self._public_context(context))

                chunks: list[str] = []
                tool_calls: list[dict] = []
                async for model_event in self._model_stream(run, context, temperature):
                    if model_event.get("type") == "message.delta":
                        delta = str(model_event.get("delta") or "")
                        chunks.append(delta)
                        yield model_event
                    elif model_event.get("type") == "tool_calls":
                        tool_calls.extend(model_event.get("tool_calls") or [])
                if tool_calls:
                    self.repo.add_message(
                        session,
                        "assistant",
                        "".join(chunks),
                        {"toolCalls": self._sanitize_tool_calls(tool_calls)},
                    )
                    self.repo.bump_agent_iterations(run)
                    for call in tool_calls:
                        function = call.get("function", {})
                        name = str(function.get("name") or "")
                        try:
                            arguments = json.loads(function.get("arguments") or "{}")
                            if not isinstance(arguments, dict):
                                raise ValueError("arguments must be an object")
                        except ValueError as exc:
                            raise ValidationException("模型工具参数不是合法 JSON") from exc
                        trace_arguments = dict(arguments)
                        if name == "write_file" and isinstance(trace_arguments.get("content"), str):
                            content = trace_arguments["content"]
                            trace_arguments["content"] = {
                                "bytes": len(content.encode("utf-8")),
                                "sha256": hashlib.sha256(content.encode("utf-8")).hexdigest(),
                            }
                        tool_record = self.repo.create_tool_call(run, name, trace_arguments, run.permission)
                        yield {"type": "tool.start", "toolCall": self._tool_payload(tool_record)}
                        self.repo.add_agent_event(run, "tool.start", self._tool_payload(tool_record))
                        self._metric("june_agent_tool_calls_total")
                        try:
                            result = await asyncio.wait_for(
                                self.tools.execute(
                                    name,
                                    arguments,
                                    project=project,
                                    session=session,
                                    permission=run.permission,
                                ),
                                timeout=10,
                            )
                            if result.get("requiresApproval"):
                                self.tools.prepare_write(project, tool_record.id, arguments)
                                self.repo.finish_tool_call(tool_record, "waiting_approval", result)
                                self.repo.set_agent_status(run, "waiting_approval")
                                approval = {
                                    "agentRunId": run.id,
                                    "toolCallId": tool_record.id,
                                    "name": name,
                                    **result,
                                }
                                event = {"type": "approval.required", "approval": approval}
                                self.repo.add_agent_event(run, "approval.required", approval)
                                yield event
                                return
                            trace_result = self._trace_tool_result(name, result)
                            self.repo.finish_tool_call(tool_record, "success", trace_result)
                            self.repo.add_message(
                                session,
                                "tool",
                                json.dumps(result, ensure_ascii=False),
                                {"toolCallId": tool_record.id, "toolName": name},
                            )
                            yield {"type": "tool.end", "toolCall": self._tool_payload(tool_record)}
                            self.repo.add_agent_event(run, "tool.end", self._tool_payload(tool_record))
                        except TimeoutError:
                            error = {"error": "工具执行超时"}
                            self.repo.finish_tool_call(tool_record, "error", error, "工具执行超时")
                            self._metric("june_agent_tool_failures_total")
                            self.repo.add_message(session, "tool", json.dumps(error), {"toolCallId": tool_record.id, "toolName": name})
                            yield {"type": "tool.end", "toolCall": self._tool_payload(tool_record)}
                        except ValidationException as exc:
                            error = {"error": exc.message}
                            self.repo.finish_tool_call(tool_record, "error", error, exc.message)
                            self._metric("june_agent_tool_failures_total")
                            self.repo.add_message(session, "tool", json.dumps(error), {"toolCallId": tool_record.id, "toolName": name})
                            yield {"type": "tool.end", "toolCall": self._tool_payload(tool_record)}
                    continue

                assistant_message = self.repo.add_message(session, "assistant", "".join(chunks))
                self.repo.set_agent_status(run, "finished")
                self.repo.add_agent_event(run, "run.end", {"status": "finished"})
                done = {
                    "type": "done",
                    "run": self._agent_detail(
                        run,
                        self.repo.list_agent_events(run.id),
                        self.repo.list_tool_calls(run.id),
                    ),
                    "message": self._message_detail(assistant_message),
                }
                yield done
                return

            error = "Agent 已达到最大 6 轮工具迭代"
            self.repo.set_agent_status(run, "failed", error)
            self.repo.add_agent_event(run, "error", {"message": error})
            yield {"type": "error", "error": error}
        except asyncio.CancelledError:
            self.repo.set_agent_status(run, "cancelled", "客户端断开，执行已取消")
            self.repo.add_agent_event(run, "run.cancelled", {})
            raise
        except Exception as exc:
            message = str(exc)
            self.repo.set_agent_status(run, "failed", message)
            self.repo.add_agent_event(run, "error", {"message": message[:1000]})
            yield {"type": "error", "error": message}

    async def _model_stream(self, run: AgentRunModel, context: dict, temperature: float):
        options = self._llm_options(run.owner_id)
        attempts = 0
        while True:
            attempts += 1
            tool_calls: list[dict] = []
            try:
                async for chunk in self.llm.chat(
                    messages=context["messages"],
                    api_key=options["api_key"],
                    model=options["model"],
                    base_url=options["base_url"],
                    temperature=temperature,
                    tools=self.tools.definitions(),
                ):
                    if isinstance(chunk, dict):
                        if chunk.get("type") == "tool_calls":
                            tool_calls.extend(chunk.get("tool_calls") or [])
                    elif chunk:
                        yield {"type": "message.delta", "delta": chunk}
                if tool_calls:
                    yield {"type": "tool_calls", "tool_calls": tool_calls}
                return
            except (TimeoutError, ConnectionError) as exc:
                if attempts >= 2:
                    raise JuneException(f"模型服务暂不可用：{exc}") from exc
                await asyncio.sleep(0.2 * attempts)

    # ---- helpers ----

    def _active_run(self, owner_id: str, run_id: str | None):
        runs = self.commerce.list_runs(owner_id)
        if run_id:
            run = next((item for item in runs if item.id == run_id), None)
            if run is None:
                raise NotFoundException("MVP 路径不存在")
        else:
            run = next((item for item in runs if item.status == "active"), None) or (runs[0] if runs else None)
        if run is None:
            raise ValidationException("请先创建商业 MVP 路径")
        if run.status == "completed":
            raise ValidationException("商业 MVP 路径已归档，不能继续写入")
        return run

    def _require_paid_model(self, owner_id: str, run_id: str):
        # 产品已免费：只要求训练师已连接（保留方法名以减少改动面）
        skill = self.commerce.find_installed_skill(owner_id)
        if skill is None or not skill.api_key_ready:
            raise ValidationException("请先连接 AI 工具并启动训练师")

    def _require_project_access(self, owner_id: str, project_id: str) -> HarnessProjectModel:
        return self.repo.get_project(owner_id, project_id)

    def _require_active_project(self, owner_id: str, project_id: str) -> HarnessProjectModel:
        project = self._require_project_access(owner_id, project_id)
        run = self.commerce.get_run(owner_id, project.mvp_run_id)
        if run.status == "completed":
            raise ValidationException("商业 MVP 路径已归档，工作区只读")
        return project

    def _require_write(self, owner_id: str, project: HarnessProjectModel, session_permission: str):
        self._require_active_project(owner_id, project.id)
        self._require_paid_model(owner_id, project.mvp_run_id)
        if session_permission not in {"workspace-write", "full-access"}:
            raise ValidationException("当前会话为只读权限，不能写入")

    def _build_context(self, project: HarnessProjectModel, session: SessionModel) -> dict:
        skill = self.commerce.find_installed_skill(project.owner_id)
        if skill is None:
            raise ValidationException("请先连接 AI 工具并启动训练师")
        context_tokens = 32768
        output_tokens = 4096
        for service in self.commerce.list_model_services(project.owner_id):
            for model in service.models:
                if model.model_id == skill.model_name:
                    context_tokens = model.context_tokens
                    output_tokens = model.max_output_tokens
                    break
        return self.contexts.build(
            project,
            session,
            skill,
            self.tools.definitions(),
            context_tokens,
            output_tokens,
        )

    def _llm_options(self, owner_id: str) -> dict[str, str]:
        skill = self.commerce.find_installed_skill(owner_id)
        if skill is None:
            raise ValidationException("请先连接 AI 工具并启动训练师")
        return {
            "api_key": decrypt_api_key(skill.encrypted_api_key) or self.llm.get_api_key(),
            "model": skill.model_name,
            "base_url": skill.base_url,
        }

    @staticmethod
    def _sanitize_tool_calls(calls: list[dict]) -> list[dict]:
        safe_calls: list[dict] = []
        for call in calls:
            function = dict(call.get("function") or {})
            name = str(function.get("name") or "")
            if name == "write_file":
                try:
                    arguments = json.loads(function.get("arguments") or "{}")
                except (TypeError, ValueError):
                    arguments = {}
                content = str(arguments.get("content") or "") if isinstance(arguments, dict) else ""
                if isinstance(arguments, dict):
                    arguments["content"] = json.dumps(
                        {
                            "bytes": len(content.encode("utf-8")),
                            "sha256": hashlib.sha256(content.encode("utf-8")).hexdigest(),
                        },
                        separators=(",", ":"),
                    )
                    function["arguments"] = json.dumps(arguments, ensure_ascii=False, separators=(",", ":"))
            safe_calls.append({**call, "function": function})
        return safe_calls

    @staticmethod
    def _trace_tool_result(name: str, result: dict) -> dict:
        safe = dict(result)
        if name == "read_file" and isinstance(safe.get("content"), str):
            content = safe.pop("content")
            safe["content"] = {
                "bytes": len(content.encode("utf-8")),
                "sha256": hashlib.sha256(content.encode("utf-8")).hexdigest(),
            }
        return safe

    def _metric(self, name: str) -> None:
        if self.metrics is not None:
            self.metrics.inc(name)

    def _audit(self, owner_id: str, actor: dict | None, action: str, target_type: str, target_id: str, detail: dict | None = None):
        user = self.commerce.get_user_by_id(owner_id)
        self.commerce.add_audit(
            owner_id,
            (actor or {}).get("account") or (user.email if user else owner_id),
            action,
            target_type,
            target_id,
            (actor or {}).get("ip", ""),
            (actor or {}).get("userAgent", ""),
            detail,
        )

    def _project_detail(self, project: HarnessProjectModel) -> dict:
        sessions = self.repo.list_sessions(project)
        return {
            "id": project.id,
            "title": project.title,
            "mvpRunId": project.mvp_run_id,
            "metadata": self._json(project.metadata_json),
            "createdAt": int(project.created_at * 1000),
            "updatedAt": int(project.updated_at * 1000),
            "sessions": [self._session_detail(item) for item in sessions],
        }

    def _session_detail(self, session: SessionModel) -> dict:
        messages = self.repo.list_messages(session.id)
        latest_run = self.repo.get_latest_agent_run(session.id)
        return {
            "id": session.id,
            "projectId": session.project_id,
            "title": session.title,
            "permission": session.permission,
            "summary": session.summary,
            "createdAt": int(session.created_at * 1000),
            "updatedAt": int(session.updated_at * 1000),
            "messages": [self._message_detail(item) for item in messages],
            "agentRun": self._agent_detail(
                latest_run,
                self.repo.list_agent_events(latest_run.id),
                self.repo.list_tool_calls(latest_run.id),
            ) if latest_run else None,
        }

    @staticmethod
    def _message_detail(message: MessageModel) -> dict:
        return {
            "id": message.id,
            "role": message.role,
            "content": message.content,
            "tokens": message.tokens,
            "meta": AgentService._json(message.meta_json),
            "timestamp": int(message.timestamp * 1000),
        }

    @staticmethod
    def _file_detail(item) -> dict:
        return {
            "id": item.id,
            "path": item.path,
            "name": item.name,
            "mimeType": item.mime_type,
            "size": item.size,
            "updatedAt": int(item.updated_at * 1000),
        }

    @staticmethod
    def _memory_detail(item) -> dict:
        return {
            "id": item.id,
            "memoryType": item.memory_type,
            "content": item.content,
            "createdAt": int(item.created_at * 1000),
        }

    @staticmethod
    def _document_detail(item) -> dict:
        return {
            "id": item.id,
            "title": item.title,
            "content": item.content,
            "createdAt": int(item.created_at * 1000),
            "updatedAt": int(item.updated_at * 1000),
        }

    def _agent_detail(self, run: AgentRunModel, events: list[AgentEventModel], calls: list[ToolCallModel]) -> dict:
        return {
            **self._agent_summary(run),
            "input": run.input,
            "error": run.error,
            "context": self._json(run.context_json),
            "events": [
                {
                    "id": event.id,
                    "type": event.event_type,
                    "payload": self._json(event.payload_json),
                    "createdAt": int(event.created_at * 1000),
                }
                for event in events
            ],
            "toolCalls": [self._tool_payload(call) for call in calls],
        }

    @staticmethod
    def _agent_summary(run: AgentRunModel) -> dict:
        return {
            "id": run.id,
            "projectId": run.project_id,
            "sessionId": run.session_id,
            "status": run.status,
            "permission": run.permission,
            "iterations": run.iterations,
            "startedAt": int(run.started_at * 1000),
            "finishedAt": int(run.finished_at * 1000) if run.finished_at else None,
        }

    @staticmethod
    def _tool_payload(call: ToolCallModel) -> dict:
        arguments = AgentService._json(call.arguments_json)
        result = AgentService._json(call.result_json)
        if call.name == "write_file" and isinstance(arguments.get("content"), str):
            arguments["content"] = arguments["content"][:300]
        if isinstance(result.get("content"), str):
            result["content"] = result["content"][:300]
        return {
            "id": call.id,
            "agentRunId": call.agent_run_id,
            "name": call.name,
            "arguments": arguments,
            "result": result,
            "status": call.status,
            "error": call.error,
            "startedAt": int(call.started_at * 1000),
            "endedAt": int(call.ended_at * 1000) if call.ended_at else None,
        }

    @staticmethod
    def _public_context(context: dict) -> dict:
        return {
            "model": context.get("model"),
            "maxContextTokens": context.get("maxContextTokens"),
            "maxOutputTokens": context.get("maxOutputTokens"),
            "totalTokens": context.get("totalTokens"),
            "budgetTokens": context.get("budgetTokens"),
            "components": context.get("components", []),
            "historyMessageCount": context.get("historyMessageCount"),
            "totalMessageCount": context.get("totalMessageCount"),
        }

    @staticmethod
    def _context_trace(context: dict) -> dict:
        return AgentService._public_context(context)

    @staticmethod
    def _json(value: str) -> dict:
        try:
            parsed = json.loads(value or "{}")
            return parsed if isinstance(parsed, dict) else {}
        except json.JSONDecodeError:
            return {}
