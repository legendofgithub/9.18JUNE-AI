"""
安全与配置模块单元测试
"""
import pytest
from unittest.mock import patch, MagicMock
from app.core.config import Settings
from app.core.exceptions import JuneException, NotFoundException, UnauthorizedException, ValidationException
from app.core.response import success, error, not_found, unauthorized, server_error


class TestExceptions:
    """异常类测试"""

    def test_june_exception_default_code(self):
        exc = JuneException("测试错误")
        assert exc.message == "测试错误"
        assert exc.code == 400
        assert exc.data is None

    def test_june_exception_custom_code(self):
        exc = JuneException("自定义", code=503, data={"field": "name"})
        assert exc.code == 503
        assert exc.data == {"field": "name"}

    def test_not_found_exception(self):
        exc = NotFoundException("会话不存在")
        assert exc.code == 404
        assert "会话不存在" in str(exc)

    def test_unauthorized_exception(self):
        exc = UnauthorizedException()
        assert exc.code == 401
        assert "API Token" in exc.message

    def test_validation_exception(self):
        exc = ValidationException("缺少必填项")
        assert exc.code == 400


class TestResponse:
    """统一响应格式测试"""

    def test_success_default(self):
        resp = success({"key": "value"})
        assert resp["code"] == 200
        assert resp["message"] == "操作成功"
        assert resp["data"] == {"key": "value"}
        assert "timestamp" in resp

    def test_success_custom_message(self):
        resp = success(None, "创建成功")
        assert resp["message"] == "创建成功"
        assert resp["data"] is None

    def test_error_response(self):
        resp = error(400, "请求错误")
        assert resp["code"] == 400
        assert resp["message"] == "请求错误"

    def test_not_found_shortcut(self):
        resp = not_found("资源不存在")
        assert resp["code"] == 404

    def test_unauthorized_shortcut(self):
        resp = unauthorized()
        assert resp["code"] == 401

    def test_server_error_shortcut(self):
        resp = server_error("系统异常")
        assert resp["code"] == 500


class TestConfig:
    """配置模块测试"""

    def test_settings_development_default(self):
        """默认是开发模式"""
        s = Settings(JUNE_ENV="development")
        assert s.is_production == False

    def test_settings_production_mode(self):
        """生产模式检测"""
        s = Settings(JUNE_ENV="production")
        assert s.is_production == True

    def test_settings_db_path_default(self):
        """默认数据库路径包含 backend/june.db"""
        s = Settings(JUNE_DB_PATH="")
        assert "june.db" in s.db_path

    def test_settings_db_path_custom(self):
        """自定义数据库路径"""
        s = Settings(JUNE_DB_PATH="/data/custom.db")
        assert s.db_path == "/data/custom.db"

    def test_validate_production_no_api_key(self):
        """生产模式缺少 API Key 时报错"""
        s = Settings(JUNE_ENV="production", DEEPSEEK_API_KEY="", LLM_API_KEY="", JUNE_API_TOKEN="")
        errors = s.validate()
        assert len(errors) >= 1
        assert any("API Key" in e for e in errors)

    def test_validate_development_no_errors(self):
        """开发模式允许缺少配置"""
        s = Settings(JUNE_ENV="development", DEEPSEEK_API_KEY="", JUNE_API_TOKEN="")
        errors = s.validate()
        assert len(errors) == 0


class TestTokenAuth:
    """Token 鉴权测试"""

    def test_generate_token_length(self):
        from app.core.security import generate_token
        token = generate_token()
        assert len(token) >= 32

    def test_public_paths_bypass_auth(self):
        from app.core.security import _is_public_path
        assert _is_public_path("/health") is True
        assert _is_public_path("/") is True
        assert _is_public_path("/docs") is True
        assert _is_public_path("/assets/logo.png") is True
        assert _is_public_path("/index.html") is True

    def test_api_paths_require_auth(self):
        from app.core.security import _is_public_path
        assert _is_public_path("/api/sessions") is False
        assert _is_public_path("/api/models") is False
        assert _is_public_path("/api/status") is False


@pytest.fixture
def temp_db():
    """创建临时数据库的集成测试"""
    import tempfile, os
    from app.models.database import init_db, get_session

    tmp = tempfile.mktemp(suffix='.db')
    # Reset the global engine singleton so each test gets its own engine
    import app.models.database as db_module
    db_module._engine = None
    init_db(tmp)
    db = get_session(tmp)
    yield db
    db.close()
    # Dispose engine to release the file lock before unlinking on Windows
    if db_module._engine is not None:
        db_module._engine.dispose()
    db_module._engine = None
    if os.path.exists(tmp):
        os.unlink(tmp)


class TestDatabaseIntegration:
    """数据库集成测试"""

    def test_tables_created(self, temp_db):
        """验证所有表被创建"""
        from app.models.database import Base
        tables = [t for t in Base.metadata.tables]
        assert 'sessions' in tables
        assert 'messages' in tables
        assert 'threads' in tables
        assert 'files' in tables

    def test_cascade_delete(self, temp_db):
        """级联删除：删除 session 时关联的 messages 和 threads 也删除"""
        from app.models.database import SessionModel, MessageModel, ThreadModel

        session = SessionModel(id="cascade-test", title="级联测试")
        msg = MessageModel(session_id="cascade-test", role="user", content="test")
        thread = ThreadModel(id="t1", session_id="cascade-test", parent_thread_id="root", level=1)

        temp_db.add_all([session, msg, thread])
        temp_db.commit()

        # 确认存在
        assert temp_db.query(MessageModel).filter(MessageModel.session_id == "cascade-test").count() == 1
        assert temp_db.query(ThreadModel).filter(ThreadModel.session_id == "cascade-test").count() == 1

        # 删除 session
        temp_db.delete(session)
        temp_db.commit()

        # 确认级联删除
        assert temp_db.query(MessageModel).filter(MessageModel.session_id == "cascade-test").count() == 0
        assert temp_db.query(ThreadModel).filter(ThreadModel.session_id == "cascade-test").count() == 0
