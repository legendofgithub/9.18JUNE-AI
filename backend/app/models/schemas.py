from pydantic import BaseModel, Field
from typing import List, Optional, Literal

from ..core.config import settings



class SessionCreate(BaseModel):
    title: Optional[str] = "新对话"


class SessionResponse(BaseModel):
    id: str
    title: str
    createdAt: int
    model: str = Field(default_factory=lambda: settings.llm_default_model)


class ChatRequest(BaseModel):
    message: str


class ExplainModeRequest(BaseModel):
    """讲解模式切换请求"""
    session_id: str
    message_id: str
    original_content: str
    mode: Literal["simple", "standard", "advanced"] = "standard"
    context: Optional[List[dict]] = None


class KnowledgeRef(BaseModel):
    fileName: str
    page: Optional[int] = None
    snippet: str


class SourceInfo(BaseModel):
    type: Literal['text']
    selected_text: Optional[str] = None
    source_message_id: str
    source_message_role: Literal['user', 'assistant'] = 'assistant'


class ContextInfo(BaseModel):
    main_thread_messages: List[dict] = []
    parent_thread_messages: List[dict] = []
    knowledge_refs: Optional[List[KnowledgeRef]] = None


class FollowUpRequest(BaseModel):
    session_id: str
    parent_thread_id: str
    thread_id: str
    level: int
    source: SourceInfo
    query: str
    context: ContextInfo = ContextInfo()
    temperature: Optional[float] = None
    verbosity: Optional[Literal['detailed', 'concise']] = None
    user_message_id: Optional[str] = None
    assistant_message_id: Optional[str] = None


class ThreadRegisterRequest(BaseModel):
    """打开追问窗时注册 harness 线程"""
    parent_thread_id: str
    thread_id: str
    level: int
    source: SourceInfo
    position: Optional[dict] = None
    size: Optional[dict] = None
    zIndex: int = 1000


class ThreadPatchRequest(BaseModel):
    """保存追问窗口 UI 状态与设置"""
    position: Optional[dict] = None
    size: Optional[dict] = None
    is_minimized: Optional[bool] = None
    z_index: Optional[int] = None
    settings: Optional[dict] = None
    is_closed: Optional[bool] = None


class FileUploadRequest(BaseModel):
    name: str
    type: str
    size: int
