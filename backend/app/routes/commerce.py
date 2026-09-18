import json
from typing import Literal

from fastapi import APIRouter, Request, Response
from pydantic import BaseModel, Field
from sse_starlette.sse import EventSourceResponse

from ..core.exceptions import UnauthorizedException
from ..core.security import verify_auth_token
from ..core.response import success
from ..models.schemas import FollowUpRequest
from ..models.commerce_schemas import (
    AnalyticsEventRequest,
    CoachStartRequest,
    ModelServiceDiscoverRequest,
    ModelServicePayload,
    MvpRunCreateRequest,
    RunStepPatchRequest,
    SkillInstallRequest,
)


router = APIRouter(tags=["commerce"])


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=8000)
    temperature: float | None = Field(default=None, ge=0.0, le=2.0)
    file_context: str | None = Field(default=None, max_length=20000)
    permission: Literal["read-only", "workspace-write", "full-access"] = "read-only"


class AdoptFollowUpRequest(BaseModel):
    """把一条追问链的结论采纳为当前节点的交付物草稿"""
    thread_id: str = Field(min_length=1, max_length=100)
    title: str | None = Field(default=None, max_length=200)


def _owner(request: Request) -> str:
    owner_id = getattr(request.state, "owner_id", None)
    if not owner_id:
        raise UnauthorizedException("请先登录后再使用训练服务")
    request.app.state.auth_service.assert_user_active(owner_id)
    return owner_id


def _sanitize_properties(properties: dict) -> dict:
    safe = {}
    for key, value in list(properties.items())[:20]:
        if not isinstance(key, str) or not key or len(key) > 40:
            continue
        if value is None or isinstance(value, (bool, int, float)):
            safe[key] = value
        elif isinstance(value, str):
            safe[key] = value[:200]
    return safe


@router.post("/analytics/events")
async def record_analytics_event(body: AnalyticsEventRequest, request: Request):
    owner_id = getattr(request.state, "owner_id", "")
    if not owner_id:
        token = request.headers.get("Authorization", "")
        if token.startswith("Bearer "):
            owner_id = verify_auth_token(token[7:]) or ""
    request.app.state.commerce_repo.add_analytics_event(
        body.event_name,
        owner_id,
        body.route,
        body.session_id,
        _sanitize_properties(body.properties),
    )
    return success({"accepted": True}, "事件已记录")


@router.get("/coach/status")
async def coach_status(request: Request):
    return success(request.app.state.commerce_service.get_coach_status(_owner(request)))


@router.post("/coach/start")
async def start_coach(body: CoachStartRequest, request: Request):
    result = await request.app.state.commerce_service.start_coach(
        _owner(request),
        body.model_name,
        body.base_url,
        body.api_key,
    )
    return success(result, "超级个体训练师人格已启动")


@router.get("/skills/current")
async def get_current_skill(request: Request):
    return success(request.app.state.commerce_service.get_skill(_owner(request)))


@router.get("/model-services")
async def list_model_services(request: Request):
    return success(request.app.state.commerce_service.list_model_services(_owner(request)))


@router.post("/model-services")
async def create_model_service(body: ModelServicePayload, request: Request):
    result = request.app.state.commerce_service.save_model_service(_owner(request), body)
    return success(result, "模型服务已创建")


@router.put("/model-services/{service_id}")
async def update_model_service(service_id: str, body: ModelServicePayload, request: Request):
    result = request.app.state.commerce_service.save_model_service(_owner(request), body, service_id)
    return success(result, "模型服务已更新")


@router.delete("/model-services/{service_id}")
async def delete_model_service(service_id: str, request: Request):
    request.app.state.commerce_service.delete_model_service(_owner(request), service_id)
    return success(None, "模型服务已移除")


@router.post("/model-services/{service_id}/discover")
async def discover_models(service_id: str, body: ModelServiceDiscoverRequest, request: Request):
    result = await request.app.state.commerce_service.discover_models(
        _owner(request), service_id, body.base_url, body.api_key
    )
    return success(result)


