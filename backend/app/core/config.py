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

    # ---- DeepSeek API ----
    DEEPSEEK_API_KEY: str = ""
    DEEPSEEK_BASE_URL: str = "https://api.deepseek.com/v1"
    DEEPSEEK_DEFAULT_MODEL: str = "deepseek-v4-pro"

    # ---- 安全 ----
    JUNE_API_TOKEN: str = ""  # API 鉴权 token，为空时自动生成（development）或强制要求（production）

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

    def validate(self):
        """启动时校验：生产模式强制检查必填项"""
        errors: list[str] = []
        if self.is_production:
            if not self.DEEPSEEK_API_KEY:
                errors.append("DEEPSEEK_API_KEY 未设置，生产模式必须提供 API Key")
            if not self.JUNE_API_TOKEN or len(self.JUNE_API_TOKEN) < 16:
                errors.append("JUNE_API_TOKEN 未设置或长度不足（至少 16 字符），生产模式必须提供安全 Token")
        return errors

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8", "extra": "ignore"}


# 全局单例
settings = Settings()
