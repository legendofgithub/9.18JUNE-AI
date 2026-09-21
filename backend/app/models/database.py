"""
SQLAlchemy ORM 模型定义

核心表：
- sessions:   会话（对话记录）
- messages:   消息（用户/AI 对话内容）
- threads:    追问线程（树状追问链，parent_thread_id 自引用）
- files:      资料文件（用户上传的学习材料）
"""
import uuid
import time
from pathlib import Path
from contextlib import contextmanager
from contextvars import ContextVar
from sqlalchemy import (
    Column,
    String,
    Integer,
    Text,
    Float,
    Boolean,
    ForeignKey,
    ForeignKeyConstraint,
    UniqueConstraint,
    create_engine,
    inspect,
    text,
)
from sqlalchemy import event
from sqlalchemy.orm import Session, declarative_base, relationship, sessionmaker

Base = declarative_base()


def gen_id() -> str:
    return str(uuid.uuid4())


def now_ms() -> int:
    return int(time.time() * 1000)


class SessionModel(Base):
    """会话表"""
    __tablename__ = "sessions"

    id = Column(String(36), primary_key=True, default=gen_id)
    owner_id = Column(String(36), nullable=False, default="", index=True)
    project_id = Column(String(36), index=True)
    title = Column(String(200), nullable=False, default="新对话")
    model = Column(String(50), nullable=False, default="deepseek-chat")
    summary = Column(Text, nullable=False, default="")
    permission = Column(String(20), nullable=False, default="read-only")
    created_at = Column(Float, default=lambda: time.time())
    updated_at = Column(Float, default=lambda: time.time(), onupdate=lambda: time.time())

    # 关联
    messages = relationship("MessageModel", back_populates="session", cascade="all, delete-orphan",
                            order_by="MessageModel.timestamp")
    threads = relationship("ThreadModel", back_populates="session", cascade="all, delete-orphan")
    files = relationship("FileModel", back_populates="session", cascade="all, delete-orphan")


class MessageModel(Base):
    """消息表（用户消息 + AI 回复）"""
    __tablename__ = "messages"

    id = Column(String(36), primary_key=True, default=gen_id)
    session_id = Column(String(36), ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False, index=True)
    owner_id = Column(String(36), nullable=False, default="", index=True)
    project_id = Column(String(36), index=True)
    role = Column(String(20), nullable=False)  # user / assistant
    content = Column(Text, nullable=False, default="")
    thread_id = Column(String(100), nullable=False, default="main")  # 所属线程标识
    tokens = Column(Integer, nullable=False, default=0)
    meta_json = Column(Text, nullable=False, default="{}")
    timestamp = Column(Float, default=lambda: time.time())

    # 反向关联
    session = relationship("SessionModel", back_populates="messages")


class ThreadModel(Base):
    """追问线程表（树状结构，parent_thread_id 指向父线程）"""
    __tablename__ = "threads"

    id = Column(String(100), primary_key=True)  # thread_id，如 "main_<session_id>" 或 UUID
    session_id = Column(String(36), ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False, index=True)
    parent_thread_id = Column(String(100), nullable=True, index=True)  # 父线程 ID，"root" 表示根
    level = Column(Integer, nullable=False, default=1)  # 追问层级：1=主对话 2=L2追问...
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(Float, default=lambda: time.time())
    last_activity = Column(Float, default=lambda: time.time())

    # 反向关联
    session = relationship("SessionModel", back_populates="threads")


