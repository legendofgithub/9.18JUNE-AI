"""
API Token 鉴权中间件 —— Bearer Token 模式。

- 首次启动时，若未配置 JUNE_API_TOKEN 则自动生成并写入 .env
- /health、/、/docs、/openapi.json 等路径免鉴权
- 生产模式下前端通过 localStorage 存储 token，所有 /api/ 请求携带 Authorization: Bearer <token>
- SSE 请求因 EventSource 不支持自定义 Header，token 通过 URL 参数 ?token=xxx 传递
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


# 免鉴权路径前缀
PUBLIC_PATHS = {
    "/health",
    "/metrics",
    "/",
    "/docs",
    "/openapi.json",
    "/redoc",
    "/api/auth/register",
    "/api/auth/login",
    "/api/products",
    "/api/analytics/events",
    "/api/payments/stripe/webhook",
}


def _is_public_path(path: str) -> bool:
    """判断路径是否需要跳过鉴权"""
    # 精确匹配
    if path in PUBLIC_PATHS:
        return True
    # /assets/ 下的静态文件
    if path.startswith("/assets/"):
        return True
    # 前端 SPA 页面（非 /api/ 路径）
    if not path.startswith("/api/"):
        return True
    return False


def get_client_ip(request: Request) -> str:
    """获取客户端真实 IP。

    仅当「直连来源」属于受信反代（JUNE_TRUSTED_PROXIES）时才信任
    X-Forwarded-For 首值；否则忽略 XFF，使用 TCP 连接的对端 IP。
    这样可防止客户端伪造 X-Forwarded-For 绕过登录限流/锁定。
    """
    host = request.client.host if request.client else ""
    forwarded = request.headers.get("x-forwarded-for", "")
    if forwarded:
        candidate = forwarded.split(",")[0].strip()
        if candidate and host in settings.JUNE_TRUSTED_PROXIES:
            return candidate
    return host


def generate_token() -> str:
    """生成 32 字符的随机 hex token"""
    return secrets.token_hex(32)


def _auth_signature(payload: str) -> str:
    secret = settings.JUNE_AUTH_SECRET or settings.JUNE_API_TOKEN or "june-dev-auth-secret"
    digest = hmac.new(secret.encode(), payload.encode(), hashlib.sha256).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode()


def make_auth_token(owner_id: str, ttl_hours: int | None = None) -> str:
    expires_at = int(time.time()) + (ttl_hours or settings.JUNE_AUTH_TOKEN_HOURS) * 3600
    payload = f"v1.{owner_id}.{expires_at}"
    return f"{payload}.{_auth_signature(payload)}"


def verify_auth_token(token: str) -> str | None:
    """验证用户登录 token，返回 owner_id。"""
    try:
        version, owner_id, expires_at, signature = token.split(".", 3)
        if version != "v1":
            return None
        payload = f"{version}.{owner_id}.{expires_at}"
        if not hmac.compare_digest(signature, _auth_signature(payload)):
            return None
        if int(expires_at) < int(time.time()):
            return None
        return owner_id
    except (ValueError, TypeError):
        return None


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


class TokenAuthMiddleware(BaseHTTPMiddleware):
    """API Token 鉴权中间件

    检查规则：
    1. 公开路径 → 放行
    2. Authorization: Bearer <token> → 校验
    3. URL 参数 ?token=<token> → 校验（SSE 兼容）
    4. 无 token → 返回 401
    """

    async def dispatch(self, request: Request, call_next):
        path = request.url.path

        # CORS preflight never carries credentials; let CORSMiddleware answer it.
        if request.method == "OPTIONS":
            return await call_next(request)

        # 公开路径免鉴权
        if _is_public_path(path):
            return await call_next(request)

        # ensure_token() 启动时已将 token 写入 settings.JUNE_API_TOKEN。
        valid_token = settings.JUNE_API_TOKEN

        # 方式一：Authorization Header
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:]
            if token and valid_token and hmac.compare_digest(token, valid_token):
                request.state.auth_scheme = "admin"
                return await call_next(request)
            owner_id = verify_auth_token(token)
            if token and owner_id:
                request.state.owner_id = owner_id
                request.state.auth_scheme = "user"
                return await call_next(request)

        # 方式二：URL 参数 ?token=（EventSource / SSE 不支持自定义 Header，登录态走 query）
        query_token = request.query_params.get("token")
        if query_token:
            owner_id = verify_auth_token(query_token)
            if owner_id:
                request.state.owner_id = owner_id
                request.state.auth_scheme = "user"
                return await call_next(request)

        # 鉴权失败
        return JSONResponse(
            status_code=401,
            content={
                "code": 401,
                "message": "未授权访问，请提供有效的 API Token",
                "data": None,
                "timestamp": int(__import__("time").time() * 1000),
            },
        )
