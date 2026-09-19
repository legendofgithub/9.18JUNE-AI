import pytest
from types import SimpleNamespace
from unittest.mock import MagicMock

from app.core.config import settings
from app.core.exceptions import ValidationException
from app.core.url_security import validate_model_base_url
from app.models.database import (
    get_request_scoped_session,
    init_db,
    request_db_scope,
)
from app.repositories.session_repo import SessionRepository
from app.services.mvp_service import MvpService


def test_model_base_url_rejects_metadata_and_private_addresses():
    for url in (
        "http://169.254.169.254/v1",
        "http://10.0.0.5/v1",
        "http://[fd00::1]/v1",
        "file:///tmp/model",
        "https://user:pass@api.openai.com/v1",
    ):
        with pytest.raises(ValidationException):
            validate_model_base_url(url)


def test_model_base_url_allows_loopback_only_in_development(monkeypatch):
    import socket

    real_getaddrinfo = socket.getaddrinfo

    def fake_getaddrinfo(host, port, *args, **kwargs):
        if host == "localhost":
            return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("127.0.0.1", 0))]
        return real_getaddrinfo(host, port, *args, **kwargs)

    monkeypatch.setattr(socket, "getaddrinfo", fake_getaddrinfo)
    assert validate_model_base_url("http://localhost:8001/v1/") == "http://localhost:8001/v1"


def test_request_scoped_sessions_are_isolated(tmp_path):
    db_path = str(tmp_path / "request-sessions.db")
    init_db(db_path)
    scoped = get_request_scoped_session()

    with request_db_scope(db_path) as first, request_db_scope(db_path) as second:
        assert first is not second
        first_repo = SessionRepository(first)
        second_repo = SessionRepository(second)
        first_repo.create(title="one")
        second_repo.create(title="two")
        assert len(second_repo.list_all()) == 2

    with pytest.raises(RuntimeError):
        scoped.query(1)


def test_permission_modes_change_model_contract_and_artifact_writes():
    service = MvpService(MagicMock(), MagicMock(), None, None)
    run = SimpleNamespace(title="测试项目", vertical="本地商家", blocker="", next_action="", steps=[])
    step = SimpleNamespace(
        step_key="buyer_pain",
        step_order=1,
        title="选择愿意付费的人群和痛点",
        objective="明确人群和痛点",
    )

    read_only = service._build_messages(run, step, [], permission="read-only")
    workspace_write = service._build_messages(run, step, [], permission="workspace-write")
    assert "当前权限为 read-only" in read_only[0]["content"]
    assert "当前权限为 workspace-write" in workspace_write[0]["content"]

    tracking = {
        "blocker": "人群还需收窄",
        "next_action": "列出 10 个具体客户",
        "vertical": "本地商家",
        "artifacts": [{
            "step_key": "buyer_pain",
            "title": "人群画布",
            "content": "AI 生成的草稿",
        }],
    }
    service._apply_tracking(run, step, tracking, permission="read-only")
    applied = service.repo.apply_tracking.call_args[0]
    assert applied[4] == []
    event_tracking = service.repo.add_event.call_args[0][4]
    assert event_tracking["permission_effect"]["suppressed_artifact_count"] == 1

    service._apply_tracking(run, step, tracking, permission="workspace-write")
    applied = service.repo.apply_tracking.call_args[0]
    assert len(applied[4]) == 1
    assert service.repo.add_event.call_args[0][4]["permission_effect"]["permission"] == "workspace-write"
