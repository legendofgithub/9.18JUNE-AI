"""
应用配置 —— Pydantic BaseSettings 自动从环境变量 /.env 文件加载。

优先级：环境变量 > .env 文件 > 默认值
启动时自动校验必填项（production 模式下）。
"""
import os
import sys
from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict


def desktop_data_root() -> Path | None:
    """Return the writable desktop data directory when running from JuneAI.exe."""
    configured = os.getenv("JUNE_DESKTOP_DATA_DIR")
    if configured:
        return Path(configured).expanduser().resolve()
    if not getattr(sys, "frozen", False):
        return None
    portable = Path(sys.executable).resolve().parent / "data"
    try:
        portable.mkdir(parents=True, exist_ok=True)
        probe = portable / ".write-test"
        probe.write_text("ok", encoding="utf-8")
        probe.unlink()
        return portable
    except OSError:
        fallback = Path(os.getenv("LOCALAPPDATA", str(Path.home() / "AppData" / "Local"))) / "JuneAI"
        fallback.mkdir(parents=True, exist_ok=True)
        return fallback


def desktop_env_files() -> tuple[str, ...] | str:
    if not getattr(sys, "frozen", False):
        return ".env"
    return (
        str(Path(sys.executable).resolve().parent / ".env"),
        ".env",
    )


def running_on_vercel() -> bool:
    return os.getenv("VERCEL") == "1"


