"""
SessionRepository 单元测试 —— 使用 /tmp 目录直接建 SQLite
"""
import pytest
import os
import tempfile
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from app.models.database import Base
from app.repositories.session_repo import SessionRepository
from app.core.exceptions import NotFoundException

@pytest.fixture
def repo():
    db_path = os.path.join(tempfile.gettempdir(), f'june_test_{os.getpid()}.db')
    engine = create_engine(f'sqlite:///{db_path}', connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    db = Session(engine)
    r = SessionRepository(db)
    yield r
    db.close()
    engine.dispose()
    os.unlink(db_path)


class TestSessionRepository:
    def test_create_session(self, repo):
        s = repo.create(title="测试")
        assert s.id is not None
        assert s.title == "测试"
    def test_default_title(self, repo):
        assert repo.create().title == "新对话"
    def test_get_session(self, repo):
        c = repo.create(title="X"); f = repo.get(c.id); assert f.title == "X"
    def test_get_raises(self, repo):
        with pytest.raises(NotFoundException): repo.get("no")
    def test_find_none(self, repo):
        assert repo.find("no") is None
    def test_find_ok(self, repo):
        c = repo.create(); assert repo.find(c.id).id == c.id
    def test_exists_true(self, repo):
        assert repo.exists(repo.create().id)
    def test_exists_false(self, repo):
        assert not repo.exists("no")
    def test_list_all(self, repo):
        repo.create(); repo.create(); assert len(repo.list_all()) == 2
    def test_update_title(self, repo):
        c = repo.create(title="旧"); repo.update_title(c.id, "新")
        assert repo.get(c.id).title == "新"
    def test_delete(self, repo):
        c = repo.create(); repo.delete(c.id); assert not repo.exists(c.id)
    def test_delete_false(self, repo):
        assert not repo.delete("no")
    def test_add_message(self, repo):
        s = repo.create(); m = repo.add_message(s.id, "user", "hi")
        assert m.content == "hi"
    def test_get_messages(self, repo):
        s = repo.create()
        repo.add_message(s.id, "user", "a"); repo.add_message(s.id, "assistant", "b")
        msgs = repo.get_messages(s.id)
        assert len(msgs) == 2; assert msgs[0]["content"] == "a"
    def test_messages_by_thread(self, repo):
        s = repo.create()
        repo.add_message(s.id, "user", "main", thread_id="main")
        repo.add_message(s.id, "user", "f1", thread_id="followup_1")
        assert len(repo.get_messages(s.id, thread_id="main")) == 1
    def test_add_message_auto_create(self, repo):
        m = repo.add_message("auto-99", "user", "hi")
        assert repo.exists("auto-99")

    def test_upsert_thread_and_state(self, repo):
        s = repo.create()
        repo.upsert_thread(s.id, "f1", f"main_{s.id}", 1)
        repo.upsert_thread_state(
            s.id,
            "f1",
            selected_text="selected",
            source_message_id="m1",
            position=(20, 30),
            size=(400, 320),
            z_index=1024,
            settings={"verbosity": "concise"},
        )
        states = repo.list_thread_states(s.id)
        assert len(states) == 1
        assert states[0]["parentThreadId"] == f"main_{s.id}"
        assert states[0]["position"] == {"x": 20, "y": 30}
        assert states[0]["settings"]["verbosity"] == "concise"

    def test_update_thread_ui_and_summary(self, repo):
        s = repo.create()
        repo.upsert_thread(s.id, "f1", "main", 1)
        repo.upsert_thread_state(s.id, "f1")
        repo.update_thread_ui("f1", position=(1, 2), size=(330, 250), is_minimized=True, z_index=99, settings={"temperature": "low"}, is_closed=True)
        repo.update_thread_summary("f1", "summary")
        state = repo.list_thread_states(s.id)[0]
        assert state["position"] == {"x": 1, "y": 2}
        assert state["size"] == {"width": 330, "height": 250}
        assert state["isMinimized"] is True
        assert state["isClosed"] is True
        assert state["summary"] == "summary"

    def test_add_message_once_is_idempotent(self, repo):
        s = repo.create()
        first = repo.add_message_once("fixed-id", s.id, "user", "q", thread_id="f1")
        second = repo.add_message_once("fixed-id", s.id, "user", "q-retry", thread_id="f1")
        assert first.id == second.id
        messages = repo.get_all_messages(s.id, "f1")
        assert len(messages) == 1
        assert messages[0]["content"] == "q"
