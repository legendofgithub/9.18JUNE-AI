from typing import Literal

from pydantic import BaseModel, Field


Permission = Literal["read-only", "workspace-write", "full-access"]


class HarnessProjectCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    mvp_run_id: str | None = None
    metadata: dict[str, str] = Field(default_factory=dict)


class HarnessProjectPatch(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    metadata: dict[str, str] | None = None


class HarnessSessionCreate(BaseModel):
    title: str = Field(default="会话 1", min_length=1, max_length=200)


class HarnessSessionPatch(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    permission: Permission | None = None


class HarnessFilePayload(BaseModel):
    path: str = Field(min_length=1, max_length=500)
    name: str = Field(default="", max_length=255)
    mime_type: str = Field(default="text/plain", max_length=120)
    content: str = Field(max_length=10 * 1024 * 1024)


class HarnessFileUpload(BaseModel):
    files: list[HarnessFilePayload] = Field(min_length=1, max_length=200)


class MemoryPayload(BaseModel):
    memory_type: Literal["preference", "summary", "fact", "lesson", "todo"] = "fact"
    content: str = Field(min_length=1, max_length=10000)


class DocumentPayload(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    content: str = Field(min_length=1, max_length=200000)


class AgentRunRequest(BaseModel):
    session_id: str
    message: str = Field(min_length=1, max_length=12000)
    temperature: float = Field(default=0.55, ge=0.0, le=2.0)
    permission: Permission = "read-only"


class ToolApprovalRequest(BaseModel):
    approved: bool
    tool_call_id: str = Field(min_length=1, max_length=36)


class HarnessMigrationSession(BaseModel):
    title: str = Field(default="迁移会话", max_length=200)
    messages: list[dict[str, object]] = Field(default_factory=list, max_length=1000)


class HarnessMigrationProject(BaseModel):
    title: str = Field(default="迁移项目", max_length=200)
    folderName: str = Field(default="", max_length=255)
    sessions: list[HarnessMigrationSession] = Field(default_factory=list, max_length=100)


class HarnessMigrationRequest(BaseModel):
    projects: list[HarnessMigrationProject] = Field(min_length=0, max_length=100)
