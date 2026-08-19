"""
会话路由 —— HTTP 层，只负责：
1. 提取请求参数
2. 调用 SessionService
3. 包装响应格式（统一 Result 格式 + SSE 流）

业务逻辑全部在 SessionService 中。
"""
import json
import uuid
from pathlib import Path

from fastapi import APIRouter, Request, UploadFile, File
from sse_starlette.sse import EventSourceResponse
from pydantic import BaseModel
from ..core.response import success, not_found
from ..core.exceptions import NotFoundException
from ..models.schemas import SessionCreate, FollowUpRequest, ExplainModeRequest, ThreadRegisterRequest, ThreadPatchRequest
from ..core.config import settings

router = APIRouter()


class MessageRequest(BaseModel):
    message: str
    user_message_id: str | None = None
    assistant_message_id: str | None = None


def _get_service(request: Request):
    """从 app.state 获取 SessionService（由 main.py 注入）"""
    return request.app.state.session_service


# 文件存储根目录
UPLOADS_DIR = Path(settings.db_path).parent / "uploads"


def _file_to_dict(f) -> dict:
    return {
        "id": f.id,
        "name": f.name,
        "type": f.type,
        "size": f.size,
        "uploadedAt": int(f.uploaded_at * 1000),
    }


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
    svc.ensure_session(session_id)
    # 保存用户消息
    svc.save_user_message(session_id, body.message, body.user_message_id)
    # 获取当前会话消息列表（含刚保存的用户消息）
    messages = svc.repo.get_messages(session_id)

    async def event_generator():
        async for chunk in svc.stream_main_chat(
            session_id,
            messages,
            assistant_message_id=body.assistant_message_id or "",
        ):
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
            elif chunk.get("type") == "reasoning":
                yield {
                    "event": "message",
                    "data": json.dumps({"type": "reasoning"}),
                }

    return EventSourceResponse(event_generator())


# ---- 追问 SSE ----


@router.post("/sessions/{session_id}/threads")
async def register_thread(session_id: str, body: ThreadRegisterRequest, request: Request):
    """注册追问线程及其窗口初始状态"""
    svc = _get_service(request)
    svc.ensure_session(session_id)
    result = svc.register_thread(session_id, body)
    return success(result, "追问线程已注册")


@router.patch("/sessions/{session_id}/threads/{thread_id}")
async def update_thread(session_id: str, thread_id: str, body: ThreadPatchRequest, request: Request):
    """保存追问窗口 UI 状态、设置与关闭状态"""
    svc = _get_service(request)
    result = svc.update_thread_state(session_id, thread_id, body)
    if result is None:
        return not_found(f"追问线程 {thread_id} 不存在")
    return success(result, "追问线程状态已更新")


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
                elif chunk.get("type") == "reasoning":
                    yield {
                        "event": "message",
                        "data": json.dumps({"type": "reasoning"}),
                    }
        except Exception as e:
            yield {
                "event": "error",
                "data": json.dumps({"error": str(e)}),
            }

    return EventSourceResponse(event_generator())


# ---- 讲解模式切换 ----

@router.post("/sessions/{session_id}/explain")
async def explain_mode(session_id: str, body: ExplainModeRequest, request: Request):
    """讲解模式切换 SSE"""
    svc = _get_service(request)
    svc.ensure_session(session_id)

    async def event_generator():
        try:
            async for chunk in svc.stream_explain_mode(session_id, body):
                if "done" in chunk:
                    yield {
                        "event": "done",
                        "data": json.dumps({
                            "mode": chunk.get("mode"),
                            "mode_label": chunk.get("mode_label"),
                            "usage": chunk.get("usage", {}),
                        }),
                    }
                    return
                if "delta" in chunk:
                    yield {
                        "event": "message",
                        "data": json.dumps({"delta": chunk["delta"], "type": chunk.get("type", "text")}),
                    }
                elif chunk.get("type") == "reasoning":
                    yield {
                        "event": "message",
                        "data": json.dumps({"type": "reasoning"}),
                    }
        except Exception as e:
            yield {"event": "error", "data": json.dumps({"error": str(e)})}

    return EventSourceResponse(event_generator())


# ---- 文件上传 ----

def _detect_type(filename: str) -> str:
    ext = (filename or "").split(".")[-1].lower()
    type_map = {
        "pdf": "pdf", "docx": "docx", "doc": "docx",
        "pptx": "pptx", "ppt": "pptx",
        "txt": "txt", "md": "md",
        "png": "image", "jpg": "image", "jpeg": "image", "webp": "image", "gif": "image",
    }
    return type_map.get(ext, "txt")


@router.post("/sessions/{session_id}/files")
async def upload_file(session_id: str, request: Request, file: UploadFile = File(...)):
    """上传文件到会话"""
    svc = _get_service(request)
    svc.ensure_session(session_id)

    # 确保上传目录存在
    session_dir = UPLOADS_DIR / session_id
    session_dir.mkdir(parents=True, exist_ok=True)

    # 读取文件内容
    content = await file.read()
    size = len(content)
    file_type = _detect_type(file.filename)

    # 用 uuid 生成磁盘文件名，避免冲突
    file_id = str(uuid.uuid4())
    safe_name = (file.filename or "unnamed").replace("/", "_").replace("\\", "_")
    stored_path = session_dir / f"{file_id}_{safe_name}"
    stored_path.write_bytes(content)

    # 存入数据库
    file_model = svc.repo.add_file(
        session_id=session_id,
        name=file.filename or "unnamed",
        file_type=file_type,
        size=size,
        stored_path=str(stored_path),
    )

    return success(_file_to_dict(file_model), "文件上传成功")


@router.get("/sessions/{session_id}/files")
async def list_files(session_id: str, request: Request):
    """获取会话下所有文件"""
    svc = _get_service(request)
    files = svc.repo.get_files(session_id)
    return success([_file_to_dict(f) for f in files])


@router.delete("/sessions/{session_id}/files/{file_id}")
async def delete_file(session_id: str, file_id: str, request: Request):
    """删除文件"""
    svc = _get_service(request)
    deleted = svc.repo.delete_file(file_id)
    if deleted is None:
        return not_found(f"文件 {file_id} 不存在")
    # 删除磁盘文件
    try:
        path = Path(deleted.stored_path)
        if path.exists():
            path.unlink()
    except Exception:
        pass
    return success(None, "文件已删除")


@router.get("/sessions/{session_id}/files/{file_id}/content")
async def get_file_content(session_id: str, file_id: str, request: Request):
    """获取文件内容（文本类返回文本，二进制类返回文件信息）"""
    svc = _get_service(request)
    f = svc.repo.find_file(file_id)
    if f is None:
        return not_found(f"文件 {file_id} 不存在")
    path = Path(f.stored_path)
    if not path.exists():
        return not_found(f"文件 {f.name} 在磁盘上不存在")
    if f.type in ("txt", "md"):
        text = path.read_text(encoding="utf-8")
        return success({"content": text, "name": f.name, "type": f.type})
    # 非文本文件返回元信息
    return success({"content": None, "name": f.name, "type": f.type, "size": f.size, "note": "二进制文件，请通过下载获取"})