class ThreadStateModel(Base):
    """追问线程的来源与 UI 状态，线程正文仍在 messages 中"""
    __tablename__ = "thread_states"

    id = Column(String(100), primary_key=True)
    session_id = Column(String(36), ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False, index=True)
    source_type = Column(String(20), nullable=False, default="text")
    selected_text = Column(Text, nullable=False, default="")
    source_message_id = Column(String(100), nullable=False, default="")
    source_message_role = Column(String(20), nullable=False, default="assistant")
    position_x = Column(Float, nullable=False, default=80)
    position_y = Column(Float, nullable=False, default=120)
    width = Column(Integer, nullable=False, default=420)
    height = Column(Integer, nullable=False, default=360)
    is_minimized = Column(Boolean, nullable=False, default=False)
    z_index = Column(Integer, nullable=False, default=1000)
    settings_json = Column(Text, nullable=False, default="{}")
    summary = Column(Text, nullable=False, default="")
    is_closed = Column(Boolean, nullable=False, default=False)
    created_at = Column(Float, default=lambda: time.time())
    updated_at = Column(Float, default=lambda: time.time(), onupdate=lambda: time.time())


class FileModel(Base):
    """资料文件表（用户上传的学习材料元数据）"""
    __tablename__ = "files"

    id = Column(String(36), primary_key=True, default=gen_id)
    session_id = Column(String(36), ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String(255), nullable=False)  # 原始文件名
    type = Column(String(20), nullable=False)  # pdf/docx/txt/md/image...
    size = Column(Integer, nullable=False, default=0)  # 文件大小（字节）
    stored_path = Column(String(500), nullable=False)  # 磁盘存储路径
    uploaded_at = Column(Float, default=lambda: time.time())

    # 反向关联
    session = relationship("SessionModel", back_populates="files")


class HarnessProjectModel(Base):
    """A server-side, owner-scoped Harness project attached to one paid MVP run."""
    __tablename__ = "harness_projects"

    id = Column(String(36), primary_key=True, default=gen_id)
    owner_id = Column(String(36), nullable=False, index=True)
    mvp_run_id = Column(String(36), ForeignKey("mvp_runs.id"), nullable=False, index=True)
    title = Column(String(200), nullable=False)
    metadata_json = Column(Text, nullable=False, default="{}")
    created_at = Column(Float, default=lambda: time.time())
    updated_at = Column(Float, default=lambda: time.time(), onupdate=lambda: time.time())


class HarnessFileModel(Base):
    """Indexed text snapshot inside a project sandbox."""
    __tablename__ = "harness_files"

    id = Column(String(36), primary_key=True, default=gen_id)
    project_id = Column(String(36), ForeignKey("harness_projects.id", ondelete="CASCADE"), nullable=False, index=True)
    owner_id = Column(String(36), nullable=False, index=True)
    path = Column(String(500), nullable=False)
    name = Column(String(255), nullable=False)
    mime_type = Column(String(120), nullable=False, default="text/plain")
    size = Column(Integer, nullable=False, default=0)
    content = Column(Text, nullable=False, default="")
    created_at = Column(Float, default=lambda: time.time())
    updated_at = Column(Float, default=lambda: time.time(), onupdate=lambda: time.time())


class HarnessMemoryModel(Base):
    """Durable project memory injected into future contexts."""
    __tablename__ = "harness_memories"

    id = Column(String(36), primary_key=True, default=gen_id)
    project_id = Column(String(36), ForeignKey("harness_projects.id", ondelete="CASCADE"), nullable=False, index=True)
    owner_id = Column(String(36), nullable=False, index=True)
    memory_type = Column(String(30), nullable=False, default="fact")
    content = Column(Text, nullable=False)
    created_at = Column(Float, default=lambda: time.time())
    updated_at = Column(Float, default=lambda: time.time(), onupdate=lambda: time.time())


class HarnessDocumentModel(Base):
    """Generated project document kept on the server."""
    __tablename__ = "harness_documents"

    id = Column(String(36), primary_key=True, default=gen_id)
    project_id = Column(String(36), ForeignKey("harness_projects.id", ondelete="CASCADE"), nullable=False, index=True)
    owner_id = Column(String(36), nullable=False, index=True)
    title = Column(String(200), nullable=False)
    content = Column(Text, nullable=False, default="")
    created_at = Column(Float, default=lambda: time.time())
    updated_at = Column(Float, default=lambda: time.time(), onupdate=lambda: time.time())


