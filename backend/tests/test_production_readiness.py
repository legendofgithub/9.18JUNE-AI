import hashlib
import hmac
import json
import time

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import Session
from starlette.responses import StreamingResponse

from app.core.config import settings
from app.models.database import RequestSessionMiddleware, get_request_scoped_session, init_db

from .test_commerce_api import auth_headers, make_client, register_and_login


def test_model_services_seed_two_users_with_owner_scoped_primary_keys(tmp_path):
    client, db, engine, _ = make_client(tmp_path)
    try:
        first = register_and_login(client, "first@example.com")
        second = register_and_login(client, "second@example.com")

        first_services = client.get("/api/model-services", headers=auth_headers(first)).json()["data"]
        second_services = client.get("/api/model-services", headers=auth_headers(second)).json()["data"]

        assert [item["id"] for item in first_services] == [item["id"] for item in second_services]
        assert len(first_services) == 5
        rows = db.execute(
            text("SELECT owner_id, id FROM model_services WHERE id = 'deepseek' ORDER BY owner_id")
        ).fetchall()
        assert len(rows) == 2
    finally:
        db.close()
        engine.dispose()


def test_login_rate_limit_disable_and_admin_audit(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "JUNE_LOGIN_MAX_ATTEMPTS", 2)
    monkeypatch.setattr(settings, "JUNE_LOGIN_WINDOW_SECONDS", 60)
    monkeypatch.setattr(settings, "JUNE_LOGIN_LOCKOUT_SECONDS", 60)

    client, db, engine, _ = make_client(tmp_path)
    try:
        client.app.state.auth_service.repo.seed_admin(
            "admin", "admin@example.com", "admin-password-123", "Admin"
        )
        admin_login = client.post("/api/auth/login", json={
            "account": "admin",
            "password": "admin-password-123",
        })
        admin = admin_login.json()["data"]
        user = register_and_login(client, "limited@example.com")

        first_failure = client.post("/api/auth/login", json={
            "account": "limited@example.com",
            "password": "wrong-password",
        })
        second_failure = client.post("/api/auth/login", json={
            "account": "limited@example.com",
            "password": "wrong-password",
        })
        locked_login = client.post("/api/auth/login", json={
            "account": "limited@example.com",
            "password": "secure-password",
        })

        assert first_failure.status_code == 401
        assert "剩余 1 次" in first_failure.json()["message"]
        assert second_failure.status_code == 429
        assert locked_login.status_code == 429

        users = client.get("/api/admin/users", headers=auth_headers(admin)).json()["data"]
        target = next(item for item in users if item["email"] == "limited@example.com")
        disabled = client.patch(
            f"/api/admin/users/{target['id']}",
            headers=auth_headers(admin),
            json={"disabled": True, "reason": "安全演练"},
        )
        disabled_login = client.post("/api/auth/login", json={
            "account": "limited@example.com",
            "password": "secure-password",
        })
        disabled_token = client.get("/api/auth/me", headers=auth_headers(user))
        disabled_api = client.get("/api/coach/status", headers=auth_headers(user))
        audit = client.get("/api/admin/audit-logs", headers=auth_headers(admin)).json()["data"]

        assert disabled.status_code == 200
        assert disabled.json()["data"]["isDisabled"] is True
        unlocked = client.post(
            f"/api/admin/users/{target['id']}/unlock",
            headers=auth_headers(admin),
        )
        assert unlocked.status_code == 200
        disabled_login = client.post("/api/auth/login", json={
            "account": "limited@example.com",
            "password": "secure-password",
        })
        assert disabled_login.status_code == 403
        assert disabled_token.status_code == 401
        assert disabled_api.status_code == 401
        assert any(item["action"] == "admin.user_disabled" for item in audit)
        assert any(item["action"] == "auth.login_locked" for item in audit)
    finally:
        db.close()
        engine.dispose()


