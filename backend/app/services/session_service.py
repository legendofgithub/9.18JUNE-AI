"""
会话服务 —— 会话生命周期管理、对话编排、追问链构建

纯业务逻辑，不接触 HTTP 请求/响应对象。
"""
from ..core.config import settings
from ..models.schemas import FollowUpRequest


class SessionService:

    def __init__(self, session_repo, deepseek_service, thread_manager):
        self.repo = session_repo
        self.deepseek = deepseek_service
        self.thread_mgr = thread_manager

    def create_session(self, title: str = "新对话") -> dict:
        session = self.repo.create(title=title)
        return self._session_to_dict(session)

    def get_session(self, session_id: str) -> dict:
        session = self.repo.get(session_id)
        messages = self.repo.get_messages(session_id)
        return {
            "id": session.id,
            "title": session.title,
            "created_at": int(session.created_at * 1000),
            "messages": messages,
        }

    def list_sessions(self, limit: int = 50) -> list[dict]:
        sessions = self.repo.list_all(limit)
        return [self._session_to_dict(s) for s in sessions]

    def delete_session(self, session_id: str) -> bool:
        return self.repo.delete(session_id)

    def _session_to_dict(self, session) -> dict:
        return {
            "id": session.id,
            "title": session.title,
            "createdAt": int(session.created_at * 1000),
            "model": session.model,
        }

    def ensure_session(self, session_id: str) -> dict:
        session = self.repo.find(session_id)
        if session is None:
            session = self.repo.create()
        return {
            "id": session.id,
            "title": session.title,
            "created_at": int(session.created_at * 1000),
            "messages": self.repo.get_messages(session.id),
        }

    def save_user_message(self, session_id: str, content: str) -> dict:
        msg = self.repo.add_message(session_id, "user", content, thread_id="main")
        return {
            "id": msg.id,
            "role": "user",
            "content": content,
            "timestamp": int(msg.timestamp * 1000),
            "threadId": "main",
        }

    async def stream_main_chat(self, session_id: str, session_messages: list[dict]):
        full_content = ""
        main_thread_id = f"main_{session_id}"
        try:
            from ..thread_manager import ThreadInfo
            self.thread_mgr.register(ThreadInfo(
                thread_id=main_thread_id,
                parent_thread_id="root",
                session_id=session_id,
            ))
            self.thread_mgr.touch(main_thread_id)
            async for delta in self.deepseek.chat(
                messages=session_messages,
                api_key=self.deepseek.get_api_key(),
            ):
                full_content += delta
                yield {"delta": delta, "type": "text"}
        finally:
            if full_content:
                self.repo.add_message(session_id, "assistant", full_content, thread_id="main")
            yield {"done": True, "thread_id": main_thread_id, "usage": {}}
            self.thread_mgr.close(main_thread_id, cascade=False)

    async def stream_follow_up(self, session_id: str, body: FollowUpRequest):
        from ..thread_manager import ThreadInfo
        self.thread_mgr.register(ThreadInfo(
            thread_id=body.thread_id,
            parent_thread_id=body.parent_thread_id,
            session_id=session_id,
        ))
        self.thread_mgr.touch(body.parent_thread_id)
        full_content = ""
        messages = self._build_follow_up_messages(body)
        temperature = body.temperature if body.temperature is not None else 0.7
        try:
            self.thread_mgr.touch(body.thread_id)
            async for delta in self.deepseek.chat(
                messages=messages,
                api_key=self.deepseek.get_api_key(),
                temperature=temperature,
            ):
                full_content += delta
                yield {"delta": delta, "type": "text"}
        finally:
            yield {"done": True, "thread_id": body.thread_id, "usage": {}}
            self.thread_mgr.close(body.thread_id, cascade=False)

    def _build_follow_up_messages(self, body: FollowUpRequest) -> list[dict]:
        selected_text = body.source.selected_text or ""

        parts = [
            "## 学习上下文",
            "你正在帮助一位学习者理解以下内容。",
            "",
            "### 当前追问链",
            f"- 这是第 L{body.level} 层追问",
            "",
        ]
        if body.context.parent_thread_messages:
            parent_msgs = body.context.parent_thread_messages[-10:]
            parent_lines = []
            for m in parent_msgs:
                role = "学习者" if m.get("role") == "user" else "AI助手"
                parent_lines.append(f"[{role}]: {m.get('content', '')}")
            if parent_lines:
                parts.append("### 父层对话历史")
                parts.extend(parent_lines)
                parts.append("")
        if body.context.main_thread_messages:
            main_msgs = body.context.main_thread_messages[-6:]
            main_lines = []
            for m in main_msgs:
                role = "学习者" if m.get("role") == "user" else "AI助手"
                main_lines.append(f"[{role}]: {m.get('content', '')}")
            if main_lines:
                parts.append("### 主对话历史")
                parts.extend(main_lines)
                parts.append("")
        if selected_text:
            parts.append(f'选中内容: "{selected_text}"')
            parts.append("")
        parts.extend([
            "### 追问",
            body.query,
        ])
        if body.verbosity == "concise":
            parts.append("请用最简洁的方式回答，直接给出核心解释，控制在150字以内。")
        else:
            parts.append("请详细解释，先解释含义再补充背景，涉及专业术语提供通俗类比。")
        context_prompt = "\n".join(parts)

        return [
            {
                "role": "system",
                "content": "你是 June AI，一位 AI 伴学助手。请用通俗易懂的语言解释概念，引用上下文帮助学习者理解。",
            },
            {"role": "user", "content": context_prompt},
        ]
