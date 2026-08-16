"""无限追问 harness 的持久化与上下文测试。"""

import pytest
from sqlalchemy import create_engine
from app.models.database import Base
from app.models.schemas import ContextInfo, FollowUpRequest, SourceInfo, ThreadRegisterRequest
from app.repositories.session_repo import SessionRepository
from app.services.session_service import SessionService
from app.thread_manager import ThreadManager
from sqlalchemy.orm import Session


class FixedLLM:
    def __init__(self, reply="answer"):
        self.reply = reply
        self.calls = []

    def get_api_key(self):
        return ""

    async def chat(self, **kwargs):
        self.calls.append(kwargs)
        yield self.reply


@pytest.fixture
def repo(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'harness.db'}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    db = Session(engine)
    yield SessionRepository(db)
    db.close()
    engine.dispose()


def make_service(repo, reply="answer"):
    return SessionService(repo, FixedLLM(reply), ThreadManager())


def register(session_id, thread_id, parent="main", level=1, selected="source"):
    return ThreadRegisterRequest(
        parent_thread_id=parent,
        thread_id=thread_id,
        level=level,
        source=SourceInfo(
            type="text",
            selected_text=selected,
            source_message_id="source-message",
            source_message_role="assistant",
        ),
        position={"x": 20, "y": 30},
        size={"width": 420, "height": 360},
        zIndex=1001,
    )


def follow_up(session_id, thread_id, parent="main", level=1, query="为什么？"):
    return FollowUpRequest(
        session_id=session_id,
        parent_thread_id=parent,
        thread_id=thread_id,
        level=level,
        source=SourceInfo(type="text", selected_text="source", source_message_id="m", source_message_role="assistant"),
        query=query,
        context=ContextInfo(main_thread_messages=[], parent_thread_messages=[]),
        user_message_id=f"user-{thread_id}",
        assistant_message_id=f"assistant-{thread_id}",
    )


@pytest.mark.asyncio
async def test_followup_messages_are_persisted_once(repo):
    svc = make_service(repo)
    session = svc.create_session()
    svc.register_thread(session["id"], register(session["id"], "f1"))
    body = follow_up(session["id"], "f1")

    [event async for event in svc.stream_follow_up(session["id"], body)]
    [event async for event in svc.stream_follow_up(session["id"], body)]

    messages = repo.get_all_messages(session["id"], "f1")
    assert [(m["role"], m["content"]) for m in messages] == [("user", "为什么？"), ("assistant", "answer")]
    state = repo.list_thread_states(session["id"])[0]
    assert "首个追问" in state["summary"]


@pytest.mark.asyncio
async def test_deep_context_uses_parent_and_ancestor_summary(repo):
    svc = make_service(repo)
    session = svc.create_session()
    repo.add_message(session["id"], "user", "main question", thread_id="main")
    repo.add_message(session["id"], "assistant", "main answer", thread_id="main")

    svc.register_thread(session["id"], register(session["id"], "f1", selected="first source"))
    [event async for event in svc.stream_follow_up(session["id"], follow_up(session["id"], "f1", query="第一层"))]
    svc.register_thread(session["id"], register(session["id"], "f2", parent="f1", level=2, selected="second source"))
    [event async for event in svc.stream_follow_up(session["id"], follow_up(session["id"], "f2", parent="f1", level=2, query="第二层"))]
    svc.register_thread(session["id"], register(session["id"], "f3", parent="f2", level=3, selected="third source"))

    messages = svc._build_follow_up_messages(
        session["id"],
        follow_up(session["id"], "f3", parent="f2", level=3, query="第三层"),
    )
    prompt = messages[1]["content"]
    assert "父追问线程 f2" in prompt
    assert "更早追问链摘要" in prompt
    assert "main question" in prompt
    assert len(prompt) <= svc.CONTEXT_BUDGET


def test_session_detail_restores_harness(repo):
    svc = make_service(repo)
    session = svc.create_session()
    repo.add_message(session["id"], "user", "main", thread_id="main")
    svc.register_thread(session["id"], register(session["id"], "f1"))
    repo.add_message_once("f1-user", session["id"], "user", "q", thread_id="f1")

    detail = svc.get_session(session["id"])
    assert len(detail["messages"]) == 1
    assert detail["threads"][0]["parentThreadId"] == "main"
    assert detail["threadMessages"]["f1"][0]["content"] == "q"


@pytest.mark.asyncio
async def test_learning_report_turns_followup_tree_into_evidence(repo):
    svc = make_service(repo)
    session = svc.create_session()
    repo.add_message(session["id"], "user", "main question", thread_id="main")
    repo.add_message(session["id"], "assistant", "<think>internal</think>main answer", thread_id="main")
    svc.register_thread(session["id"], register(session["id"], "f1", selected="卡点：函数单调性"))
    [event async for event in svc.stream_follow_up(session["id"], follow_up(session["id"], "f1", query="为什么单调性会变？"))]

    report = svc.build_learning_report(session["id"])

    assert "# June AI 学习报告" in report
    assert "追问线程：1 个" in report
    assert "L1" in report
    assert "卡点：函数单调性" in report
    assert "为什么单调性会变？" in report
    assert "internal" not in report