@router.post("/model-services/{service_id}/activate/{model_id}")
async def activate_model(service_id: str, model_id: str, request: Request):
    result = await request.app.state.commerce_service.activate_model(_owner(request), service_id, model_id)
    return success(result, "模型已切换")


@router.post("/skills/install")
async def install_skill(body: SkillInstallRequest, request: Request):
    result = await request.app.state.commerce_service.install_skill(
        _owner(request),
        body.model_name,
        body.base_url,
        body.api_key,
    )
    return success(result, "Vibe Coding 变现训练官已启动")


@router.get("/mvp-runs")
async def list_runs(request: Request):
    return success(request.app.state.mvp_service.list_runs(_owner(request)))


@router.post("/mvp-runs")
async def create_run(body: MvpRunCreateRequest, request: Request):
    result = request.app.state.mvp_service.create_run(_owner(request), body.title, body.vertical)
    return success(result, "商业 MVP 路径已创建")


@router.get("/mvp-runs/{run_id}")
async def get_run(run_id: str, request: Request):
    return success(request.app.state.mvp_service.get_run_detail(_owner(request), run_id))


@router.patch("/mvp-runs/{run_id}/steps/{step_id}")
async def patch_step(run_id: str, step_id: str, body: RunStepPatchRequest, request: Request):
    result = request.app.state.mvp_service.patch_step(_owner(request), run_id, step_id, body)
    return success(result, "节点已保存")


@router.post("/mvp-runs/{run_id}/chat")
async def chat(run_id: str, body: ChatRequest, request: Request):
    owner_id = _owner(request)
    request.app.state.mvp_service.ensure_run_available(owner_id, run_id)

    async def event_generator():
        try:
            async for chunk in request.app.state.mvp_service.stream_chat(
                owner_id,
                run_id,
                body.message,
                temperature=body.temperature,
                file_context=body.file_context,
                permission=body.permission,
            ):
                if chunk.get("type") == "reasoning":
                    yield {"event": "message", "data": json.dumps({"type": "reasoning"})}
                elif "delta" in chunk:
                    yield {"event": "message", "data": json.dumps({"delta": chunk["delta"]})}
                elif chunk.get("done"):
                    yield {"event": "done", "data": json.dumps(chunk)}
        except Exception as exc:
            yield {"event": "error", "data": json.dumps({"error": str(exc)})}

    return EventSourceResponse(event_generator())


@router.post("/mvp-runs/{run_id}/follow-up")
async def follow_up(run_id: str, body: FollowUpRequest, request: Request):
    owner_id = _owner(request)
    request.app.state.mvp_service.ensure_run_available(owner_id, run_id)
    request.app.state.runtime_metrics.inc("june_follow_up_total")
    request.app.state.runtime_metrics.inc("june_follow_up_depth_total", max(0, int(body.level or 0)))

    async def event_generator():
        try:
            async for chunk in request.app.state.mvp_service.stream_follow_up(owner_id, run_id, body):
                if chunk.get("type") == "reasoning":
                    yield {"event": "message", "data": json.dumps({"type": "reasoning"})}
                elif "delta" in chunk:
                    yield {"event": "message", "data": json.dumps({"delta": chunk["delta"]})}
                elif chunk.get("done"):
                    yield {"event": "done", "data": json.dumps(chunk)}
        except Exception as exc:
            yield {"event": "error", "data": json.dumps({"error": str(exc)})}

    return EventSourceResponse(event_generator())


@router.post("/mvp-runs/{run_id}/follow-up/adopt")
async def adopt_follow_up(run_id: str, body: AdoptFollowUpRequest, request: Request):
    result = request.app.state.mvp_service.adopt_follow_up(
        _owner(request), run_id, body.thread_id, body.title
    )
    return success(result, "追问结论已写入当前节点交付物")


@router.get("/mvp-runs/{run_id}/report")
async def report(run_id: str, request: Request):
    markdown = request.app.state.mvp_service.build_report(_owner(request), run_id)
    return Response(
        content=markdown,
        media_type="text/markdown; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="mvp-report-{run_id}.md"'},
    )