class AgentRunModel(Base):
    """One durable Agent execution and its recoverable state."""
    __tablename__ = "agent_runs"

    id = Column(String(36), primary_key=True, default=gen_id)
    owner_id = Column(String(36), nullable=False, index=True)
    project_id = Column(String(36), ForeignKey("harness_projects.id", ondelete="CASCADE"), nullable=False, index=True)
    session_id = Column(String(36), ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False, index=True)
    mvp_run_id = Column(String(36), nullable=False, index=True)
    status = Column(String(30), nullable=False, default="running", index=True)
    permission = Column(String(20), nullable=False, default="read-only")
    input = Column(Text, nullable=False, default="")
    iterations = Column(Integer, nullable=False, default=0)
    error = Column(Text, nullable=False, default="")
    context_json = Column(Text, nullable=False, default="{}")
    started_at = Column(Float, default=lambda: time.time())
    finished_at = Column(Float, nullable=True)
    updated_at = Column(Float, default=lambda: time.time(), onupdate=lambda: time.time())


class AgentEventModel(Base):
    """Append-only trace timeline for replay."""
    __tablename__ = "agent_events"

    id = Column(String(36), primary_key=True, default=gen_id)
    agent_run_id = Column(String(36), ForeignKey("agent_runs.id", ondelete="CASCADE"), nullable=False, index=True)
    event_type = Column(String(40), nullable=False, index=True)
    payload_json = Column(Text, nullable=False, default="{}")
    created_at = Column(Float, default=lambda: time.time(), index=True)


class ToolCallModel(Base):
    """Tool invocation, including pending high-risk writes."""
    __tablename__ = "tool_calls"

    id = Column(String(36), primary_key=True, default=gen_id)
    agent_run_id = Column(String(36), ForeignKey("agent_runs.id", ondelete="CASCADE"), nullable=False, index=True)
    owner_id = Column(String(36), nullable=False, index=True)
    name = Column(String(60), nullable=False, index=True)
    arguments_json = Column(Text, nullable=False, default="{}")
    result_json = Column(Text, nullable=False, default="{}")
    status = Column(String(30), nullable=False, default="pending", index=True)
    permission = Column(String(20), nullable=False, default="read-only")
    error = Column(Text, nullable=False, default="")
    started_at = Column(Float, default=lambda: time.time())
    ended_at = Column(Float, nullable=True)


class UserModel(Base):
    """数据归属账号（单用户模式下固定为 local）"""
    __tablename__ = "users"

    id = Column(String(36), primary_key=True, default=gen_id)
    email = Column(String(255), unique=True, nullable=False, index=True)
    identity = Column(String(80), nullable=False, default="", index=True)
    display_name = Column(String(80), nullable=False, default="")
    password_hash = Column(String(500), nullable=False)
    password_salt = Column(String(64), nullable=False)
    is_admin = Column(Boolean, nullable=False, default=False)
    is_disabled = Column(Boolean, nullable=False, default=False)
    disabled_at = Column(Float, nullable=True)
    disabled_reason = Column(String(300), nullable=False, default="")
    created_at = Column(Float, default=lambda: time.time())


class LoginThrottleModel(Base):
    """Persisted per-account/IP login limiter state."""
    __tablename__ = "login_throttles"

    key = Column(String(120), primary_key=True)
    account = Column(String(255), nullable=False, default="", index=True)
    failed_count = Column(Integer, nullable=False, default=0)
    window_started_at = Column(Float, nullable=False, default=0)
    locked_until = Column(Float, nullable=True)
    updated_at = Column(Float, default=lambda: time.time(), onupdate=lambda: time.time())


class AuditLogModel(Base):
    """Immutable operator/action trail for administrator and security events."""
    __tablename__ = "audit_logs"

    id = Column(String(36), primary_key=True, default=gen_id)
    actor_id = Column(String(36), nullable=False, default="", index=True)
    actor_account = Column(String(255), nullable=False, default="")
    action = Column(String(80), nullable=False, index=True)
    target_type = Column(String(40), nullable=False, default="")
    target_id = Column(String(120), nullable=False, default="")
    ip = Column(String(64), nullable=False, default="")
    user_agent = Column(String(300), nullable=False, default="")
    detail_json = Column(Text, nullable=False, default="{}")
    created_at = Column(Float, default=lambda: time.time(), index=True)


