"""
应用配置 —— Pydantic BaseSettings 自动从环境变量 /.env 文件加载。

优先级：环境变量 > .env 文件 > 默认值
启动时自动校验必填项（production 模式下）。
"""
import os
from pathlib import Path
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """June AI 全局配置"""

    # ---- 运行模式 ----
    JUNE_ENV: str = "development"  # development | production
    JUNE_DEBUG: bool = True

    # ---- 数据库 ----
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

    # ---- 支付 ----
    # sandbox 用于本机联调；production 必须接入签名回调，避免客户端伪造支付
    JUNE_PAYMENT_PROVIDER: str = "sandbox"
    JUNE_PAYMENT_CALLBACK_SECRET: str = ""
    JUNE_PUBLIC_BASE_URL: str = ""
    JUNE_STRIPE_SECRET_KEY: str = ""
    JUNE_STRIPE_WEBHOOK_SECRET: str = ""

    # ---- 观测 ----
    JUNE_LOG_PATH: str = ""

    # ---- SSE 配置 ----
    SSE_HEARTBEAT_INTERVAL: int = 15
    SSE_THREAD_TIMEOUT: int = 600  # 追问线程空闲超时（秒）

    # ---- 线程管理 ----
    THREAD_IDLE_TIMEOUT: int = 600
    THREAD_CLEANUP_INTERVAL: int = 60

    @property
    def is_production(self) -> bool:
        return self.JUNE_ENV == "production"

    @property
    def db_path(self) -> str:
        """解析数据库文件路径"""
        if self.JUNE_DB_PATH:
            return self.JUNE_DB_PATH
        # 默认路径：backend/june.db
        backend_dir = Path(__file__).resolve().parent.parent.parent
        return str(backend_dir / "june.db")

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
            if self.JUNE_PAYMENT_PROVIDER == "sandbox":
                errors.append("生产模式不能使用 sandbox 支付，请配置正式支付通道")
            if self.JUNE_PAYMENT_PROVIDER == "stripe":
                if not self.JUNE_PUBLIC_BASE_URL.startswith("https://"):
                    errors.append("JUNE_PUBLIC_BASE_URL 必须是 HTTPS 地址")
                if not self.JUNE_STRIPE_SECRET_KEY:
                    errors.append("JUNE_STRIPE_SECRET_KEY 未设置，无法创建 Stripe 支付")
                if not self.JUNE_STRIPE_WEBHOOK_SECRET:
                    errors.append("JUNE_STRIPE_WEBHOOK_SECRET 未设置，无法验证支付回调")
            if not self.JUNE_API_TOKEN or len(self.JUNE_API_TOKEN) < 16:
                errors.append("JUNE_API_TOKEN 未设置或长度不足（至少 16 字符），生产模式必须提供安全 Token")
        return errors

    @property
    def log_path(self) -> str:
        if self.JUNE_LOG_PATH:
            return self.JUNE_LOG_PATH
        if self.is_production:
            return "/data/logs"
        return str(Path(__file__).resolve().parent.parent.parent / "logs")

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8", "extra": "ignore"}


# 全局单例
settings = Settings()
