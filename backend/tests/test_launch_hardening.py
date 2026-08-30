import secrets
import pytest

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient
import httpx

from app.core.config import settings
import app.core.config as config
from app.core.observability import ObservabilityMiddleware, RuntimeMetrics
from app.core.security import _byok_cipher, decrypt_api_key, encrypt_api_key
from app.core.url_security import PinnedModelTransport, ValidatedModelEndpoint
from app.models.database import ALEMBIC_HEAD, init_db
from app.repositories.commerce_repo import (
    LEGACY_PASSWORD_ITERATIONS,
    _pbkdf2,
    hash_password,
    verify_password,
)


def test_database_url_takes_priority_and_normalizes_postgres():
    instance = settings.__class__(
        JUNE_DATABASE_URL="postgres://user:pass@example.com:5432/postgres",
        JUNE_DB_PATH="ignored.db",
    )
    assert instance.database_url == "postgresql+psycopg://user:pass@example.com:5432/postgres"
    assert instance.connection_url == instance.database_url

    sqlite = settings.__class__(JUNE_DATABASE_URL="", JUNE_DB_PATH="local.db")
    assert sqlite.connection_url == "sqlite:///local.db"


def test_vercel_runtime_requires_postgres_workspace_andProduction_defaults(monkeypatch, tmp_path):
    monkeypatch.setattr(config, "running_on_vercel", lambda: True)
    instance = settings.__class__(JUNE_DB_PATH=str(tmp_path / "june.db"))
    assert instance.is_vercel_runtime is True
    assert instance.is_production is True
    assert instance.workspace_root == "/tmp/june-workspaces"

    desktop = settings.__class__(JUNE_ENV="desktop", JUNE_DB_PATH=str(tmp_path / "desktop.db"))
    assert desktop.is_production is False


def test_external_database_rejects_automatic_create_all():
    try:
        init_db("postgresql+psycopg://user:pass@example.com:5432/postgres")
    except RuntimeError as exc:
        assert "Alembic" in str(exc)
    else:
        raise AssertionError("External database initialization must be explicit")


def test_password_hash_uses_600k_iterations_and_accepts_legacy_hash():
    password = "correct-horse-battery"
    modern = hash_password(password)
    assert modern.startswith("pbkdf2_sha256$600000$")
    assert verify_password(password, modern, "")

    salt = secrets.token_hex(16)
    legacy = _pbkdf2(password, bytes.fromhex(salt), LEGACY_PASSWORD_ITERATIONS)
    assert verify_password(password, legacy, salt)
    assert not verify_password("wrong", legacy, salt)


def test_byok_encryption_uses_independent_key_and_reads_legacy_ciphertext(monkeypatch):
    current = secrets.token_hex(32)
    old_auth_secret = secrets.token_hex(32)
    monkeypatch.setattr(settings, "JUNE_BYOK_KEY", current)
    monkeypatch.setattr(settings, "JUNE_AUTH_SECRET", old_auth_secret)

    encrypted = encrypt_api_key("sk-current")
    assert decrypt_api_key(encrypted) == "sk-current"

    legacy = _byok_cipher(old_auth_secret).encrypt(b"sk-legacy").decode()
    assert decrypt_api_key(legacy) == "sk-legacy"


@pytest.mark.asyncio
async def test_pinned_model_transport_pins_ip_while_preserving_host_and_sni():
    endpoint = ValidatedModelEndpoint(
        "https://model.example.com:8443/v1",
        "model.example.com",
        "93.184.216.34",
    )
    transport = PinnedModelTransport(endpoint)
    captured = []

    class FakeInner:
        async def handle_async_request(self, request):
            captured.append(request)
            return httpx.Response(200, request=request)

    transport._transport = FakeInner()
    request = httpx.Request("POST", f"{endpoint.url}/chat/completions")
    await transport.handle_async_request(request)

    assert request.url.host == "93.184.216.34"
    assert request.headers["Host"] == "model.example.com:8443"
    assert request.extensions["sni_hostname"] == "model.example.com"


def test_metrics_requires_configured_token(monkeypatch):
    token = secrets.token_hex(16)
    monkeypatch.setattr(settings, "JUNE_METRICS_TOKEN", token)
    app = FastAPI()
    app.add_middleware(ObservabilityMiddleware, metrics=RuntimeMetrics())
    client = TestClient(app)

    assert client.get("/metrics").status_code == 404
    assert client.get(
        "/metrics",
        headers={"Authorization": f"Bearer {token}"},
    ).status_code == 200


def test_unhandled_exception_response_does_not_leak_details():
    app = FastAPI()

    @app.get("/boom")
    async def boom():
        raise RuntimeError("secret filesystem path D:\\secret")

    @app.exception_handler(Exception)
    async def handler(request, exc):
        return JSONResponse(status_code=500, content={"message": "服务器内部错误，请稍后重试"})

    response = TestClient(app, raise_server_exceptions=False).get("/boom")
    assert response.status_code == 500
    assert "secret" not in response.text


def test_migration_head_is_rls_release():
    assert ALEMBIC_HEAD == "0002_enable_rls"
