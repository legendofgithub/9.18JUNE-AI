"""
模型配置路由 —— 模型列表、API Key 设置。
支持任何 OpenAI 兼容格式的服务商。
"""
from fastapi import APIRouter, Request
from pydantic import BaseModel
from ..core.response import success
from ..core.config import settings
from ..services.deepseek import DeepSeekService

router = APIRouter()


class ModelConfigRequest(BaseModel):
    name: str
    api_key: str | None = None
    base_url: str | None = None


# 预置服务商列表（均为 OpenAI 兼容格式）
PROVIDERS = [
    {"id": "glm-5.2", "name": "Zhipu GLM-5.2", "provider": "zhipu", "base_url": "https://open.bigmodel.cn/api/paas/v4"},
    {"id": "deepseek-chat", "name": "DeepSeek Chat (V3)", "provider": "deepseek", "base_url": "https://api.deepseek.com/v1"},
    {"id": "deepseek-reasoner", "name": "DeepSeek Reasoner (R1)", "provider": "deepseek", "base_url": "https://api.deepseek.com/v1"},
    {"id": "gpt-4o", "name": "OpenAI GPT-4o", "provider": "openai", "base_url": "https://api.openai.com/v1"},
    {"id": "gpt-4o-mini", "name": "OpenAI GPT-4o mini", "provider": "openai", "base_url": "https://api.openai.com/v1"},
    {"id": "moonshot-v1-128k", "name": "Moonshot Kimi 128K", "provider": "moonshot", "base_url": "https://api.moonshot.cn/v1"},
    {"id": "glm-4-flash", "name": "Zhipu GLM-4 Flash", "provider": "zhipu", "base_url": "https://open.bigmodel.cn/api/paas/v4"},
    {"id": "qwen-plus", "name": "Qwen Plus (通义千问)", "provider": "qwen", "base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1"},
    {"id": "custom", "name": "自定义 (OpenAI 兼容)", "provider": "custom", "base_url": ""},
]


@router.get("/models")
async def list_models():
    """获取可用模型列表"""
    current_model = settings.llm_default_model
    current_base_url = settings.llm_base_url
    for p in PROVIDERS:
        p["is_current"] = (p["id"] == current_model)
    return success({
        "providers": PROVIDERS,
        "current_model": current_model,
        "current_base_url": current_base_url,
        "configured": bool(settings.llm_api_key),
    })


@router.put("/config/model")
async def set_model(body: ModelConfigRequest, request: Request):
    """设置当前使用的模型"""
    svc = request.app.state.deepseek_service
    svc.set_model(body.name, body.base_url or "")
    if body.api_key:
        svc.set_api_key(body.api_key)
    return success({"model": svc.DEFAULT_MODEL, "base_url": svc.BASE_URL}, "模型已切换")


@router.post("/config/test")
async def test_model_connection(body: ModelConfigRequest):
    """测试给定模型配置是否能真实访问，不改变当前运行时配置"""
    test_service = DeepSeekService()
    test_service.set_model(body.name, body.base_url or "")
    if body.api_key:
        test_service.set_api_key(body.api_key)
    result = await test_service.test_connection()
    return success(result)


@router.put("/config/api-key")
async def set_api_key(body: ModelConfigRequest, request: Request):
    """设置 API Key（运行时生效，不持久化）"""
    if body.api_key:
        svc = request.app.state.deepseek_service
        svc.set_api_key(body.api_key)
    if body.name:
        svc.set_model(body.name, body.base_url or "")
    return success(None, "API Key 已更新")
