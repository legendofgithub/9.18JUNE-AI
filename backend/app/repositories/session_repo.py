"""
会话仓库 —— 封装 sessions、messages、files 表的所有数据库操作。
命名约定（参照 AgentX）：
- get_xxx()   -> 必须返回结果，否则抛 NotFoundException
- find_xxx()  -> 可返回 None
- exists_xxx() -> 返回 bool
"""
import time
import json
from typing import Optional
from sqlalchemy.orm import Session
from sqlalchemy import desc
from ..models.database import SessionModel, MessageModel, FileModel, ThreadModel, ThreadStateModel
from ..core.exceptions import NotFoundException


class SessionRepository:
    """会话持久化操作"""

    def __init__(self, db: Session):
        self.db = db

    # ---- 创建 ----

    def create(self, title: str = "新对话", model: str = "deepseek-chat") -> SessionModel:
        """创建新会话"""
        session = SessionModel(title=title, model=model)
        self.db.add(session)
        self.db.commit()
        self.db.refresh(session)
        return session

    # ---- 查询 ----

    def get(self, session_id: str) -> SessionModel:
        """获取会话，不存在则抛 NotFoundException"""
        session = self.db.query(SessionModel).filter(SessionModel.id == session_id).first()
        if session is None:
            raise NotFoundException(f"会话 {session_id} 不存在")
        return session

    def find(self, session_id: str) -> Optional[SessionModel]:
        """查找会话，不存在返回 None"""
        return self.db.query(SessionModel).filter(SessionModel.id == session_id).first()

    def list_all(self, limit: int = 50) -> list[SessionModel]:
        """获取所有会话列表（按更新时间降序）"""
        return (
            self.db.query(SessionModel)
            .order_by(desc(SessionModel.updated_at))
            .limit(limit)
            .all()
        )

    def exists(self, session_id: str) -> bool:
        """检查会话是否存在"""
        return self.db.query(SessionModel).filter(SessionModel.id == session_id).first() is not None

    # ---- 更新 ----

    def update_title(self, session_id: str, title: str) -> SessionModel:
        """更新会话标题"""
        session = self.get(session_id)
        session.title = title
        session.updated_at = time.time()
        self.db.commit()
        return session

    def touch(self, session_id: str) -> None:
        """更新会话最后活跃时间"""
        session = self.find(session_id)
        if session:
            session.updated_at = time.time()
            self.db.commit()

    # ---- 删除 ----

    def delete(self, session_id: str) -> bool:
        """删除会话（级联删除关联的 messages、threads、files）"""
        session = self.find(session_id)
        if session is None:
            return False
        self.db.delete(session)
        self.db.commit()
        return True

    # ---- 消息操作 ----

    def _ensure_session_row(self, session_id: str) -> None:
        if self.find(session_id) is None:
            self.db.add(SessionModel(id=session_id, title="新对话"))
            self.db.commit()

    def add_message(self, session_id: str, role: str, content: str, thread_id: str = "main") -> MessageModel:
        """添加消息到会话"""
        self._ensure_session_row(session_id)

        msg = MessageModel(
            session_id=session_id,
            role=role,
            content=content,
            thread_id=thread_id,
        )
        self.db.add(msg)
        self.touch(session_id)
        self.db.commit()
        return msg

    def add_message_once(
        self,
        message_id: str,
        session_id: str,
        role: str,
        content: str,
        thread_id: str = "main",
    ) -> MessageModel:
        """按消息 ID 幂等写入，SSE 重试不会产生重复消息"""
        existing = self.db.query(MessageModel).filter(MessageModel.id == message_id).first()
        if existing is not None:
            return existing
        msg = MessageModel(
            id=message_id,
            session_id=session_id,
            role=role,
            content=content,
            thread_id=thread_id,
        )
        self.db.add(msg)
        self.touch(session_id)
        self.db.commit()
        return msg

    def get_messages(self, session_id: str, thread_id: Optional[str] = None, limit: int = 200) -> list[dict]:
        """获取会话消息列表（返回字典格式，兼容前端）"""
        query = self.db.query(MessageModel).filter(MessageModel.session_id == session_id)
        if thread_id:
            query = query.filter(MessageModel.thread_id == thread_id)
        msgs = query.order_by(MessageModel.timestamp).limit(limit).all()
        return [
            {
                "id": m.id,
                "role": m.role,
                "content": m.content,
                "timestamp": int(m.timestamp * 1000),
                "threadId": m.thread_id,
            }
            for m in msgs
        ]

    def get_all_messages(self, session_id: str, thread_id: Optional[str] = None) -> list[dict]:
        """获取不受默认 limit 限制的消息，用于 harness 恢复"""
        query = self.db.query(MessageModel).filter(MessageModel.session_id == session_id)
        if thread_id:
            query = query.filter(MessageModel.thread_id == thread_id)
        msgs = query.order_by(MessageModel.timestamp, MessageModel.id).all()
        return [
            {
                "id": m.id,
                "role": m.role,
                "content": m.content,
                "timestamp": int(m.timestamp * 1000),
                "threadId": m.thread_id,
            }
            for m in msgs
        ]

    def get_recent_messages(self, session_id: str, thread_id: Optional[str] = None, limit: int = 50) -> list[dict]:
        """取最近 limit 条消息（仍按时间正序返回），用于长追问链的膨胀保护"""
        query = self.db.query(MessageModel).filter(MessageModel.session_id == session_id)
        if thread_id:
            query = query.filter(MessageModel.thread_id == thread_id)
        msgs = query.order_by(desc(MessageModel.timestamp), desc(MessageModel.id)).limit(limit).all()
        return [
            {
                "id": m.id,
                "role": m.role,
                "content": m.content,
                "timestamp": int(m.timestamp * 1000),
                "threadId": m.thread_id,
            }
            for m in reversed(msgs)
        ]

    # ---- 追问线程操作 ----

    def get_thread_ancestry(self, thread_id: str, max_depth: int = 64) -> list[ThreadModel]:
        """
        沿 parent_thread_id 上溯，返回「最远祖先 → 当前线程」的链路（含自身）。

        parent 指向 main 时入库值为 session_id，在 threads 表中查不到，链路自然终止。
        max_depth 与 seen 集合用于防御脏数据造成的自引用死循环。
        """
        chain: list[ThreadModel] = []
        seen: set[str] = set()
        cursor = thread_id
        while cursor and cursor not in seen and len(chain) < max_depth:
            seen.add(cursor)
            thread = self.find_thread(cursor)
            if thread is None:
                break
            chain.append(thread)
            cursor = thread.parent_thread_id or ""
        chain.reverse()
        return chain

    def upsert_thread(self, session_id: str, thread_id: str, parent_thread_id: str, level: int) -> ThreadModel:
        """创建或刷新追问树节点"""
        self._ensure_session_row(session_id)
        thread = self.db.query(ThreadModel).filter(ThreadModel.id == thread_id).first()
        if thread is None:
            thread = ThreadModel(
                id=thread_id,
                session_id=session_id,
                parent_thread_id=parent_thread_id,
                level=level,
            )
            self.db.add(thread)
        else:
            thread.session_id = session_id
            thread.parent_thread_id = parent_thread_id
            thread.level = level
            thread.is_active = True
            thread.last_activity = time.time()
        self.touch(session_id)
        self.db.commit()
        self.db.refresh(thread)
        return thread

    def find_thread(self, thread_id: str) -> Optional[ThreadModel]:
        return self.db.query(ThreadModel).filter(ThreadModel.id == thread_id).first()

    def upsert_thread_state(
        self,
        session_id: str,
        thread_id: str,
        *,
        source_type: str = "text",
        selected_text: str = "",
        source_message_id: str = "",
        source_message_role: str = "assistant",
        position: Optional[tuple[float, float]] = None,
        size: Optional[tuple[int, int]] = None,
        is_minimized: bool = False,
        z_index: int = 1000,
        settings: Optional[dict] = None,
    ) -> ThreadStateModel:
        state = self.db.query(ThreadStateModel).filter(ThreadStateModel.id == thread_id).first()
        if state is None:
            state = ThreadStateModel(
                id=thread_id,
                session_id=session_id,
                source_type=source_type,
                selected_text=selected_text,
                source_message_id=source_message_id,
                source_message_role=source_message_role,
                position_x=position[0] if position else 80,
                position_y=position[1] if position else 120,
                width=size[0] if size else 420,
                height=size[1] if size else 360,
                is_minimized=is_minimized,
                z_index=z_index,
                settings_json=json.dumps(settings or {}, ensure_ascii=False),
            )
            self.db.add(state)
        else:
            state.session_id = session_id
            state.source_type = source_type
            state.selected_text = selected_text
            state.source_message_id = source_message_id
            state.source_message_role = source_message_role
            if position:
                state.position_x, state.position_y = position
            if size:
                state.width, state.height = size
            state.is_minimized = is_minimized
            state.z_index = z_index
            state.settings_json = json.dumps(settings or {}, ensure_ascii=False)
        self.touch(session_id)
        self.db.commit()
        self.db.refresh(state)
        return state

    def find_thread_state(self, thread_id: str) -> Optional[ThreadStateModel]:
        return self.db.query(ThreadStateModel).filter(ThreadStateModel.id == thread_id).first()

    def update_thread_ui(
        self,
        thread_id: str,
        *,
        position: Optional[tuple[float, float]] = None,
        size: Optional[tuple[int, int]] = None,
        is_minimized: Optional[bool] = None,
        z_index: Optional[int] = None,
        settings: Optional[dict] = None,
        is_closed: Optional[bool] = None,
    ) -> Optional[ThreadStateModel]:
        state = self.find_thread_state(thread_id)
        if state is None:
            return None
        if position is not None:
            state.position_x, state.position_y = position
        if size is not None:
            state.width, state.height = size
        if is_minimized is not None:
            state.is_minimized = is_minimized
        if z_index is not None:
            state.z_index = z_index
        if settings is not None:
            state.settings_json = json.dumps(settings, ensure_ascii=False)
        if is_closed is not None:
            state.is_closed = is_closed
        state.updated_at = time.time()
        self.db.commit()
        self.db.refresh(state)
        return state

    def update_thread_summary(self, thread_id: str, summary: str) -> Optional[ThreadStateModel]:
        state = self.find_thread_state(thread_id)
        if state is None:
            return None
        state.summary = summary
        state.updated_at = time.time()
        self.db.commit()
        self.db.refresh(state)
        return state

    def _thread_state_to_dict(self, state: ThreadStateModel, thread: Optional[ThreadModel]) -> dict:
        try:
            settings = json.loads(state.settings_json or "{}")
        except json.JSONDecodeError:
            settings = {}
        return {
            "threadId": state.id,
            "parentThreadId": thread.parent_thread_id if thread else "main",
            "level": thread.level if thread else 1,
            "type": state.source_type,
            "source": {
                "selectedText": state.selected_text,
                "sourceMessageId": state.source_message_id,
                "sourceMessageRole": state.source_message_role,
            },
            "position": {"x": state.position_x, "y": state.position_y},
            "size": {"width": state.width, "height": state.height},
            "isMinimized": state.is_minimized,
            "zIndex": state.z_index,
            "settings": settings,
            "summary": state.summary,
            "isClosed": state.is_closed,
            "updatedAt": int(state.updated_at * 1000),
        }

    def list_thread_states(self, session_id: str) -> list[dict]:
        rows = (
            self.db.query(ThreadStateModel, ThreadModel)
            .outerjoin(ThreadModel, ThreadModel.id == ThreadStateModel.id)
            .filter(ThreadStateModel.session_id == session_id)
            .all()
        )
        return [self._thread_state_to_dict(state, thread) for state, thread in rows]

    # ---- 文件操作 ----

    def add_file(self, session_id: str, name: str, file_type: str, size: int, stored_path: str) -> FileModel:
        """记录文件元数据"""
        f = FileModel(
            session_id=session_id,
            name=name,
            type=file_type,
            size=size,
            stored_path=stored_path,
        )
        self.db.add(f)
        self.touch(session_id)
        self.db.commit()
        self.db.refresh(f)
        return f

    def get_files(self, session_id: str) -> list[FileModel]:
        """获取会话下所有文件"""
        return self.db.query(FileModel).filter(FileModel.session_id == session_id).all()

    def find_file(self, file_id: str) -> Optional[FileModel]:
        """查找文件，不存在返回 None"""
        return self.db.query(FileModel).filter(FileModel.id == file_id).first()

    def delete_file(self, file_id: str) -> Optional[FileModel]:
        """删除文件记录，返回被删的模型（含 stored_path），不存在返回 None"""
        f = self.find_file(file_id)
        if f is None:
            return None
        self.db.delete(f)
        self.db.commit()
        return f
