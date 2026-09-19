"""
单用户模式的安全设施。

- 产品已去商业化（2026-09-19）：无登录、无多用户，/api/* 一律归属固定本地身份
- JUNE_API_TOKEN 仅用于保护 /metrics 端点（未配置时自动生成并写入 .env）
- BYOK 模型密钥仍使用 Fernet 加密落库
"""
import base64
import hashlib
import hmac
import secrets
import time
from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse
from .config import settings


def get_client_ip(request: Request) -> str:
    """获取直连对端 IP（单用户模式下仅用于审批操作记录）。"""
    return request.client.host if request.client else ""


def generate_token() -> str:
    """生成 32 字符的随机 hex token"""
    return secrets.token_hex(32)


def _byok_cipher(secret: str | None = None):
    """Create the server-side cipher for user-owned model API keys."""
    from cryptography.fernet import Fernet

    material = secret or settings.JUNE_BYOK_KEY or "june-dev-byok-secret"
    key = base64.urlsafe_b64encode(hashlib.sha256(material.encode()).digest())
    return Fernet(key)


def encrypt_api_key(api_key: str) -> str:
    return _byok_cipher().encrypt(api_key.encode()).decode()


def decrypt_api_key(encrypted_key: str) -> str:
    if not encrypted_key:
        return ""
    try:
        return _byok_cipher().decrypt(encrypted_key.encode()).decode()
    except Exception:
        # Transparently read pre-split ciphertext after a deployment adds JUNE_BYOK_KEY.
        legacy = settings.JUNE_AUTH_SECRET or settings.JUNE_API_TOKEN
        if not legacy:
            return ""
        try:
            return _byok_cipher(legacy).decrypt(encrypted_key.encode()).decode()
        except Exception:
            return ""


def ensure_token() -> str:
    """确保 token 存在：开发模式自动生成，生产模式使用配置值"""
    token = settings.JUNE_API_TOKEN
    if not token:
        token = generate_token()
        # 尝试写入 .env 文件以便重启后保持一致
        _persist_token(token)
        settings.JUNE_API_TOKEN = token
        print(f"\n{'='*60}")
        print(f"[June] 已自动生成 API Token: {token}")
        print(f"[June] 前端首次使用时需要输入此 Token")
        print(f"[June] Token 已保存到 .env 文件")
        print(f"{'='*60}\n")
    return token


def ensure_byok_key() -> str:
    """Persist an independent development/desktop BYOK encryption key."""
    if settings.JUNE_BYOK_KEY:
        return settings.JUNE_BYOK_KEY
    if settings.is_production:
        raise RuntimeError("生产模式必须配置 JUNE_BYOK_KEY")
    key = secrets.token_hex(32)
    _persist_env_value("JUNE_BYOK_KEY", key)
    settings.JUNE_BYOK_KEY = key
    print("[June] 已生成独立的 BYOK 加密密钥并写入 .env")
    return key


def _persist_env_value(name: str, value: str) -> None:
    """将配置写回 .env 文件（追加或更新）"""
    import os
    from pathlib import Path

    env_path = Path(__file__).resolve().parent.parent.parent / ".env"
    try:
        if env_path.exists():
            content = env_path.read_text(encoding="utf-8")
            if f"{name}=" in content:
                # 更新已有行
                lines = content.split("\n")
                new_lines = []
                for line in lines:
                    if line.startswith(f"{name}="):
                        new_lines.append(f"{name}={value}")
                    else:
                        new_lines.append(line)
                env_path.write_text("\n".join(new_lines), encoding="utf-8")
            else:
                # 追加
                with open(env_path, "a", encoding="utf-8") as f:
                    f.write(f"\n{name}={value}\n")
        else:
            env_path.write_text(f"{name}={value}\n", encoding="utf-8")
    except Exception:
        pass  # 写入失败不影响运行，token 在内存中仍然有效


def _persist_token(token: str) -> None:
    _persist_env_value("JUNE_API_TOKEN", token)


class SingleUserMiddleware(BaseHTTPMiddleware):
    """单用户模式：为所有 /api/* 请求标记固定本地身份。"""

    LOCAL_OWNER_ID = "local"

    async def dispatch(self, request: Request, call_next):
        if request.url.path.startswith("/api/"):
            request.state.owner_id = self.LOCAL_OWNER_ID
        return await call_next(request)
