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
from sqlalchemy import Column, String, Integer, Text, Float, Boolean, ForeignKey, create_engine, inspect, text
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
    title = Column(String(200), nullable=False, default="新对话")
    model = Column(String(50), nullable=False, default="deepseek-chat")
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
    role = Column(String(20), nullable=False)  # user / assistant
    content = Column(Text, nullable=False, default="")
    thread_id = Column(String(100), nullable=False, default="main")  # 所属线程标识
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


class UserModel(Base):
    """购买与学习路径归属的账号"""
    __tablename__ = "users"

    id = Column(String(36), primary_key=True, default=gen_id)
    email = Column(String(255), unique=True, nullable=False, index=True)
    identity = Column(String(80), nullable=False, default="", index=True)
    display_name = Column(String(80), nullable=False, default="")
    password_hash = Column(String(500), nullable=False)
    password_salt = Column(String(64), nullable=False)
    is_admin = Column(Boolean, nullable=False, default=False)
    created_at = Column(Float, default=lambda: time.time())


class ProductModel(Base):
    """一次性付费 SKU"""
    __tablename__ = "products"

    id = Column(String(50), primary_key=True)
    name = Column(String(120), nullable=False)
    description = Column(Text, nullable=False, default="")
    price_cents = Column(Integer, nullable=False)
    path_count = Column(Integer, nullable=False)
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(Float, default=lambda: time.time())


class OrderModel(Base):
    """在线支付订单"""
    __tablename__ = "orders"

    id = Column(String(36), primary_key=True, default=gen_id)
    owner_id = Column(String(36), nullable=False, index=True)
    product_id = Column(String(50), ForeignKey("products.id"), nullable=False)
    amount_cents = Column(Integer, nullable=False)
    path_count = Column(Integer, nullable=False)
    status = Column(String(20), nullable=False, default="pending", index=True)
    provider = Column(String(30), nullable=False, default="sandbox")
    provider_order_id = Column(String(120), nullable=False, default="")
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
    """已安装的超级个体训练官版本"""
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
    owner_id = Column(String(36), nullable=False, index=True)
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
    service_id = Column(String(60), ForeignKey("model_services.id", ondelete="CASCADE"), nullable=False, index=True)
    model_id = Column(String(160), nullable=False)
    display_name = Column(String(160), nullable=False, default="")
    context_tokens = Column(Integer, nullable=False, default=128000)
    max_output_tokens = Column(Integer, nullable=False, default=4096)
    reasoning = Column(String(20), nullable=False, default="medium")
    created_at = Column(Float, default=lambda: time.time())

    service = relationship("ModelServiceModel", back_populates="models")


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
    """训练官跟踪日志"""
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


def get_engine(db_path: str):
    """获取数据库引擎（单例）"""
    key = str(Path(db_path).resolve())
    if key not in _engines:
        engine = create_engine(
            f"sqlite:///{db_path}",
            connect_args={"check_same_thread": False, "timeout": 30},
            echo=False,
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


def init_db(db_path: str) -> None:
    """初始化数据库：创建所有表"""
    engine = get_engine(db_path)
    Base.metadata.create_all(engine)
    _migrate_sqlite(engine)


def _migrate_sqlite(engine) -> None:
    """Apply additive migrations to existing SQLite databases."""
    inspector = inspect(engine)
    if "installed_skills" not in inspector.get_table_names():
        return
    if "users" in inspector.get_table_names():
        user_columns = {column["name"] for column in inspector.get_columns("users")}
        with engine.begin() as connection:
            if "identity" not in user_columns:
                connection.execute(text("ALTER TABLE users ADD COLUMN identity VARCHAR(80) NOT NULL DEFAULT ''"))
            if "is_admin" not in user_columns:
                connection.execute(text("ALTER TABLE users ADD COLUMN is_admin BOOLEAN NOT NULL DEFAULT 0"))
            connection.execute(text("CREATE INDEX IF NOT EXISTS ix_users_identity ON users (identity)"))
    columns = {column["name"] for column in inspector.get_columns("installed_skills")}
    if "encrypted_api_key" not in columns:
        with engine.begin() as connection:
            connection.execute(text("ALTER TABLE installed_skills ADD COLUMN encrypted_api_key TEXT NOT NULL DEFAULT ''"))


def get_session(db_path: str) -> Session:
    """获取新的数据库会话"""
    return Session(get_engine(db_path))


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
def request_db_scope(db_path: str):
    """Create one SQLAlchemy session for a complete HTTP request/stream."""
    key = str(Path(db_path).resolve())
    if key not in _session_factories:
        _session_factories[key] = sessionmaker(bind=get_engine(db_path), expire_on_commit=False)
    session = _session_factories[key]()
    token = _request_session.set(session)
    try:
        yield session
    finally:
        _request_session.reset(token)
        session.rollback()
        session.close()


def get_request_scoped_session() -> RequestScopedSession:
    return RequestScopedSession()
