"""
会话路由 —— HTTP 层，只负责：
1. 提取请求参数
2. 调用 SessionService
3. 包装响应格式（统一 Result 格式 + SSE 流）

业务逻辑全部在 SessionService 中。
"""
import json
from fastapi import APIRouter, Request
from sse_starlette.sse import EventSourceResponse
from pydantic import BaseModel
from ..core.response import success, not_found
from ..core.exceptions import NotFoundException
from ..models.schemas import SessionCreate, FollowUpRequest

router = APIRouter()


class MessageRequest(BaseModel):
    message: str


def _get_service(request: Request):
    """从 app.state 获取 SessionService（由 main.py 注入）"""
    return request.app.state.session_service


# ---- 会话 CRUD ----

@router.post("/sessions")
async def create_session(body: SessionCreate = SessionCreate(), request: Request = None):
    """创建新会话"""
    svc = _get_service(request)
    result = svc.create_session(title=body.title or "新对话")
    return success(result, "会话创建成功")


@router.get("/sessions/{session_id}")
async def get_session(session_id: str, request: Request):
    """获取会话详情"""
    svc = _get_service(request)
    try:
        result = svc.get_session(session_id)
        return success(result)
    except NotFoundException as e:
        return not_found(e.message)


@router.get("/sessions")
async def list_sessions(request: Request):
    """获取所有会话列表"""
    svc = _get_service(request)
    result = svc.list_sessions()
    return success(result)


@router.delete("/sessions/{session_id}")
async def delete_session(session_id: str, request: Request):
    """删除会话"""
    svc = _get_service(request)
    deleted = svc.delete_session(session_id)
    if not deleted:
        return not_found(f"会话 {session_id} 不存在")
    return success(None, "会话已删除")


# ---- 主对话 SSE ----

@router.post("/sessions/{session_id}/chat")
async def chat(session_id: str, body: MessageRequest, request: Request):
    """主对话 —— SSE 流式返回"""
    svc = _get_service(request)

    # 确保会话存在
    session = svc.ensure_session(session_id)
    # 保存用户消息
    svc.save_user_message(session_id, body.message)
    # 获取当前会话消息列表（含刚保存的用户消息）
    messages = svc.repo.get_messages(session_id)

    async def event_generator():
        async for chunk in svc.stream_main_chat(session_id, messages):
            if "done" in chunk:
                yield {
                    "event": "done",
                    "data": json.dumps({"thread_id": chunk.get("thread_id"), "usage": chunk.get("usage", {})}),
                }
            elif "delta" in chunk:
                yield {
                    "event": "message",
                    "data": json.dumps({"delta": chunk["delta"], "type": chunk.get("type", "text")}),
                }

    return EventSourceResponse(event_generator())


# ---- 追问 SSE ----

@router.post("/sessions/{session_id}/follow-up")
async def follow_up(session_id: str, body: FollowUpRequest, request: Request):
    """追问 —— SSE 流式返回"""
    svc = _get_service(request)
    svc.ensure_session(session_id)

    async def event_generator():
        try:
            async for chunk in svc.stream_follow_up(session_id, body):
                if "done" in chunk:
                    yield {
                        "event": "done",
                        "data": json.dumps({"thread_id": chunk.get("thread_id"), "usage": chunk.get("usage", {})}),
                    }
                    return
                if "delta" in chunk:
                    yield {
                        "event": "message",
                        "data": json.dumps({"delta": chunk["delta"], "type": chunk.get("type", "text")}),
                    }
        except Exception as e:
            yield {
                "event": "error",
                "data": json.dumps({"error": str(e)}),
            }

    return EventSourceResponse(event_generator())


# ---- 文件上传（简化版） ----

@router.post("/sessions/{session_id}/files")
async def upload_file(session_id: str, request: Request):
    svc = _get_service(request)
    svc.ensure_session(session_id)
    return success({
        "id": "placeholder",
        "name": "file.pdf",
        "type": "pdf",
        "size": 0,
        "uploadedAt": int(__import__("time").time() * 1000),
    })


@router.get("/sessions/{session_id}/files")
async def list_files(session_id: str, request: Request):
    return success([])


@router.delete("/sessions/{session_id}/files/{file_id}")
async def delete_file(session_id: str, file_id: str):
    return success(None, "文件已删除")


@router.get("/sessions/{session_id}/files/{file_id}/content")
async def get_file_content(session_id: str, file_id: str):
    return success({"content": "File content placeholder"})
