import json
from urllib.parse import quote

from fastapi import APIRouter, Request, Response
from sse_starlette.sse import EventSourceResponse

from ..core.exceptions import UnauthorizedException
from ..core.response import success
from ..core.security import get_client_ip
from ..models.harness_schemas import (
    AgentRunRequest,
    DocumentPayload,
    HarnessFileUpload,
    HarnessMigrationRequest,
    HarnessProjectCreate,
    HarnessProjectPatch,
    HarnessSessionCreate,
    HarnessSessionPatch,
    MemoryPayload,
    ToolApprovalRequest,
)


router = APIRouter(tags=["harness"])


def _owner(request: Request) -> str:
    owner_id = getattr(request.state, "owner_id", None)
    if not owner_id:
        raise UnauthorizedException("请先登录后再使用 Harness 工作区")
    request.app.state.auth_service.assert_user_active(owner_id)
    return owner_id


def _actor(request: Request) -> dict:
    return {
        "account": getattr(request.state, "owner_account", ""),
        "ip": get_client_ip(request),
        "userAgent": request.headers.get("user-agent", "")[:300],
    }


def _is_admin(request: Request, owner_id: str) -> bool:
    user = request.app.state.commerce_repo.get_user_by_id(owner_id)
    return bool(user and user.is_admin)


@router.get("/harness/projects")
async def list_projects(request: Request):
    return success(request.app.state.agent_service.list_projects(_owner(request)))


@router.post("/harness/projects")
async def create_project(body: HarnessProjectCreate, request: Request):
    return success(request.app.state.agent_service.create_project(
        _owner(request), body.title, body.mvp_run_id, body.metadata,
    ), "Harness 项目已创建")


@router.post("/harness/projects/migrate")
async def migrate_projects(body: HarnessMigrationRequest, request: Request):
    result = request.app.state.agent_service.migrate_projects(
        _owner(request), [project.model_dump() for project in body.projects]
    )
    return success(result, "本地项目已迁移")


@router.patch("/harness/projects/{project_id}")
async def update_project(project_id: str, body: HarnessProjectPatch, request: Request):
    return success(request.app.state.agent_service.update_project(
        _owner(request), project_id, body.title, body.metadata,
    ))


@router.delete("/harness/projects/{project_id}")
async def delete_project(project_id: str, request: Request):
    request.app.state.agent_service.delete_project(_owner(request), project_id)
    return success(None, "Harness 项目已删除")


@router.post("/harness/projects/{project_id}/sessions")
async def create_session(project_id: str, body: HarnessSessionCreate, request: Request):
    return success(request.app.state.agent_service.create_session(_owner(request), project_id, body.title))


@router.patch("/harness/sessions/{session_id}")
async def update_session(session_id: str, body: HarnessSessionPatch, request: Request):
    return success(request.app.state.agent_service.update_session(
        _owner(request), session_id, body.title, body.permission,
    ))


@router.delete("/harness/sessions/{session_id}")
async def delete_session(session_id: str, request: Request):
    request.app.state.agent_service.delete_session(_owner(request), session_id)
    return success(None, "会话已删除")


@router.post("/harness/sessions/{session_id}/files")
async def upload_files(session_id: str, body: HarnessFileUpload, request: Request):
    return success(request.app.state.agent_service.upload_files(
        _owner(request), session_id, [item.model_dump() for item in body.files],
    ), "项目文件快照已上传")


@router.get("/harness/sessions/{session_id}/files")
async def list_files(session_id: str, request: Request):
    return success(request.app.state.agent_service.list_files(_owner(request), session_id))


@router.get("/harness/sessions/{session_id}/context")
async def get_context(session_id: str, request: Request):
    owner_id = _owner(request)
    return success(request.app.state.agent_service.get_context(
        owner_id, session_id, include_debug=_is_admin(request, owner_id),
    ))