class AnalyticsEventModel(Base):
    """First-party, privacy-limited product event stream."""
    __tablename__ = "analytics_events"

    id = Column(String(36), primary_key=True, default=gen_id)
    event_name = Column(String(60), nullable=False, index=True)
    owner_id = Column(String(36), nullable=False, default="", index=True)
    route = Column(String(120), nullable=False, default="")
    session_id = Column(String(80), nullable=False, default="")
    properties_json = Column(Text, nullable=False, default="{}")
    created_at = Column(Float, default=lambda: time.time(), index=True)


class ProductModel(Base):
    """历史遗留的商品表（免费化后不再使用）"""
    __tablename__ = "products"

    id = Column(String(50), primary_key=True)
    name = Column(String(120), nullable=False)
    description = Column(Text, nullable=False, default="")
    price_cents = Column(Integer, nullable=False)
    path_count = Column(Integer, nullable=False)
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(Float, default=lambda: time.time())


class OrderModel(Base):
    """历史遗留的订单表（免费化后不再使用）"""
    __tablename__ = "orders"

    id = Column(String(36), primary_key=True, default=gen_id)
    owner_id = Column(String(36), nullable=False, index=True)
    product_id = Column(String(50), ForeignKey("products.id"), nullable=False)
    amount_cents = Column(Integer, nullable=False)
    path_count = Column(Integer, nullable=False)
    status = Column(String(20), nullable=False, default="pending", index=True)
    provider = Column(String(30), nullable=False, default="sandbox")
    provider_order_id = Column(String(120), nullable=False, default="", index=True)
    payment_url = Column(String(1000), nullable=False, default="")
    provider_transaction_id = Column(String(180), nullable=False, default="", index=True)
    paid_at = Column(Float, nullable=True)
    created_at = Column(Float, default=lambda: time.time())
    updated_at = Column(Float, default=lambda: time.time(), onupdate=lambda: time.time())

    product = relationship("ProductModel")


class EntitlementModel(Base):
    """用户可用的一次性 MVP 路径额度"""
    __tablename__ = "entitlements"

    owner_id = Column(String(36), primary_key=True)
    total_paths = Column(Integer, nullable=False, default=0)
    used_paths = Column(Integer, nullable=False, default=0)
    installed = Column(Boolean, nullable=False, default=False)
    updated_at = Column(Float, default=lambda: time.time(), onupdate=lambda: time.time())


class InstalledSkillModel(Base):
    """已安装的伴学助手技能版本"""
    __tablename__ = "installed_skills"

    id = Column(String(36), primary_key=True, default=gen_id)
    owner_id = Column(String(36), nullable=False, index=True)
    skill_key = Column(String(80), nullable=False, default="super-solo-coach")
    version = Column(String(20), nullable=False, default="1.0.0")
    model_name = Column(String(100), nullable=False, default="")
    base_url = Column(String(500), nullable=False, default="")
    api_key_ready = Column(Boolean, nullable=False, default=False)
    # Fernet ciphertext. API responses only expose api_key_ready, never this field.
    encrypted_api_key = Column(Text, nullable=False, default="")
    installed_at = Column(Float, default=lambda: time.time())


class ModelServiceModel(Base):
    """User-owned model service catalog."""
    __tablename__ = "model_services"

    id = Column(String(60), primary_key=True)
    owner_id = Column(String(36), primary_key=True)
    display_name = Column(String(120), nullable=False)
    vendor = Column(String(80), nullable=False, default="")
    base_url = Column(String(500), nullable=False)
    protocol = Column(String(30), nullable=False, default="openai-compatible")
    encrypted_api_key = Column(Text, nullable=False, default="")
    api_key_ready = Column(Boolean, nullable=False, default=False)
    version = Column(Integer, nullable=False, default=1)
    created_at = Column(Float, default=lambda: time.time())
    updated_at = Column(Float, default=lambda: time.time(), onupdate=lambda: time.time())

    models = relationship(
        "ModelEntryModel",
        back_populates="service",
        cascade="all, delete-orphan",
        order_by="ModelEntryModel.model_id",
    )


