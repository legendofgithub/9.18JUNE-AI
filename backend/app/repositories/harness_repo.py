import json
import time
import uuid
from pathlib import Path

from sqlalchemy.orm import Session

from ..core.exceptions import NotFoundException, ValidationException
from ..models.database import (
    AgentEventModel,
    AgentRunModel,
    HarnessDocumentModel,
    HarnessFileModel,
    HarnessMemoryModel,
    HarnessProjectModel,
    MessageModel,
    SessionModel,
    ToolCallModel,
)


def estimate_tokens(value: str) -> int:
    """Cheap deterministic budget estimate; exactness is not required for capping."""
    if not value:
        return 0
    ascii_chars = sum(1 for char in value if ord(char) < 128)
    other_chars = len(value) - ascii_chars
    return max(1, (ascii_chars * 28 + other_chars * 90) // 100)


class HarnessRepository:
    def __init__(self, db: Session):
        self.db = db

    # ---- projects and sessions ----

    def list_projects(self, owner_id: str) -> list[HarnessProjectModel]:
        return (
            self.db.query(HarnessProjectModel)
            .filter(HarnessProjectModel.owner_id == owner_id)
            .order_by(HarnessProjectModel.updated_at.desc())
            .all()
        )

    def get_project(self, owner_id: str, project_id: str) -> HarnessProjectModel:
        project = self.db.get(HarnessProjectModel, project_id)
        if project is None or project.owner_id != owner_id:
            raise NotFoundException("Harness 项目不存在")
        return project

    def create_project(self, owner_id: str, mvp_run_id: str, title: str, metadata: dict | None = None) -> HarnessProjectModel:
        project = HarnessProjectModel(
            owner_id=owner_id,
            mvp_run_id=mvp_run_id,
            title=title.strip() or "未命名项目",
            metadata_json=json.dumps(metadata or {}, ensure_ascii=False),
        )
        self.db.add(project)
        self.db.flush()
        self.create_session(owner_id, project.id, "会话 1")
        self.db.commit()
        self.db.refresh(project)
        return project

    def update_project(self, project: HarnessProjectModel, title: str, metadata: dict | None) -> HarnessProjectModel:
        project.title = title.strip() or project.title
        if metadata is not None:
            project.metadata_json = json.dumps(metadata, ensure_ascii=False)
        project.updated_at = time.time()
        self.db.commit()
        self.db.refresh(project)
        return project

    def delete_project(self, project: HarnessProjectModel) -> None:
        self.db.delete(project)
        self.db.commit()

    def list_sessions(self, project: HarnessProjectModel) -> list[SessionModel]:
        return (
            self.db.query(SessionModel)
            .filter(SessionModel.project_id == project.id)
            .order_by(SessionModel.created_at)
            .all()
        )

    def get_session(self, owner_id: str, session_id: str) -> SessionModel:
        session = self.db.get(SessionModel, session_id)
        if session is None or session.owner_id != owner_id:
            raise NotFoundException("Harness 会话不存在")
        return session

    def create_session(self, owner_id: str, project_id: str, title: str) -> SessionModel:
        session = SessionModel(
            owner_id=owner_id,
            project_id=project_id,
            title=title.strip() or "新会话",
            permission="read-only",
        )
        self.db.add(session)
        self.db.commit()
        self.db.refresh(session)
        return session

    def update_session(self, session: SessionModel, title: str | None = None, permission: str | None = None) -> SessionModel:
        if title is not None:
            session.title = title.strip() or session.title
        if permission is not None:
            session.permission = permission
        session.updated_at = time.time()
        self.db.commit()
        self.db.refresh(session)
        return session

    def delete_session(self, session: SessionModel) -> None:
        if self.list_sessions(self.get_project(session.owner_id, session.project_id)).count(lambda item: item.id == session.id) == 0:
            raise ValidationException("会话不存在")
        self.db.delete(session)
        self.db.commit()

    def add_message(
        self,
        session: SessionModel,
        role: str,
        content: str,
        meta: dict | None = None,
    ) -> MessageModel:
        message = MessageModel(
            session_id=session.id,
            owner_id=session.owner_id,
            project_id=session.project_id,
            role=role,
            content=content,
            thread_id="main",
            tokens=estimate_tokens(content),
            meta_json=json.dumps(meta or {}, ensure_ascii=False, separators=(",", ":")),
        )
        self.db.add(message)
        session.updated_at = time.time()
        self.db.commit()
        self.db.refresh(message)
        return message

    def list_messages(self, session_id: str) -> list[MessageModel]:
        return (
            self.db.query(MessageModel)
            .filter(MessageModel.session_id == session_id, MessageModel.thread_id == "main")
            .order_by(MessageModel.timestamp, MessageModel.id)
            .all()
        )

    def set_session_summary(self, session: SessionModel, summary: str) -> None:
        session.summary = summary
        session.updated_at = time.time()
        self.db.commit()

    # ---- files, memories, documents ----

    def list_files(self, project_id: str) -> list[HarnessFileModel]:
        return (
            self.db.query(HarnessFileModel)
            .filter(HarnessFileModel.project_id == project_id)
            .order_by(HarnessFileModel.path)
            .all()
        )

    def upsert_file(self, project: HarnessProjectModel, path: str, name: str, mime_type: str, content: str) -> HarnessFileModel:
        normalized = normalize_relative_path(path, allow_directory=False)
        item = (
            self.db.query(HarnessFileModel)
            .filter(HarnessFileModel.project_id == project.id, HarnessFileModel.path == normalized)
            .first()
        )
        if item is None:
            item = HarnessFileModel(project_id=project.id, owner_id=project.owner_id, path=normalized)
            self.db.add(item)
        item.name = name or Path(normalized).name
        item.mime_type = mime_type
        item.size = len(content.encode("utf-8"))
        item.content = content
        item.updated_at = time.time()
        project.updated_at = time.time()
        self.db.commit()
        self.db.refresh(item)
        return item

    def get_file_by_path(self, project_id: str, path: str) -> HarnessFileModel | None:
        normalized = normalize_relative_path(path, allow_directory=False)
        return (
            self.db.query(HarnessFileModel)
            .filter(HarnessFileModel.project_id == project_id, HarnessFileModel.path == normalized)
            .first()
        )

    def list_memories(self, project_id: str) -> list[HarnessMemoryModel]:
        return (
            self.db.query(HarnessMemoryModel)
            .filter(HarnessMemoryModel.project_id == project_id)
            .order_by(HarnessMemoryModel.updated_at.desc())
            .limit(100)
            .all()
        )

    def add_memory(self, project: HarnessProjectModel, memory_type: str, content: str) -> HarnessMemoryModel:
        memory = HarnessMemoryModel(
            project_id=project.id,
            owner_id=project.owner_id,
            memory_type=memory_type,
            content=content,
        )
        self.db.add(memory)
        self.db.commit()
        self.db.refresh(memory)
        return memory

    def get_memory(self, owner_id: str, memory_id: str) -> HarnessMemoryModel:
        memory = self.db.get(HarnessMemoryModel, memory_id)
        if memory is None or memory.owner_id != owner_id:
            raise NotFoundException("项目记忆不存在")
        return memory

    def delete_memory(self, memory: HarnessMemoryModel) -> None:
        self.db.delete(memory)
        self.db.commit()

    def list_documents(self, project_id: str) -> list[HarnessDocumentModel]:
        return (
            self.db.query(HarnessDocumentModel)
            .filter(HarnessDocumentModel.project_id == project_id)
            .order_by(HarnessDocumentModel.updated_at.desc())
            .all()
        )

    def add_document(self, project: HarnessProjectModel, title: str, content: str) -> HarnessDocumentModel:
        document = HarnessDocumentModel(
            project_id=project.id,
            owner_id=project.owner_id,
            title=title.strip() or "未命名文档",
            content=content,
        )
        self.db.add(document)
        self.db.commit()
        self.db.refresh(document)
        return document

    def get_document(self, owner_id: str, document_id: str) -> HarnessDocumentModel:
        document = self.db.get(HarnessDocumentModel, document_id)
        if document is None or document.owner_id != owner_id:
            raise NotFoundException("项目文档不存在")
        return document

    def delete_document(self, document: HarnessDocumentModel) -> None:
        self.db.delete(document)
        self.db.commit()

    # ---- agent trace and tools ----

    def create_agent_run(
        self,
        owner_id: str,
        project: HarnessProjectModel,
        session: SessionModel,
        permission: str,
        message: str,
    ) -> AgentRunModel:
        run = AgentRunModel(
            owner_id=owner_id,
            project_id=project.id,
            session_id=session.id,
            mvp_run_id=project.mvp_run_id,
            permission=permission,
            input=message,
            status="running",
        )
        self.db.add(run)
        self.db.commit()
        self.db.refresh(run)
        return run

    def get_agent_run(self, owner_id: str, agent_run_id: str) -> AgentRunModel:
        run = self.db.get(AgentRunModel, agent_run_id)
        if run is None or run.owner_id != owner_id:
            raise NotFoundException("Agent 执行不存在")
        return run

    def get_latest_agent_run(self, session_id: str) -> AgentRunModel | None:
        return (
            self.db.query(AgentRunModel)
            .filter(AgentRunModel.session_id == session_id)
            .order_by(AgentRunModel.started_at.desc(), AgentRunModel.id.desc())
            .first()
        )

    def set_agent_status(self, run: AgentRunModel, status: str, error: str = "") -> None:
        run.status = status
        run.error = error
        run.updated_at = time.time()
        if status in {"finished", "failed", "cancelled", "rejected"}:
            run.finished_at = time.time()
        self.db.commit()

    def save_agent_context(self, run: AgentRunModel, context: dict) -> None:
        run.context_json = json.dumps(context, ensure_ascii=False, separators=(",", ":"))
        self.db.commit()

    def add_agent_event(self, run: AgentRunModel, event_type: str, payload: dict | None = None) -> AgentEventModel:
        event = AgentEventModel(
            agent_run_id=run.id,
            event_type=event_type,
            payload_json=json.dumps(payload or {}, ensure_ascii=False, separators=(",", ":")),
        )
        self.db.add(event)
        self.db.commit()
        self.db.refresh(event)
        return event

    def list_agent_events(self, agent_run_id: str) -> list[AgentEventModel]:
        return (
            self.db.query(AgentEventModel)
            .filter(AgentEventModel.agent_run_id == agent_run_id)
            .order_by(AgentEventModel.created_at, AgentEventModel.id)
            .all()
        )

    def create_tool_call(self, run: AgentRunModel, name: str, arguments: dict, permission: str) -> ToolCallModel:
        call = ToolCallModel(
            owner_id=run.owner_id,
            agent_run_id=run.id,
            name=name,
            arguments_json=json.dumps(arguments, ensure_ascii=False, separators=(",", ":")),
            permission=permission,
            status="pending",
        )
        self.db.add(call)
        self.db.commit()
        self.db.refresh(call)
        return call

    def get_tool_call(self, owner_id: str, tool_call_id: str) -> ToolCallModel:
        call = self.db.get(ToolCallModel, tool_call_id)
        if call is None or call.owner_id != owner_id:
            raise NotFoundException("工具调用不存在")
        return call

    def finish_tool_call(self, call: ToolCallModel, status: str, result: dict, error: str = "") -> None:
        call.status = status
        call.result_json = json.dumps(result, ensure_ascii=False, separators=(",", ":"))
        call.error = error
        call.ended_at = time.time()
        self.db.commit()

    def list_tool_calls(self, agent_run_id: str) -> list[ToolCallModel]:
        return (
            self.db.query(ToolCallModel)
            .filter(ToolCallModel.agent_run_id == agent_run_id)
            .order_by(ToolCallModel.started_at, ToolCallModel.id)
            .all()
        )

    def mark_interrupted_runs(self, owner_id: str | None = None) -> int:
        query = self.db.query(AgentRunModel).filter(AgentRunModel.status.in_(["running", "waiting_tool"]))
        if owner_id:
            query = query.filter(AgentRunModel.owner_id == owner_id)
        runs = query.all()
        for run in runs:
            self.set_agent_status(run, "failed", "服务重启导致执行中断")
            self.add_agent_event(run, "error", {"message": "服务重启导致执行中断"})
        return len(runs)


def normalize_relative_path(path: str, allow_directory: bool = False) -> str:
    if not path or "\x00" in path or "\\" in path:
        raise ValidationException("文件路径格式不合法")
    if path.startswith("/") or path[1:2] == ":":
        raise ValidationException("文件路径必须是项目内相对路径")
    candidate = path
    parts = []
    for part in candidate.split("/"):
        if part in {"", "."}:
            continue
        if part == "..":
            raise ValidationException("不能访问项目沙箱外的路径")
        parts.append(part)
    if not parts:
        if allow_directory:
            return ""
        raise ValidationException("文件路径不能为空")
    if len(parts) > 12:
        raise ValidationException("文件路径层级过深")
    return "/".join(parts)


def new_id() -> str:
    return str(uuid.uuid4())
