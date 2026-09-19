import hashlib
import hmac
import json
import time

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import Session
from starlette.responses import StreamingResponse

from app.core.config import settings
from app.models.database import RequestSessionMiddleware, get_request_scoped_session, init_db

from .test_commerce_api import make_client


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
        assert row[1] == "local"
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