@router.post("/harness/sessions/{session_id}/context/compress")
async def compress_context(session_id: str, request: Request):
    return success(request.app.state.agent_service.compress_context(_owner(request), session_id))


@router.get("/harness/sessions/{session_id}/memories")
async def list_memories(session_id: str, request: Request):
    return success(request.app.state.agent_service.list_memories(_owner(request), session_id))


@router.post("/harness/sessions/{session_id}/memories")
async def create_memory(session_id: str, body: MemoryPayload, request: Request):
    return success(request.app.state.agent_service.add_memory(
        _owner(request), session_id, body.memory_type, body.content,
    ))


@router.delete("/harness/memories/{memory_id}")
async def delete_memory(memory_id: str, request: Request):
    request.app.state.agent_service.delete_memory(_owner(request), memory_id)
    return success(None, "项目记忆已删除")


@router.get("/harness/sessions/{session_id}/documents")
async def list_documents(session_id: str, request: Request):
    return success(request.app.state.agent_service.list_documents(_owner(request), session_id))


@router.post("/harness/sessions/{session_id}/documents")
async def create_document(session_id: str, body: DocumentPayload, request: Request):
    return success(request.app.state.agent_service.add_document(
        _owner(request), session_id, body.title, body.content,
    ))


@router.get("/harness/documents/{document_id}/download")
async def download_document(document_id: str, request: Request):
    title, content = request.app.state.agent_service.get_document_content(_owner(request), document_id)
    filename = quote(f"{title}.md")
    return Response(
        content=content,
        media_type="text/markdown; charset=utf-8",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{filename}"},
    )


@router.delete("/harness/documents/{document_id}")
async def delete_document(document_id: str, request: Request):
    request.app.state.agent_service.delete_document(_owner(request), document_id)
    return success(None, "项目文档已删除")


@router.post("/harness/sessions/{session_id}/run")
async def run_agent(session_id: str, body: AgentRunRequest, request: Request):
    owner_id = _owner(request)
    service = request.app.state.agent_service

    async def events():
        try:
            async for event in service.run(
                owner_id,
                session_id,
                body.message,
                body.temperature,
                body.permission,
            ):
                event_name = "run.end" if event.get("type") == "done" else event.get("type", "message")
                yield {
                    "event": event_name,
                    "data": json.dumps(event, ensure_ascii=False, separators=(",", ":")),
                }
        except Exception as exc:
            yield {"event": "error", "data": json.dumps({"type": "error", "error": str(exc)}, ensure_ascii=False)}

    return EventSourceResponse(events())


@router.post("/harness/agent-runs/{agent_run_id}/resume")
async def resume_agent(agent_run_id: str, request: Request):
    owner_id = _owner(request)
    service = request.app.state.agent_service

    async def events():
        try:
            async for event in service.resume(owner_id, agent_run_id):
                event_name = "run.end" if event.get("type") == "done" else event.get("type", "message")
                yield {
                    "event": event_name,
                    "data": json.dumps(event, ensure_ascii=False, separators=(",", ":")),
                }
        except Exception as exc:
            yield {"event": "error", "data": json.dumps({"type": "error", "error": str(exc)}, ensure_ascii=False)}

    return EventSourceResponse(events())


@router.post("/harness/agent-runs/{agent_run_id}/cancel")
async def cancel_agent(agent_run_id: str, request: Request):
    return success(request.app.state.agent_service.cancel(
        _owner(request), agent_run_id, _actor(request),
    ))


@router.post("/harness/agent-runs/{agent_run_id}/approval")
async def decide_approval(agent_run_id: str, body: ToolApprovalRequest, request: Request):
    return success(request.app.state.agent_service.decide_approval(
        _owner(request), agent_run_id, body.tool_call_id, body.approved, _actor(request),
    ))


@router.get("/harness/agent-runs/{agent_run_id}")
async def agent_trace(agent_run_id: str, request: Request):
    return success(request.app.state.agent_service.agent_trace(_owner(request), agent_run_id))