class Settings(BaseSettings):
    """June AI 全局配置"""

    # ---- 运行模式 ----
    JUNE_ENV: str = "development"  # development | desktop | production
    JUNE_DEBUG: bool = True
    JUNE_DEPLOYMENT_TARGET: str = ""  # vercel | server | desktop

    # ---- 数据库 ----
    JUNE_DATABASE_URL: str = ""  # postgresql+psycopg://...；为空时使用 JUNE_DB_PATH
    JUNE_DB_PATH: str = ""  # 空则使用默认路径 backend/june.db

    # ---- 服务端口 ----
    SERVER_HOST: str = "0.0.0.0"
    SERVER_PORT: int = 8000

    # ---- DeepSeek API（保留兼容）----
    DEEPSEEK_API_KEY: str = ""
    DEEPSEEK_BASE_URL: str = "https://api.deepseek.com/v1"
    DEEPSEEK_DEFAULT_MODEL: str = "deepseek-v4-pro"

    # ---- 通用 LLM 配置（兼容任何 OpenAI 格式 API 服务商）----
    # LLM_* 优先于 DEEPSEEK_*；若两者都未设则用 DeepSeek 默认值
    LLM_API_KEY: str = ""
    LLM_BASE_URL: str = ""
    LLM_DEFAULT_MODEL: str = ""

    # ---- CORS ----
    JUNE_CORS_ORIGINS: str = "http://localhost:5173,http://localhost:3000"

    # ---- 安全 ----
    JUNE_API_TOKEN: str = ""  # API 鉴权 token，为空时自动生成（development）或强制要求（production）
    JUNE_AUTH_SECRET: str = ""
    JUNE_BYOK_KEY: str = ""  # 独立加密用户自带模型密钥，避免随登录密钥轮换失效
    JUNE_AUTH_TOKEN_HOURS: int = 24 * 30

    # ---- 初始管理员 ----
    # 密码只放在本地 .env 或部署环境变量中，源码和示例文件不保存明文。
    JUNE_ADMIN_IDENTITY: str = "tony"
    JUNE_ADMIN_EMAIL: str = "tony@june.local"
    JUNE_ADMIN_DISPLAY_NAME: str = "Tony"
    JUNE_ADMIN_PASSWORD: str = ""

    # ---- 登录限流 ----
    JUNE_LOGIN_MAX_ATTEMPTS: int = 5
    JUNE_LOGIN_WINDOW_SECONDS: int = 900
    JUNE_LOGIN_LOCKOUT_SECONDS: int = 900

    # ---- 受信反代（仅这些直连 IP 的 X-Forwarded-For 才被信任）----
    # 默认仅本机（Nginx 反代）。公网部署请把反代 IP 加入这里，否则客户端可伪造 XFF 绕过登录锁定。
    JUNE_TRUSTED_PROXIES: list[str] = ["127.0.0.1", "::1", "::ffff:127.0.0.1"]

    # ---- 观测 ----
    JUNE_LOG_PATH: str = ""
    JUNE_METRICS_TOKEN: str = ""  # /metrics Bearer/query token；生产必填

    # ---- Harness 工作区 ----
    # AI 只能读写该根目录下的项目沙箱；生产环境应挂载到独立卷并纳入备份。
    JUNE_WORKSPACE_ROOT: str = ""

    # ---- SSE 配置 ----
    SSE_HEARTBEAT_INTERVAL: int = 15
    SSE_THREAD_TIMEOUT: int = 600  # 追问线程空闲超时（秒）

    # ---- 线程管理 ----
    THREAD_IDLE_TIMEOUT: int = 600
    THREAD_CLEANUP_INTERVAL: int = 60

    @property
    def is_production(self) -> bool:
        return self.JUNE_ENV == "production" or (
            running_on_vercel() and self.JUNE_ENV not in {"desktop", "production"}
        )

    @property
    def is_vercel_runtime(self) -> bool:
        return running_on_vercel()

    @property
    def is_desktop(self) -> bool:
        return self.JUNE_ENV == "desktop"

    @property
    def db_path(self) -> str:
        """解析数据库文件路径"""
        if self.JUNE_DB_PATH:
            return self.JUNE_DB_PATH
        if desktop_data_root():
            return str(desktop_data_root() / "june.db")
        # 默认路径：backend/june.db
        backend_dir = Path(__file__).resolve().parent.parent.parent
        return str(backend_dir / "june.db")

    @property
    def database_url(self) -> str:
        """Return the configured server database URL, or an empty string for SQLite."""
        url = self.JUNE_DATABASE_URL.strip()
        if url.startswith("postgres://"):
            url = url.replace("postgres://", "postgresql+psycopg://", 1)
        elif url.startswith("postgresql://"):
            url = url.replace("postgresql://", "postgresql+psycopg://", 1)
        return url

    @property
    def is_sqlite_database(self) -> bool:
        return not self.database_url

    @property
    def connection_url(self) -> str:
        """Return the SQLAlchemy URL used by the application."""
        return self.database_url or f"sqlite:///{self.db_path}"

    @property
    def llm_api_key(self) -> str:
        """解析 LLM API Key（LLM_* 优先，回退 DEEPSEEK_*）"""
        return self.LLM_API_KEY or self.DEEPSEEK_API_KEY

    @property
    def llm_base_url(self) -> str:
        """解析 LLM Base URL（LLM_* 优先，回退 DEEPSEEK_*）"""
        return self.LLM_BASE_URL or self.DEEPSEEK_BASE_URL

    @property
    def llm_default_model(self) -> str:
        """解析默认模型名（LLM_* 优先，回退 DEEPSEEK_*）"""
        return self.LLM_DEFAULT_MODEL or self.DEEPSEEK_DEFAULT_MODEL

    @property
    def cors_origins(self) -> list[str]:
        """解析 CORS 允许来源列表"""
        return [o.strip() for o in self.JUNE_CORS_ORIGINS.split(",") if o.strip()]

    def validate(self):
        """启动时校验：生产模式强制检查必填项"""
        errors: list[str] = []
        if self.is_production:
            if not self.JUNE_AUTH_SECRET or len(self.JUNE_AUTH_SECRET) < 32:
                errors.append("JUNE_AUTH_SECRET 未设置或长度不足（至少 32 字符）")
            if not self.JUNE_BYOK_KEY or len(self.JUNE_BYOK_KEY) < 32:
                errors.append("JUNE_BYOK_KEY 未设置或长度不足（至少 32 字符）")
            if not self.JUNE_METRICS_TOKEN or len(self.JUNE_METRICS_TOKEN) < 16:
                errors.append("JUNE_METRICS_TOKEN 未设置或长度不足（至少 16 字符）")
            if not self.JUNE_API_TOKEN or len(self.JUNE_API_TOKEN) < 16:
                errors.append("JUNE_API_TOKEN 未设置或长度不足（至少 16 字符），生产模式必须提供安全 Token")
        return errors

    @property
    def log_path(self) -> str:
        if self.JUNE_LOG_PATH:
            return self.JUNE_LOG_PATH
        if desktop_data_root():
            return str(desktop_data_root() / "logs")
        if self.is_production:
            return "/data/logs"
        return str(Path(__file__).resolve().parent.parent.parent / "logs")

    @property
    def workspace_root(self) -> str:
        if self.is_vercel_runtime:
            return "/tmp/june-workspaces"
        if self.JUNE_WORKSPACE_ROOT:
            return self.JUNE_WORKSPACE_ROOT
        if desktop_data_root():
            return str(desktop_data_root() / "workspaces")
        return str(Path(__file__).resolve().parent.parent.parent / "workspaces")

    model_config = SettingsConfigDict(
        env_file=desktop_env_files(),
        env_file_encoding="utf-8",
        extra="ignore",
    )


# 全局单例
settings = Settings()
