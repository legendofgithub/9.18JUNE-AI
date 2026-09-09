"""
追问链单元测试 —— 验证「无限追问」的可实施性：

1. 层级无限时，深层追问仍能拿到祖先链的上下文
2. 单条追问链无限延长时，上下文有压缩兜底且总量封顶
3. 追问结论自动沉淀为摘要
4. 追问结论可采纳为节点交付物（产品闭环）
5. 归档后追问仍被拒绝（AGENTS.md 硬性边界）
"""
import asyncio
import os
import tempfile

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.core.exceptions import JuneException
from app.models.database import Base
from app.models.schemas import FollowUpRequest, SourceInfo
from app.repositories.commerce_repo import CommerceRepository
from app.repositories.session_repo import SessionRepository
from app.services.mvp_service import MvpService


class FakeLLM:
    """不联网的模型替身，记录每次请求实际拿到的 messages"""

    def __init__(self, reply="追问回答"):
        self.reply = reply
        self.calls = []

    async def chat(self, **kwargs):
        self.calls.append(kwargs)
        yield self.reply

    def get_api_key(self):
        return "test-key"


@pytest.fixture
def env():
    db_path = os.path.join(tempfile.gettempdir(), f'june_followup_{os.getpid()}.db')
    if os.path.exists(db_path):
        os.unlink(db_path)
    engine = create_engine(f'sqlite:///{db_path}', connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    db = Session(engine)
    commerce = CommerceRepository(db)
    sessions = SessionRepository(db)
    llm = FakeLLM()
    owner = "user-followup"
    commerce.install_skill(owner, "test-model", "https://api.test", True, "not-a-real-cipher")
    service = MvpService(commerce, sessions, llm, None)
    run = service.create_run(owner, "测试项目", "本地商家")
    yield service, sessions, llm, owner, run["id"], db
    db.close()
    engine.dispose()
    if os.path.exists(db_path):
        os.unlink(db_path)


def request(thread_id, parent_thread_id, level, query, run_id=""):
    return FollowUpRequest(
        session_id=run_id,
        parent_thread_id=parent_thread_id,
        thread_id=thread_id,
        level=level,
        source=SourceInfo(type="text", selected_text="选中文本", source_message_id="msg-1"),
        query=query,
    )


def ask(service, owner, run_id, body):
    async def runner():
        return [chunk async for chunk in service.stream_follow_up(owner, run_id, body)]

    return asyncio.run(runner())


def last_prompt(llm):
    return llm.calls[-1]["messages"][-1]["content"]


class TestFollowUpChain:
    def test_deep_chain_keeps_ancestor_context(self, env):
        """L2 -> L3 -> L4 深链：L4 必须看得到 L2、L3 问过什么"""
        service, sessions, llm, owner, run_id, db = env
        ask(service, owner, run_id, request("t2", "main", 2, "L2 的问题", run_id))
        ask(service, owner, run_id, request("t3", "t2", 3, "L3 的问题", run_id))
        ask(service, owner, run_id, request("t4", "t3", 4, "L4 的问题", run_id))

        prompt = last_prompt(llm)
        assert "L2 的问题" in prompt
        assert "L3 的问题" in prompt
        assert "L4 的问题" in prompt

    def test_six_level_chain_still_answers_with_context(self, env):
        """六层追问：更远的祖先被压缩成结论，但链路不丢"""
        service, sessions, llm, owner, run_id, db = env
        previous = "main"
        for level in range(2, 8):
            thread_id = f"t{level}"
            ask(service, owner, run_id, request(thread_id, previous, level, f"第 {level} 层的问题", run_id))
            previous = thread_id

        prompt = last_prompt(llm)
        assert "第 7 层的问题" in prompt
        assert "第 6 层的问题" in prompt
        assert "已压缩" in prompt or "历史结论" in prompt

    def test_long_single_chain_is_compressed_and_capped(self, env):
        """同一条链连问 30 次：不报错、总量封顶、早期内容以压缩形式保留"""
        service, sessions, llm, owner, run_id, db = env
        for index in range(1, 31):
            ask(service, owner, run_id, request("long", "main", 2, f"追问第 {index} 次", run_id))

        prompt = last_prompt(llm)
        assert "追问第 30 次" in prompt
        assert len(prompt) < 16000

    def test_thread_summary_is_persisted(self, env):
        service, sessions, llm, owner, run_id, db = env
        ask(service, owner, run_id, request("t2", "main", 2, "这条链问了什么", run_id))
        state = sessions.find_thread_state("t2")
        assert state is not None
        assert "这条链问了什么" in state.summary
        assert "结论" in state.summary

    def test_adopt_follow_up_writes_artifact(self, env):
        """追问结论采纳进当前节点交付物，让追问真正推进流程"""
        service, sessions, llm, owner, run_id, db = env
        ask(service, owner, run_id, request("t2", "main", 2, "报价该怎么定", run_id))

        detail = service.adopt_follow_up(owner, run_id, "t2")
        content = detail["currentStep"]["artifactContent"]
        assert "报价该怎么定" in content
        assert "追问回答" in content
        assert "追问结论" in content

    def test_adopt_appends_without_overwriting_existing_draft(self, env):
        service, sessions, llm, owner, run_id, db = env
        detail = service.get_run_detail(owner, run_id)
        step_id = detail["currentStep"]["id"]
        ask(service, owner, run_id, request("t2", "main", 2, "先问一轮", run_id))

        service.adopt_follow_up(owner, run_id, "t2", title="追问沉淀")
        run_model = service.repo.get_run(owner, run_id)
        first_content = next(item.content for item in run_model.artifacts if item.step_id == step_id)

        ask(service, owner, run_id, request("t3", "main", 2, "再问一轮", run_id))
        service.adopt_follow_up(owner, run_id, "t3", title="第二轮沉淀")

        detail = service.get_run_detail(owner, run_id)
        content = detail["currentStep"]["artifactContent"]
        assert first_content in content
        assert "再问一轮" in content

    def test_adopt_rejected_after_archive(self, env):
        service, sessions, llm, owner, run_id, db = env
        ask(service, owner, run_id, request("t2", "main", 2, "归档前的追问", run_id))
        run_model = service.repo.get_run(owner, run_id)
        run_model.status = "completed"
        db.commit()

        with pytest.raises(JuneException):
            service.adopt_follow_up(owner, run_id, "t2")

    def test_follow_up_rejected_after_archive(self, env):
        service, sessions, llm, owner, run_id, db = env
        run_model = service.repo.get_run(owner, run_id)
        run_model.status = "completed"
        db.commit()

        with pytest.raises(JuneException):
            ask(service, owner, run_id, request("t2", "main", 2, "归档后还想问", run_id))


class TestThreadAncestry:
    def test_chain_stops_at_main(self, env):
        """parent 指向 main 时入库值是 session_id，链路应自然终止"""
        service, sessions, llm, owner, run_id, db = env
        sessions.upsert_thread(run_id, "t2", run_id, 2)
        assert [thread.id for thread in sessions.get_thread_ancestry("t2")] == ["t2"]

    def test_chain_survives_self_reference(self, env):
        """脏数据自引用不能把查询拖成死循环"""
        service, sessions, llm, owner, run_id, db = env
        sessions.upsert_thread(run_id, "loop", "loop", 3)
        assert len(sessions.get_thread_ancestry("loop")) == 1

    def test_recent_messages_returns_oldest_first_and_respects_limit(self, env):
        service, sessions, llm, owner, run_id, db = env
        for index in range(5):
            sessions.add_message(run_id, "user", f"第 {index} 条", thread_id="t9")
        rows = sessions.get_recent_messages(run_id, "t9", limit=2)
        assert [row["content"] for row in rows] == ["第 3 条", "第 4 条"]