class ModelEntryModel(Base):
    """A selectable model under a user-owned service."""
    __tablename__ = "model_entries"

    id = Column(String(36), primary_key=True, default=gen_id)
    service_owner_id = Column(String(36), primary_key=True)
    service_id = Column(String(60), primary_key=True)
    model_id = Column(String(160), nullable=False)
    display_name = Column(String(160), nullable=False, default="")
    context_tokens = Column(Integer, nullable=False, default=128000)
    max_output_tokens = Column(Integer, nullable=False, default=4096)
    reasoning = Column(String(20), nullable=False, default="medium")
    created_at = Column(Float, default=lambda: time.time())

    service = relationship("ModelServiceModel", back_populates="models")

    __table_args__ = (
        ForeignKeyConstraint(
            ["service_owner_id", "service_id"],
            ["model_services.owner_id", "model_services.id"],
            ondelete="CASCADE",
        ),
        UniqueConstraint("service_owner_id", "service_id", "model_id", name="uq_model_entries_owner_route_model"),
    )


class PaymentEventModel(Base):
    """Provider callback trail used for reconciliation and replay diagnostics."""
    __tablename__ = "payment_events"

    id = Column(String(36), primary_key=True, default=gen_id)
    provider = Column(String(30), nullable=False)
    event_type = Column(String(80), nullable=False)
    provider_event_id = Column(String(180), nullable=False, default="", index=True)
    order_id = Column(String(36), nullable=False, default="", index=True)
    payload_json = Column(Text, nullable=False, default="{}")
    received_at = Column(Float, default=lambda: time.time(), index=True)


class MvpRunModel(Base):
    """一条一次性消耗的 MVP 项目路径"""
    __tablename__ = "mvp_runs"

    id = Column(String(36), primary_key=True, default=gen_id)
    owner_id = Column(String(36), nullable=False, index=True)
    installed_skill_id = Column(String(36), ForeignKey("installed_skills.id"), nullable=False)
    title = Column(String(200), nullable=False, default="未命名 MVP")
    vertical = Column(String(200), nullable=False, default="")
    status = Column(String(20), nullable=False, default="active", index=True)
    current_step_order = Column(Integer, nullable=False, default=1)
    blocker = Column(Text, nullable=False, default="")
    next_action = Column(Text, nullable=False, default="")
    created_at = Column(Float, default=lambda: time.time())
    updated_at = Column(Float, default=lambda: time.time(), onupdate=lambda: time.time())
    completed_at = Column(Float, nullable=True)

    steps = relationship(
        "RunStepModel",
        back_populates="run",
        cascade="all, delete-orphan",
        order_by="RunStepModel.step_order",
    )
    artifacts = relationship("RunArtifactModel", back_populates="run", cascade="all, delete-orphan")


class RunStepModel(Base):
    """客观流程节点"""
    __tablename__ = "run_steps"

    id = Column(String(36), primary_key=True, default=gen_id)
    run_id = Column(String(36), ForeignKey("mvp_runs.id", ondelete="CASCADE"), nullable=False, index=True)
    step_key = Column(String(50), nullable=False)
    step_order = Column(Integer, nullable=False)
    title = Column(String(120), nullable=False)
    objective = Column(String(300), nullable=False)
    required_artifact = Column(String(120), nullable=False)
    is_completed = Column(Boolean, nullable=False, default=False)
    completed_at = Column(Float, nullable=True)

    run = relationship("MvpRunModel", back_populates="steps")


