from pydantic import BaseModel
from typing import List, Optional, Literal




class SessionCreate(BaseModel):
    title: Optional[str] = "新对话"


class SessionResponse(BaseModel):
    id: str
    title: str
    createdAt: int
    model: str = "deepseek-v4-pro"


class ChatRequest(BaseModel):
    message: str


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


class FileUploadRequest(BaseModel):
    name: str
    type: str
    size: int
