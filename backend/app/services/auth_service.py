from ..core.exceptions import UnauthorizedException, ValidationException
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

    def login(self, email: str, password: str) -> dict:
        user = self.repo.verify_user(email, password)
        if user is None:
            raise UnauthorizedException("账号或密码不正确")
        return self._user_response(user)

    def me(self, user_id: str) -> dict:
        user = self.repo.get_user_by_id(user_id)
        if user is None:
            raise UnauthorizedException("登录状态已失效，请重新登录")
        return self._user_response(user)

    def _user_response(self, user) -> dict:
        return {
            "id": user.id,
            "email": user.email,
            "account": user.identity or user.email,
            "displayName": user.display_name,
            "isAdmin": bool(user.is_admin),
            "token": make_auth_token(user.id),
        }
