from pydantic import BaseModel, Field


class RegisterRequest(BaseModel):
    email: str = Field(min_length=5, max_length=255)
    password: str = Field(min_length=8, max_length=128)
    display_name: str = Field(default="", max_length=80)


class LoginRequest(BaseModel):
    account: str
    password: str


class OrderCreateRequest(BaseModel):
    product_id: str


class OrderConfirmRequest(BaseModel):
    provider_transaction_id: str
    signature: str | None = None


class SkillInstallRequest(BaseModel):
    model_name: str
    base_url: str
    api_key: str


class CoachStartRequest(BaseModel):
    model_name: str = ""
    base_url: str = ""
    api_key: str = ""


class ModelEntryPayload(BaseModel):
    id: str = ""
    model_id: str = Field(min_length=1, max_length=160)
    display_name: str = Field(default="", max_length=160)
    context_tokens: int = Field(default=128000, ge=1000, le=10_000_000)
    max_output_tokens: int = Field(default=4096, ge=1, le=1_000_000)
    reasoning: str = Field(default="medium", pattern="^(low|medium|high)$")


class ModelServicePayload(BaseModel):
    id: str = Field(default="", min_length=0, max_length=60, pattern=r"^[a-z0-9][a-z0-9_-]*$")
    display_name: str = Field(min_length=1, max_length=120)
    vendor: str = Field(default="", max_length=80)
    base_url: str = Field(min_length=1, max_length=500)
    protocol: str = Field(default="openai-compatible", pattern="^(openai-compatible|native|custom)$")
    api_key: str = ""
    version: int
    models: list[ModelEntryPayload] = Field(min_length=1)


class ModelServiceDiscoverRequest(BaseModel):
    base_url: str
    api_key: str = ""


class MvpRunCreateRequest(BaseModel):
    title: str = Field(default="未命名 MVP", max_length=200)
    vertical: str = Field(default="", max_length=200)


class RunStepPatchRequest(BaseModel):
    artifact_title: str = Field(default="", max_length=200)
    artifact_content: str = Field(default="", max_length=20000)
    completed: bool
