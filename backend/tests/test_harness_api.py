"""追问 harness API 合同测试。"""

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.models.database import Base
from app.repositories.session_repo import SessionRepository
from app.routes.sessions import router
from app.services.session_service import SessionService
from app.thread_manager import ThreadManager


class NoopLLM:
    def get_api_key(self):
        return ""


def make_client(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'api.db'}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    db = Session(engine)
    svc = SessionService(SessionRepository(db), NoopLLM(), ThreadManager())
    app = FastAPI()
    app.include_router(router, prefix="/api")
    app.state.session_service = svc
    return TestClient(app), db, engine


def test_thread_registration_patch_and_detail(tmp_path):
    client, db, engine = make_client(tmp_path)
    try:
        created = client.post("/api/sessions", json={"title": "API"})
        assert created.status_code == 200
        session_id = created.json()["data"]["id"]

        registered = client.post(f"/api/sessions/{session_id}/threads", json={
            "parent_thread_id": "main",
            "thread_id": "f1",
            "level": 1,
            "source": {
                "type": "text",
                "selected_text": "selected",
                "source_message_id": "source",
                "source_message_role": "assistant",
            },
            "position": {"x": 10, "y": 20},
            "size": {"width": 420, "height": 360},
            "zIndex": 1001,
        })
        assert registered.status_code == 200
        assert registered.json()["data"]["parentThreadId"] == "main"

        patched = client.patch(f"/api/sessions/{session_id}/threads/f1", json={
            "position": {"x": 30, "y": 40},
            "is_minimized": True,
            "z_index": 1002,
            "is_closed": False,
        })
        assert patched.status_code == 200
        assert patched.json()["data"]["position"] == {"x": 30, "y": 40}

        detail = client.get(f"/api/sessions/{session_id}")
        assert detail.status_code == 200
        data = detail.json()["data"]
        assert data["threads"][0]["threadId"] == "f1"
        assert data["threads"][0]["zIndex"] == 1002
        assert data["threadMessages"] == {"f1": []}
    finally:
        db.close()
        engine.dispose()
