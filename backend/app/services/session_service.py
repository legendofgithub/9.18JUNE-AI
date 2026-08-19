"""会话生命周期、主对话编排与无限追问 harness 上下文组装。"""

import re
import uuid
from datetime import datetime

from ..core.config import settings
from ..models.schemas import FollowUpRequest, SourceInfo, ThreadPatchRequest, ThreadRegisterRequest


class SessionService:
    SYSTEM_PROMPT = (
        "你是 June AI，一位耐心、温暖、充满好奇心的 AI 伴学伙伴。\n\n"
        "## 角色\n你不是冷冰冰的问答机器，而是坐在学习者身边、一起探索知识的朋友。\n\n"
        "## 教学策略\n- 苏格拉底式引导：适当反问，引导学习者思考，而不是直接给答案\n"
        "- 生活类比优先：用学生熟悉的事物做类比\n"
        "- 分步骤讲解：复杂概念拆成小步骤，让每一步都有'原来如此'的感觉\n"
        "- 鼓励提问：追问是被欢迎的，没有'笨问题'\n\n"
        "## 语言与格式\n- 用中文回答，语气亲切自然，K12 友好但不幼稚\n"
        "- Markdown 结构化，重点加粗，步骤用列表；数学公式用 LaTeX\n"
        "- 适度使用 emoji（1-2 个）\n\n"
        "## 思考展示\n回答前先用 <think></think> 写 1-3 句学生友好的思路展示："
 "你如何分析问题、打算用什么类比、学生可能卡在哪里。不要写复杂推理链。"
    )

    FOLLOW_UP_SYSTEM_PROMPT = (
        "你是 June AI 的无限追问 harness。学习者可以在同一段内容上持续追问，每一层追问都必须继承上一层的学习状态。\n"
        "规则：\n"
        "1. 紧扣学习者的原始困惑、选中文本和当前追问链，不要从零重新解释。\n"
        "2. 先判断学习者是在深入、绕圈还是卡住：深入就推进一层；绕圈就收敛；卡住就降低门槛并换一个类比。\n"
        "3. 保持术语、类比和符号的连续性；需要升级概念时先说明为什么要升级。\n"
        "4. 回答保持 K12 友好但不幼稚，用 Markdown 结构化，数学公式用 LaTeX。\n"
        "5. 回答前用 <think></think> 写 1-3 句学生友好的思考展示；回答末尾用一句'可以继续追问：...'给出下一个最有价值的问题。"
    )

    CONTEXT_BUDGET = 20000
    CURRENT_MESSAGES_LIMIT = 10
    PARENT_MESSAGES_LIMIT = 6
    MAIN_MESSAGES_LIMIT = 6
    MAX_ANCESTORS = 12

    def __init__(self, session_repo, deepseek_service, thread_manager):
        self.repo = session_repo
        self.deepseek = deepseek_service
        self.thread_mgr = thread_manager

    def create_session(self, title: str = "新对话", model: str = "") -> dict:
        used_model = model or settings.llm_default_model
        return self._session_to_dict(self.repo.create(title=title, model=used_model))

    def get_session(self, session_id: str) -> dict:
        session = self.repo.get(session_id)
        states = self.repo.list_thread_states(session_id)
        thread_messages = {
            state["threadId"]: self.repo.get_all_messages(session_id, state["threadId"])
            for state in states
        }
        return {
            "id": session.id,
            "title": session.title,
            "createdAt": int(session.created_at * 1000),
            "model": session.model,
            "messages": self.repo.get_messages(session_id, thread_id="main"),
            "threads": [self._normalize_thread_state(s, session_id) for s in states],
            "threadMessages": thread_messages,
        }

    def build_learning_report(self, session_id: str) -> str:
        """生成可交给家长/老师的学习报告，把追问树转化为学习证据。"""
        session = self.repo.get(session_id)
        states = [self._normalize_thread_state(s, session_id) for s in self.repo.list_thread_states(session_id)]
        main_messages = self.repo.get_all_messages(session_id, "main")
        thread_messages = {
            state["threadId"]: self.repo.get_all_messages(session_id, state["threadId"])
            for state in states
        }

        followup_count = sum(len(messages) for messages in thread_messages.values())
        max_depth = max((state["level"] for state in states), default=0)
        selected_texts = [state.get("source", {}).get("selectedText", "") for state in states]
        hot_topics = self._top_terms(selected_texts)
        generated_at = datetime.now().strftime("%Y-%m-%d %H:%M")

        lines = [
            f"# June AI 学习报告",
            "",
            f"- 会话：{session.title}",
            f"- 生成时间：{generated_at}",
            f"- 模型：{session.model}",
            "",
            "## 学习概览",
            "",
            f"- 主对话消息：{len(main_messages)} 条",
            f"- 追问线程：{len(states)} 个",
            f"- 追问消息：{followup_count} 条",
            f"- 最深追问：L{max_depth}",
            "",
        ]
        if hot_topics:
            lines.extend(["## 高频卡点", ""])
            lines.extend(f"- {term}：出现 {count} 次" for term, count in hot_topics)
            lines.append("")

        lines.extend(["## 追问轨迹", ""])
        if not states:
            lines.append("本次会话还没有形成追问轨迹。")
        for state in sorted(states, key=lambda item: (item["level"], item["updatedAt"] or 0)):
            path = self._thread_path(state["threadId"], states)
            selected = self._clip(state.get("source", {}).get("selectedText", ""), 120)
            messages = thread_messages.get(state["threadId"], [])
            first_question = next((m for m in messages if m["role"] == "user"), None)
            last_answer = next((m for m in reversed(messages) if m["role"] == "assistant"), None)
            lines.extend([
                f"### {path}",
                "",
                f"- 关注内容：{selected or '未记录'}",
                f"- 首次追问：{self._clip(first_question['content'], 180) if first_question else '未发送'}",
                f"- 最新结论：{self._clip(self._strip_think(last_answer['content']), 260) if last_answer else '等待回答'}",
                "",
            ])

        lines.extend([
            "## 使用建议",
            "",
            "- 高频卡点适合整理进错题本，并安排同类题目复练。",
            "- 深层追问说明学习者愿意持续探究，可鼓励其把追问路径讲给他人。",
            "- 若同一概念反复出现，应回到教材对应章节做系统复习。",
            "",
        ])
        return "\n".join(lines)

    def list_sessions(self, limit: int = 50) -> list[dict]:
        return [self._session_to_dict(s) for s in self.repo.list_all(limit)]

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
            "createdAt": int(session.created_at * 1000),
            "model": session.model,
            "messages": self.repo.get_messages(session.id, thread_id="main"),
        }

    def save_user_message(self, session_id: str, content: str, message_id: str | None = None) -> dict:
        if message_id:
            msg = self.repo.add_message_once(message_id, session_id, "user", content, thread_id="main")
        else:
            msg = self.repo.add_message(session_id, "user", content, thread_id="main")
        return self._message_to_dict(msg, "main")

    async def stream_main_chat(
        self,
        session_id: str,
        session_messages: list[dict],
        assistant_message_id: str = "",
    ):
        full_content = ""
        main_thread_id = self._storage_main_id(session_id)
        try:
            from ..thread_manager import ThreadInfo

            self.repo.upsert_thread(session_id, main_thread_id, "root", 0)
            self.thread_mgr.register(ThreadInfo(
                thread_id=main_thread_id,
                parent_thread_id="root",
                session_id=session_id,
            ))
            self.thread_mgr.touch(main_thread_id)
            messages_with_system = [{"role": "system", "content": self.SYSTEM_PROMPT}] + session_messages
            async for delta in self.deepseek.chat(
                messages=messages_with_system,
                api_key=self.deepseek.get_api_key(),
            ):
                if isinstance(delta, dict):
                    if delta.get("type") == "reasoning":
                        yield {"type": "reasoning"}
                else:
                    full_content += delta
                    yield {"delta": delta, "type": "text"}
        finally:
            if full_content:
                if assistant_message_id:
                    self.repo.add_message_once(
                        assistant_message_id,
                        session_id,
                        "assistant",
                        full_content,
                        thread_id="main",
                    )
                else:
                    self.repo.add_message(session_id, "assistant", full_content, thread_id="main")
            yield {"done": True, "thread_id": "main", "usage": {}}
            self.thread_mgr.close(main_thread_id, cascade=False)

    def register_thread(self, session_id: str, body: ThreadRegisterRequest) -> dict:
        parent_storage_id = self._storage_thread_id(session_id, body.parent_thread_id)
        thread = self.repo.upsert_thread(
            session_id=session_id,
            thread_id=body.thread_id,
            parent_thread_id=parent_storage_id,
            level=body.level,
        )
        state = self.repo.upsert_thread_state(
            session_id=session_id,
            thread_id=body.thread_id,
            source_type=body.source.type,
            selected_text=body.source.selected_text or "",
            source_message_id=body.source.source_message_id,
            source_message_role=body.source.source_message_role,
            position=(body.position.get("x", 80), body.position.get("y", 120)) if body.position else None,
            size=(body.size.get("width", 420), body.size.get("height", 360)) if body.size else None,
            z_index=body.zIndex,
            is_minimized=False,
        )
        return self._normalize_thread_state(
            self.repo._thread_state_to_dict(state, thread),
            session_id,
        )

    def update_thread_state(self, session_id: str, thread_id: str, body: ThreadPatchRequest) -> dict | None:
        existing = self.repo.find_thread_state(thread_id)
        if existing is None or existing.session_id != session_id:
            return None
        state = self.repo.update_thread_ui(
            thread_id,
            position=(body.position["x"], body.position["y"]) if body.position else None,
            size=(body.size["width"], body.size["height"]) if body.size else None,
            is_minimized=body.is_minimized,
            z_index=body.z_index,
            settings=body.settings,
            is_closed=body.is_closed,
        )
        if state is None:
            return None
        thread = self.repo.find_thread(thread_id)
        result = self.repo._thread_state_to_dict(state, thread)
        return self._normalize_thread_state(result, session_id)

    async def stream_follow_up(self, session_id: str, body: FollowUpRequest):
        from ..thread_manager import ThreadInfo

        parent_storage_id = self._storage_thread_id(session_id, body.parent_thread_id)
        self.repo.upsert_thread(
            session_id=session_id,
            thread_id=body.thread_id,
            parent_thread_id=parent_storage_id,
            level=body.level,
        )
        state = self.repo.find_thread_state(body.thread_id)
        if state is None:
            self.repo.upsert_thread_state(
                session_id=session_id,
                thread_id=body.thread_id,
                source_type=body.source.type,
                selected_text=body.source.selected_text or "",
                source_message_id=body.source.source_message_id,
                source_message_role=body.source.source_message_role,
            )

        self.thread_mgr.register(ThreadInfo(
            thread_id=body.thread_id,
            parent_thread_id=body.parent_thread_id,
            session_id=session_id,
        ))
        self.thread_mgr.touch(parent_storage_id)

        user_message_id = body.user_message_id or uuid.uuid4().hex
        assistant_message_id = body.assistant_message_id or uuid.uuid4().hex
        self.repo.add_message_once(
            user_message_id,
            session_id,
            "user",
            body.query,
            thread_id=body.thread_id,
        )

        full_content = ""
        messages = self._build_follow_up_messages(session_id, body)
        temperature = body.temperature if body.temperature is not None else 0.7
        try:
            self.thread_mgr.touch(body.thread_id)
            async for delta in self.deepseek.chat(
                messages=messages,
                api_key=self.deepseek.get_api_key(),
                temperature=temperature,
            ):
                if isinstance(delta, dict):
                    if delta.get("type") == "reasoning":
                        yield {"type": "reasoning"}
                else:
                    full_content += delta
                    yield {"delta": delta, "type": "text"}
        finally:
            if full_content:
                self.repo.add_message_once(
                    assistant_message_id,
                    session_id,
                    "assistant",
                    full_content,
                    thread_id=body.thread_id,
                )
                self._refresh_thread_summary(session_id, body.thread_id)
            yield {
                "done": True,
                "thread_id": body.thread_id,
                "usage": {},
                "userMessageId": user_message_id,
                "assistantMessageId": assistant_message_id,
            }
            self.thread_mgr.close(body.thread_id, cascade=False)

    def _build_follow_up_messages(self, session_id: str, body: FollowUpRequest) -> list[dict]:
        states = {s["threadId"]: self._normalize_thread_state(s, session_id) for s in self.repo.list_thread_states(session_id)}
        current_messages = self.repo.get_all_messages(session_id, body.thread_id)
        current_history = current_messages[-self.CURRENT_MESSAGES_LIMIT:-1]
        parent_id = body.parent_thread_id

        sections: list[str] = []
        sections.append(f"### 当前状态\n- 追问层级：L{body.level}\n- 当前线程：{body.thread_id}")
        selected_text = body.source.selected_text or ""
        if selected_text:
            sections.append(f"### 学习者选中的原文\n{self._clip(selected_text, 800)}")

        if current_history:
            sections.append("### 当前追问线程的最近消息\n" + self._messages_to_text(
                current_history, limit=self.CURRENT_MESSAGES_LIMIT, clip=650,
            ))

        if parent_id != "main":
            parent_messages = self.repo.get_all_messages(session_id, parent_id)[-self.PARENT_MESSAGES_LIMIT:]
            if parent_messages:
                sections.append(f"### 父追问线程 {parent_id} 最近消息\n" + self._messages_to_text(parent_messages, clip=600))

        main_messages = self.repo.get_all_messages(session_id, "main")[-self.MAIN_MESSAGES_LIMIT:]
        if main_messages:
            sections.append("### 主对话最近消息\n" + self._messages_to_text(main_messages, clip=500))

        ancestor_summaries = self._ancestor_summaries(states, parent_id)
        if ancestor_summaries:
            sections.append("### 更早追问链摘要\n" + "\n".join(ancestor_summaries))

        sections.append("### 本轮追问\n" + body.query)
        if body.verbosity == "concise":
            sections.append("输出要求：最简洁地给出核心解释，控制在 150 字以内。")
        else:
            sections.append("输出要求：详细但聚焦，先直接回应困惑，再补充场景、类比或推导。")

        context_text = self._join_within_budget(sections, self.CONTEXT_BUDGET)
        return [
            {"role": "system", "content": self.FOLLOW_UP_SYSTEM_PROMPT},
            {"role": "user", "content": context_text},
        ]

    def _ancestor_summaries(self, states: dict[str, dict], parent_id: str) -> list[str]:
        summaries: list[str] = []
        visited: set[str] = set()
        current_id = parent_id
        parent_seen = False
        for _ in range(self.MAX_ANCESTORS):
            if current_id in ("main", "root", "") or current_id in visited:
                break
            visited.add(current_id)
            state = states.get(current_id)
            if state is None:
                break
            if parent_seen:
                summary = state.get("summary") or state.get("source", {}).get("selectedText") or "（无摘要）"
                summaries.append(f"- L{state.get('level', 1)}：{self._clip(summary, 700)}")
            parent_seen = True
            current_id = state.get("parentThreadId", "main")
        return summaries

    def _thread_path(self, thread_id: str, states: list[dict]) -> str:
        by_id = {state["threadId"]: state for state in states}
        levels: list[str] = []
        current = by_id.get(thread_id)
        visited: set[str] = set()
        while current and current["threadId"] not in visited:
            visited.add(current["threadId"])
            levels.insert(0, f"L{current['level']}")
            parent_id = current.get("parentThreadId", "main")
            current = by_id.get(parent_id) if parent_id != "main" else None
        return " / ".join(levels) or "L1"

    @staticmethod
    def _strip_think(content: str) -> str:
        return re.sub(r"<think>.*?</think>", "", content or "", flags=re.DOTALL).strip()

    @staticmethod
    def _top_terms(texts: list[str], limit: int = 5) -> list[tuple[str, int]]:
        counter: dict[str, int] = {}
        for text in texts:
            term = (text or "").strip()
            if term:
                counter[term] = counter.get(term, 0) + 1
        return sorted(counter.items(), key=lambda item: (-item[1], item[0]))[:limit]

    def _refresh_thread_summary(self, session_id: str, thread_id: str) -> None:
        state = self.repo.find_thread_state(thread_id)
        if state is None:
            return
        messages = self.repo.get_all_messages(session_id, thread_id)
        first_user = next((m for m in messages if m["role"] == "user"), None)
        last_assistant = next((m for m in reversed(messages) if m["role"] == "assistant"), None)
        source = state.selected_text or ""
        parts = []
        if source:
            parts.append(f"原文：{self._clip(source, 180)}")
        if first_user:
            parts.append(f"首个追问：{self._clip(first_user['content'], 280)}")
        if last_assistant:
            parts.append(f"最后结论：{self._clip(last_assistant['content'], 480)}")
        self.repo.update_thread_summary(thread_id, " / ".join(parts))

    async def stream_explain_mode(self, session_id: str, body):
        mode_prompts = {
            "simple": "请用最简单、最通俗的方式重新解释以下内容，就像讲给小学生听一样。多用生活中的类比，避免专业术语。语言要活泼有趣。",
            "standard": "请用清晰易懂的方式重新解释以下内容，适合中学生理解。适当使用类比，涉及专业术语时给出解释。",
            "advanced": "请用更专业、更深入的方式重新解释以下内容，适合高中生或大学生。可以引入更多背景知识和学科关联。",
        }
        mode_label = {"simple": "通俗模式", "standard": "标准模式", "advanced": "进阶模式"}
        prompt = mode_prompts.get(body.mode, mode_prompts["standard"])

        context_text = ""
        if body.context:
            recent = body.context[-6:]
            context_text = "\n\n之前的对话上下文：\n" + "\n".join(
                f"[{'学习者' if m.get('role') == 'user' else 'AI助手'}]: {m.get('content', '')[:200]}"
                for m in recent
            )

        messages = [
            {
                "role": "system",
                "content": "你是 June AI，一位 AI 伴学助手。你的专长是根据学习者的水平调整讲解深度。",
            },
            {
                "role": "user",
                "content": f"{prompt}\n\n需要重新解释的内容：\n\n{body.original_content}{context_text}",
            },
        ]

        full_content = ""
        try:
            async for delta in self.deepseek.chat(
                messages=messages,
                api_key=self.deepseek.get_api_key(),
            ):
                if isinstance(delta, dict):
                    if delta.get("type") == "reasoning":
                        yield {"type": "reasoning"}
                else:
                    full_content += delta
                    yield {"delta": delta, "type": "text"}
        finally:
            yield {"done": True, "mode": body.mode, "mode_label": mode_label.get(body.mode, ""), "usage": {}}

    @staticmethod
    def _storage_main_id(session_id: str) -> str:
        return f"main_{session_id}"

    def _storage_thread_id(self, session_id: str, thread_id: str) -> str:
        if thread_id == "main":
            return self._storage_main_id(session_id)
        return thread_id

    def _normalize_thread_state(self, state: dict, session_id: str) -> dict:
        main_storage_id = self._storage_main_id(session_id)
        if state.get("parentThreadId") == main_storage_id:
            state = {**state, "parentThreadId": "main"}
        return state

    @staticmethod
    def _message_to_dict(msg, thread_id: str) -> dict:
        return {
            "id": msg.id,
            "role": msg.role,
            "content": msg.content,
            "timestamp": int(msg.timestamp * 1000),
            "threadId": thread_id,
        }

    @staticmethod
    def _clip(text: str, limit: int) -> str:
        text = (text or "").strip()
        return text if len(text) <= limit else text[: limit - 1] + "…"

    def _messages_to_text(self, messages: list[dict], limit: int = 10, clip: int = 500) -> str:
        lines = []
        for message in messages[-limit:]:
            role = "学习者" if message.get("role") == "user" else "AI"
            lines.append(f"[{role}]: {self._clip(message.get('content', ''), clip)}")
        return "\n".join(lines)

    def _join_within_budget(self, sections: list[str], budget: int) -> str:
        output: list[str] = []
        used = 0
        for section in sections:
            remaining = budget - used
            if remaining <= 200:
                break
            if len(section) > remaining:
                section = self._clip(section, remaining)
            output.append(section)
            used += len(section) + 1
        return "\n\n".join(output)