class RunArtifactModel(Base):
    """节点交付物"""
    __tablename__ = "run_artifacts"

    id = Column(String(36), primary_key=True, default=gen_id)
    run_id = Column(String(36), ForeignKey("mvp_runs.id", ondelete="CASCADE"), nullable=False, index=True)
    step_id = Column(String(36), ForeignKey("run_steps.id", ondelete="CASCADE"), nullable=False, index=True)
    title = Column(String(200), nullable=False)
    content = Column(Text, nullable=False, default="")
    created_at = Column(Float, default=lambda: time.time())
    updated_at = Column(Float, default=lambda: time.time(), onupdate=lambda: time.time())

    run = relationship("MvpRunModel", back_populates="artifacts")


class RunEventModel(Base):
    """学习推进跟踪日志"""
    __tablename__ = "run_events"

    id = Column(String(36), primary_key=True, default=gen_id)
    run_id = Column(String(36), ForeignKey("mvp_runs.id", ondelete="CASCADE"), nullable=False, index=True)
    step_id = Column(String(36), ForeignKey("run_steps.id", ondelete="CASCADE"), nullable=False)
    event_type = Column(String(30), nullable=False)
    content = Column(Text, nullable=False, default="")
    metadata_json = Column(Text, nullable=False, default="{}")
    created_at = Column(Float, default=lambda: time.time())


# ---- 数据库引擎与请求级会话 ----

_engines: dict[str, object] = {}
_session_factories: dict[str, sessionmaker] = {}
_request_session: ContextVar[Session | None] = ContextVar("june_request_session", default=None)
ALEMBIC_HEAD = "0002_enable_rls"


def get_engine(connection_url: str):
    """获取数据库引擎（单例；SQLite 兼容传入文件路径）"""
    if "://" not in connection_url:
        connection_url = f"sqlite:///{connection_url}"
    if connection_url.startswith("sqlite:///"):
        sqlite_path = connection_url[len("sqlite:///"):]
        key = f"sqlite:///{Path(sqlite_path).resolve()}"
    else:
        key = connection_url
    if key not in _engines:
        engine = create_engine(
            key,
            echo=False,
            pool_pre_ping=True,
            **(
                {"connect_args": {"check_same_thread": False, "timeout": 30}}
                if key.startswith("sqlite")
                else {"pool_recycle": 1800, "connect_args": {"sslmode": "require"}}
            ),
        )
        _install_sqlite_pragmas(engine)
        _engines[key] = engine
    return _engines[key]


