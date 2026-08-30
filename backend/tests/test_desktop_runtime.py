import asyncio
from pathlib import Path

from app.core.config import settings
from app.main import root
from tests.test_harness_api import make_client, register_and_login


def test_desktop_first_registered_user_is_admin(tmp_path, monkeypatch):
    client, db, engine, _, __, ___, ____ = make_client(tmp_path)
    monkeypatch.setattr(settings, "JUNE_ENV", "desktop")
    try:
        first = register_and_login(client, "first.desktop@example.com")
        second = register_and_login(client, "second.desktop@example.com")
        assert first["isAdmin"] is True
        assert second["isAdmin"] is False
    finally:
        db.close()
        engine.dispose()


def test_web_root_serves_bundled_frontend(tmp_path, monkeypatch):
    index = tmp_path / "index.html"
    index.write_text("<!doctype html><html><body>June desktop</body></html>", encoding="utf-8")
    monkeypatch.setattr("app.main.frontend_dist", tmp_path)
    response = asyncio.run(root())
    assert response.status_code == 200
    assert response.media_type == "text/html"
    assert Path(response.path).name == "index.html"
