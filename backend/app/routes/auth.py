from fastapi import APIRouter, Request

from ..core.exceptions import UnauthorizedException
from ..core.response import success
from ..models.commerce_schemas import LoginRequest, RegisterRequest


router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register")
async def register(body: RegisterRequest, request: Request):
    result = request.app.state.auth_service.register(
        body.email,
        body.password,
        body.display_name,
    )
    return success(result, "注册成功")


@router.post("/login")
async def login(body: LoginRequest, request: Request):
    forwarded = request.headers.get("x-forwarded-for", "")
    ip = (forwarded.split(",")[0].strip() if forwarded else "") or (request.client.host if request.client else "")
    result = request.app.state.auth_service.login(
        body.account,
        body.password,
        ip=ip,
        user_agent=request.headers.get("user-agent", ""),
    )
    return success(result, "登录成功")


@router.get("/me")
async def me(request: Request):
    owner_id = getattr(request.state, "owner_id", None)
    if not owner_id:
        raise UnauthorizedException("请先登录")
    result = request.app.state.auth_service.me(owner_id)
    return success(result)
