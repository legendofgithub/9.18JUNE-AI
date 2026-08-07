"""
模型配置路由 —— 模型列表、API Key 设置。
"""
from fastapi import APIRouter, Request
from pydantic import BaseModel
from ..core.response import success

router = APIRouter()


class ModelConfigRequest(BaseModel):
    name: str
    api_key: str | None = None


@router.get("/models")
async def list_models():
    """获取可用模型列表"""
    return success([
        {"id": "deepseek-v4-pro", "name": "DeepSeek V4 Pro", "provider": "deepseek", "vision": True},
        {"id": "deepseek-v4-flash", "name": "DeepSeek V4 Flash", "provider": "deepseek", "vision": True},
    ])


@router.put("/config/model")
async def set_model(body: ModelConfigRequest, request: Request):
    """设置当前使用的模型"""
    svc = request.app.state.deepseek_service
    return success({"model": body.name}, "模型已切换")


@router.put("/config/api-key")
async def set_api_key(body: ModelConfigRequest, request: Request):
    """设置 DeepSeek API Key"""
    if body.api_key:
        svc = request.app.state.deepseek_service
        svc.set_api_key(body.api_key)
    return success(None, "API Key 已更新")
