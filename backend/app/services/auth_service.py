import hashlib
import time

from ..core.config import settings
from ..core.exceptions import ForbiddenException, RateLimitException, UnauthorizedException, ValidationException
from ..core.security import make_auth_token
from ..repositories.commerce_repo import CommerceRepository


class AuthService:
    def __init__(self, repo: CommerceRepository):
        self.repo = repo

    def register(self, email: str, password: str, display_name: str) -> dict:
        if "@" not in email or email.startswith(".") or email.endswith("."):
            raise ValidationException("邮箱格式不正确")
        if len(password) < 8:
            raise ValidationException("密码至少 8 位")
        user = self.repo.create_user(email, password, display_name)
        return self._user_response(user)

    def login(self, account: str, password: str, ip: str = "", user_agent: str = "") -> dict:
        normalized_account = account.strip().lower()
        throttle_key = hashlib.sha256(f"{normalized_account}|{ip}".encode()).hexdigest()[:64]
        throttle = self.repo.get_login_throttle(throttle_key, normalized_account)
        now = time.time()
        if throttle.locked_until and throttle.locked_until > now:
            remaining = int(throttle.locked_until - now) + 1
            raise RateLimitException(f"登录尝试过多，请 {remaining} 秒后再试")

        user = self.repo.verify_user(normalized_account, password)
        if user is None:
            failed_count, locked_until = self.repo.record_login_failure(
                throttle_key,
                settings.JUNE_LOGIN_MAX_ATTEMPTS,
                settings.JUNE_LOGIN_WINDOW_SECONDS,
                settings.JUNE_LOGIN_LOCKOUT_SECONDS,
            )
            if locked_until:
                self.repo.add_audit(
                    "",
                    normalized_account,
                    "auth.login_locked",
                    ip=ip,
                    user_agent=user_agent,
                    detail={"reason": "too_many_failures"},
                )
                raise RateLimitException("登录失败次数过多，账号已临时锁定")
            remaining = settings.JUNE_LOGIN_MAX_ATTEMPTS - failed_count
            raise UnauthorizedException(f"账号或密码不正确，剩余 {max(remaining, 0)} 次尝试")
        if user.is_disabled:
            self.repo.add_audit(
                "",
                user.identity or user.email,
                "auth.login_disabled",
                target_type="user",
                target_id=user.id,
                ip=ip,
                user_agent=user_agent,
                detail={"reason": user.disabled_reason},
            )
            raise ForbiddenException("账号已禁用，请联系管理员")
        self.repo.reset_login_throttle(throttle_key)
        return self._user_response(user)

    def me(self, user_id: str) -> dict:
        user = self.repo.get_user_by_id(user_id)
        if user is None:
            raise UnauthorizedException("登录状态已失效，请重新登录")
        self.assert_user_active(user)
        return self._user_response(user)

    def assert_user_active(self, user_or_id) -> None:
        user = user_or_id if hasattr(user_or_id, "is_disabled") else self.repo.get_user_by_id(user_or_id)
        if user is None:
            raise UnauthorizedException("登录状态已失效，请重新登录")
        if user.is_disabled:
            raise UnauthorizedException("账号已禁用，请联系管理员")

    def _user_response(self, user) -> dict:
        return {
            "id": user.id,
            "email": user.email,
            "account": user.identity or user.email,
            "displayName": user.display_name,
            "isAdmin": bool(user.is_admin),
            "token": make_auth_token(user.id),
        }