def _install_sqlite_pragmas(engine) -> None:
    if engine.dialect.name != "sqlite":
        return

    @event.listens_for(engine, "connect")
    def _set_sqlite_pragma(dbapi_connection, _record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.execute("PRAGMA busy_timeout=30000")
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.close()


def init_db(connection_url: str) -> None:
    """Initialize a local SQLite database, including legacy additive repairs."""
    if "://" in connection_url and not connection_url.startswith("sqlite:///"):
        raise RuntimeError("External databases must be created and upgraded with Alembic")
    engine = get_engine(connection_url)
    Base.metadata.create_all(engine)
    _migrate_sqlite(engine)


def verify_managed_database(connection_url: str) -> None:
    """Ensure an external database has been upgraded to the app migration head."""
    engine = get_engine(connection_url)
    if engine.dialect.name == "sqlite":
        init_db(connection_url)
        return
    inspector = inspect(engine)
    if "alembic_version" not in inspector.get_table_names():
        raise RuntimeError("External database is not initialized; run `alembic upgrade head` first")
    with engine.connect() as connection:
        versions = [row[0] for row in connection.execute(text("SELECT version_num FROM alembic_version"))]
    if ALEMBIC_HEAD not in versions:
        raise RuntimeError(
            "External database schema is outdated or from a different release; "
            "run `alembic upgrade head` before starting June AI"
        )


def _migrate_sqlite(engine) -> None:
    """Apply additive migrations to existing SQLite databases."""
    inspector = inspect(engine)
    if "installed_skills" not in inspector.get_table_names():
        return
    if "sessions" in inspector.get_table_names():
        session_columns = {column["name"] for column in inspector.get_columns("sessions")}
        with engine.begin() as connection:
            if "owner_id" not in session_columns:
                connection.execute(text("ALTER TABLE sessions ADD COLUMN owner_id VARCHAR(36) NOT NULL DEFAULT ''"))
            if "project_id" not in session_columns:
                connection.execute(text("ALTER TABLE sessions ADD COLUMN project_id VARCHAR(36)"))
            if "summary" not in session_columns:
                connection.execute(text("ALTER TABLE sessions ADD COLUMN summary TEXT NOT NULL DEFAULT ''"))
            if "permission" not in session_columns:
                connection.execute(text("ALTER TABLE sessions ADD COLUMN permission VARCHAR(20) NOT NULL DEFAULT 'read-only'"))
            connection.execute(text("CREATE INDEX IF NOT EXISTS ix_sessions_owner_id ON sessions (owner_id)"))
            connection.execute(text("CREATE INDEX IF NOT EXISTS ix_sessions_project_id ON sessions (project_id)"))
    if "messages" in inspector.get_table_names():
        message_columns = {column["name"] for column in inspector.get_columns("messages")}
        with engine.begin() as connection:
            if "owner_id" not in message_columns:
                connection.execute(text("ALTER TABLE messages ADD COLUMN owner_id VARCHAR(36) NOT NULL DEFAULT ''"))
            if "project_id" not in message_columns:
                connection.execute(text("ALTER TABLE messages ADD COLUMN project_id VARCHAR(36)"))
            if "tokens" not in message_columns:
                connection.execute(text("ALTER TABLE messages ADD COLUMN tokens INTEGER NOT NULL DEFAULT 0"))
            if "meta_json" not in message_columns:
                connection.execute(text("ALTER TABLE messages ADD COLUMN meta_json TEXT NOT NULL DEFAULT '{}'"))
            connection.execute(text("CREATE INDEX IF NOT EXISTS ix_messages_owner_id ON messages (owner_id)"))
            connection.execute(text("CREATE INDEX IF NOT EXISTS ix_messages_project_id ON messages (project_id)"))
    if "users" in inspector.get_table_names():
        user_columns = {column["name"] for column in inspector.get_columns("users")}
        with engine.begin() as connection:
            if "identity" not in user_columns:
                connection.execute(text("ALTER TABLE users ADD COLUMN identity VARCHAR(80) NOT NULL DEFAULT ''"))
            if "is_admin" not in user_columns:
                connection.execute(text("ALTER TABLE users ADD COLUMN is_admin BOOLEAN NOT NULL DEFAULT 0"))
            if "is_disabled" not in user_columns:
                connection.execute(text("ALTER TABLE users ADD COLUMN is_disabled BOOLEAN NOT NULL DEFAULT 0"))
            if "disabled_at" not in user_columns:
                connection.execute(text("ALTER TABLE users ADD COLUMN disabled_at FLOAT"))
            if "disabled_reason" not in user_columns:
                connection.execute(text("ALTER TABLE users ADD COLUMN disabled_reason VARCHAR(300) NOT NULL DEFAULT ''"))
            connection.execute(text("CREATE INDEX IF NOT EXISTS ix_users_identity ON users (identity)"))
    if "orders" in inspector.get_table_names():
        order_columns = {column["name"] for column in inspector.get_columns("orders")}
        with engine.begin() as connection:
            if "payment_url" not in order_columns:
                connection.execute(text("ALTER TABLE orders ADD COLUMN payment_url VARCHAR(1000) NOT NULL DEFAULT ''"))
            connection.execute(text("CREATE INDEX IF NOT EXISTS ix_orders_provider_order_id ON orders (provider_order_id)"))
    columns = {column["name"] for column in inspector.get_columns("installed_skills")}
    if "encrypted_api_key" not in columns:
        with engine.begin() as connection:
            connection.execute(text("ALTER TABLE installed_skills ADD COLUMN encrypted_api_key TEXT NOT NULL DEFAULT ''"))
    if "model_services" in inspector.get_table_names():
        service_pk = tuple(inspector.get_pk_constraint("model_services")["constrained_columns"])
        if service_pk != ("id", "owner_id"):
            _rebuild_model_service_tables(engine)


def _rebuild_model_service_tables(engine) -> None:
    """Convert the legacy global service PK to (owner_id, id) without dropping user data."""
    connection = engine.connect().execution_options(isolation_level="AUTOCOMMIT")
    try:
        connection.exec_driver_sql("PRAGMA foreign_keys=OFF")
        connection.commit()
        with connection.begin():
            connection.exec_driver_sql("DROP INDEX IF EXISTS ix_model_services_owner_id")
            connection.exec_driver_sql("DROP INDEX IF EXISTS ix_model_entries_service_id")
            connection.exec_driver_sql("ALTER TABLE model_services RENAME TO model_services_legacy")
            connection.exec_driver_sql("ALTER TABLE model_entries RENAME TO model_entries_legacy")
            ModelServiceModel.__table__.create(connection)
            ModelEntryModel.__table__.create(connection)
            connection.exec_driver_sql(
                """
                INSERT INTO model_services (
                    id, owner_id, display_name, vendor, base_url, protocol,
                    encrypted_api_key, api_key_ready, version, created_at, updated_at
                )
                SELECT
                    id, owner_id, display_name, vendor, base_url, protocol,
                    encrypted_api_key, api_key_ready, version, created_at, updated_at
                FROM model_services_legacy
                """
            )
            connection.exec_driver_sql(
                """
                INSERT INTO model_entries (
                    id, service_owner_id, service_id, model_id, display_name,
                    context_tokens, max_output_tokens, reasoning, created_at
                )
                SELECT
                    legacy.id, services.owner_id, legacy.service_id, legacy.model_id,
                    legacy.display_name, legacy.context_tokens, legacy.max_output_tokens,
                    legacy.reasoning, legacy.created_at
                FROM model_entries_legacy AS legacy
                JOIN model_services_legacy AS services ON services.id = legacy.service_id
                """
            )
            connection.exec_driver_sql("DROP TABLE model_entries_legacy")
            connection.exec_driver_sql("DROP TABLE model_services_legacy")
    finally:
        connection.exec_driver_sql("PRAGMA foreign_keys=ON")
        connection.close()


def get_session(connection_url: str) -> Session:
    """获取新的数据库会话"""
    return Session(get_engine(connection_url))


class RequestScopedSession:
    """Delegate repository operations to the session bound to the current request."""

    def _current(self) -> Session:
        session = _request_session.get()
        if session is None:
            raise RuntimeError("Database session is only available inside a request scope")
        return session

    def __getattr__(self, name):
        return getattr(self._current(), name)

    def close(self) -> None:
        session = _request_session.get()
        if session is not None:
            session.close()


@contextmanager
def request_db_scope(connection_url: str):
    """Create one SQLAlchemy session for a complete HTTP request/stream."""
    key = connection_url if "://" in connection_url and not connection_url.startswith("sqlite:///") else str(Path(connection_url.removeprefix("sqlite:///")).resolve())
    if key not in _session_factories:
        _session_factories[key] = sessionmaker(bind=get_engine(connection_url), expire_on_commit=False)
    session = _session_factories[key]()
    token = _request_session.set(session)
    try:
        yield session
    finally:
        _request_session.reset(token)
        session.rollback()
        session.close()


class RequestSessionMiddleware:
    """Keep one request-scoped database session alive through SSE response bodies."""

    def __init__(self, app, connection_url: str | None = None, db_path: str | None = None):
        self.app = app
        self.connection_url = connection_url or (f"sqlite:///{db_path}" if db_path else "sqlite:///")

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        with request_db_scope(self.connection_url):
            await self.app(scope, receive, send)


def get_request_scoped_session() -> RequestScopedSession:
    return RequestScopedSession()
