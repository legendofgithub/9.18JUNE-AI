"""
SessionService 测试
"""
import pytest
from unittest.mock import MagicMock, AsyncMock
from app.services.session_service import SessionService

@pytest.fixture
def svc():
    repo = MagicMock()
    mock_s = MagicMock(); mock_s.id='s1'; mock_s.title='T'; mock_s.created_at=1000.0; mock_s.model='deepseek-chat'
    repo.create.return_value = mock_s
    repo.get.return_value = mock_s
    repo.find.return_value = mock_s
    repo.list_all.return_value = [mock_s]
    repo.get_messages.return_value = [{"id":"1","role":"user","content":"hi","timestamp":1000,"threadId":"main"}]
    repo.delete.return_value = True
    deepseek = MagicMock()
    tm = MagicMock()
    return SessionService(repo, deepseek, tm)

class TestSessionService:
    def test_create(self, svc):
        assert svc.create_session(title="X")["id"] == "s1"
    def test_get(self, svc):
        r = svc.get_session("s1"); assert len(r["messages"]) == 1
    def test_list(self, svc):
        assert len(svc.list_sessions()) == 1
    def test_delete(self, svc):
        assert svc.delete_session("s1"); svc.repo.delete.assert_called_once_with("s1")
    def test_ensure_exists(self, svc):
        r = svc.ensure_session("s1"); assert r["id"] == "s1"; svc.repo.create.assert_not_called()
    def test_ensure_creates(self, svc):
        svc.repo.find.return_value = None
        new = MagicMock(); new.id='new'; new.title='N'; new.created_at=2.0; new.model='m'
        svc.repo.create.return_value = new; svc.repo.get_messages.return_value = []
        r = svc.ensure_session("?"); assert r["id"] == 'new'; svc.repo.create.assert_called_once()

    @pytest.mark.asyncio
    async def test_stream_main(self, svc):
        async def gen(**kw):
            yield 'A'; yield 'B'
        svc.deepseek.chat = gen
        events = [e async for e in svc.stream_main_chat("s1", [{"role":"user","content":"?"}])]
        svc.repo.add_message.assert_called_with("s1", "assistant", "AB", thread_id="main")
        assert any("done" in e for e in events)

    @pytest.mark.asyncio
    async def test_stream_followup(self, svc):
        from app.models.schemas import FollowUpRequest, SourceInfo, ContextInfo
        body = FollowUpRequest(
            session_id="s1", parent_thread_id="m_s1", thread_id="f1", level=2,
            source=SourceInfo(type="text", selected_text="YYY", source_message_id="m1", source_message_role="assistant"),
            query="?", context=ContextInfo(main_thread_messages=[], parent_thread_messages=[]))

        chat_calls = []
        async def gen(**kw):
            chat_calls.append(kw)
            yield 'X'
        svc.deepseek.chat = gen
        events = [e async for e in svc.stream_follow_up("s1", body)]
        svc.thread_mgr.register.assert_called_once()
        assert len(chat_calls) == 1
        msgs = chat_calls[0]['messages']
        assert 'June AI' in msgs[0]['content']
        assert 'YYY' in msgs[1]['content']