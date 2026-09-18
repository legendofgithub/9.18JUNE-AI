from fastapi import APIRouter, Query, Request

from ..core.exceptions import ForbiddenException, UnauthorizedException
from ..core.response import success
from ..core.security import get_client_ip
from ..models.commerce_schemas import AdminUserPatchRequest


router = APIRouter(prefix="/admin", tags=["admin"])


def _admin(request: Request):
    owner_id = getattr(request.state, "owner_id", None)
    if not owner_id:
        raise UnauthorizedException("请先登录")
    user = request.app.state.auth_service.repo.get_user_by_id(owner_id)
    if user is None:
        raise UnauthorizedException("登录状态已失效")
    request.app.state.auth_service.assert_user_active(user)
    if not user.is_admin:
        raise ForbiddenException("需要管理员权限")
    return user


def _request_context(request: Request) -> tuple[str, str]:
    return get_client_ip(request), request.headers.get("user-agent", "")


@router.get("/overview")
async def overview(request: Request):
    _admin(request)
    return success(request.app.state.admin_service.overview())


@router.get("/users")
async def list_users(request: Request, search: str = Query(default="", max_length=100)):
    _admin(request)
    return success(request.app.state.admin_service.list_users(search))


@router.patch("/users/{user_id}")
async def patch_user(user_id: str, body: AdminUserPatchRequest, request: Request):
    actor = _admin(request)
    ip, user_agent = _request_context(request)
    result = request.app.state.admin_service.set_user_disabled(
        actor.id,
        user_id,
        body.disabled,
        body.reason,
        ip,
        user_agent,
    )
    return success(result, "用户状态已更新")


@router.post("/users/{user_id}/unlock")
async def unlock_user(user_id: str, request: Request):
    actor = _admin(request)
    ip, user_agent = _request_context(request)
    return success(request.app.state.admin_service.unlock_user(actor.id, user_id, ip, user_agent))


@router.get("/audit-logs")
async def audit_logs(request: Request, limit: int = Query(default=100, ge=1, le=500)):
    _admin(request)
    return success(request.app.state.admin_service.list_audit_logs(limit))