def test_analytics_event_is_recorded_without_login(tmp_path):
    client, db, engine, _ = make_client(tmp_path)
    try:
        response = client.post("/api/analytics/events", json={
            "event_name": "payment.view",
            "route": "#/payment",
            "session_id": "anonymous-session",
            "properties": {"product": "super-solo-coach-unlock", "ignored_nested": {"x": 1}},
        })
        row = db.execute(text("SELECT event_name, owner_id, properties_json FROM analytics_events")).fetchone()

        assert response.status_code == 200
        assert row[0] == "payment.view"
        assert row[1] == ""
        assert json.loads(row[2])["product"] == "super-solo-coach-unlock"
        assert "ignored_nested" not in json.loads(row[2])
    finally:
        db.close()
        engine.dispose()


def test_legacy_model_service_schema_is_migrated_with_data(tmp_path):
    db_path = tmp_path / "legacy.db"
    engine = create_engine(f"sqlite:///{db_path}")
    with engine.begin() as connection:
        connection.exec_driver_sql("""
            CREATE TABLE model_services (
                id VARCHAR(60) PRIMARY KEY,
                owner_id VARCHAR(36) NOT NULL,
                display_name VARCHAR(120) NOT NULL,
                vendor VARCHAR(80) NOT NULL,
                base_url VARCHAR(500) NOT NULL,
                protocol VARCHAR(30) NOT NULL,
                encrypted_api_key TEXT NOT NULL DEFAULT '',
                api_key_ready BOOLEAN NOT NULL DEFAULT 0,
                version INTEGER NOT NULL DEFAULT 1,
                created_at FLOAT NOT NULL,
                updated_at FLOAT NOT NULL
            )
        """)
        connection.exec_driver_sql("""
            CREATE TABLE model_entries (
                id VARCHAR(36) PRIMARY KEY,
                service_id VARCHAR(60) NOT NULL,
                model_id VARCHAR(160) NOT NULL,
                display_name VARCHAR(160) NOT NULL,
                context_tokens INTEGER NOT NULL,
                max_output_tokens INTEGER NOT NULL,
                reasoning VARCHAR(20) NOT NULL,
                created_at FLOAT NOT NULL,
                FOREIGN KEY(service_id) REFERENCES model_services(id) ON DELETE CASCADE
            )
        """)
        connection.exec_driver_sql(
            "INSERT INTO model_services VALUES ('deepseek', 'user-1', 'DeepSeek', 'DeepSeek', "
            "'https://api.deepseek.com/v1', 'openai-compatible', 'cipher', 1, 3, 1, 2)"
        )
        connection.exec_driver_sql(
            "INSERT INTO model_entries VALUES ('entry-1', 'deepseek', 'deepseek-chat', 'Chat', 128000, 8192, 'medium', 1)"
        )
    engine.dispose()

    init_db(str(db_path))
    engine = create_engine(f"sqlite:///{db_path}")
    try:
        inspector = inspect(engine)
        service_pk = tuple(inspector.get_pk_constraint("model_services")["constrained_columns"])
        entry_pk = tuple(inspector.get_pk_constraint("model_entries")["constrained_columns"])
        with Session(engine) as session:
            service = session.execute(
                text("SELECT owner_id, encrypted_api_key, version FROM model_services WHERE id = 'deepseek'")
            ).fetchone()
            entry = session.execute(
                text("SELECT service_owner_id, model_id FROM model_entries WHERE service_id = 'deepseek'")
            ).fetchone()

        assert service_pk == ("id", "owner_id")
        assert entry_pk == ("id", "service_owner_id", "service_id")
        assert service == ("user-1", "cipher", 3)
        assert entry == ("user-1", "deepseek-chat")
    finally:
        engine.dispose()


def test_request_database_scope_survives_streaming_response(tmp_path):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    db_path = tmp_path / "streaming.db"
    init_db(str(db_path))
    app = FastAPI()
    app.add_middleware(RequestSessionMiddleware, db_path=str(db_path))

    @app.get("/stream")
    async def stream():
        async def generator():
            result = get_request_scoped_session().execute(text("SELECT 42")).scalar()
            yield f"value={result}\n"

        return StreamingResponse(generator(), media_type="text/event-stream")

    response = TestClient(app).get("/stream")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    assert response.text == "value=42\n"
