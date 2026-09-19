"""Vibe Coding 变现训练官商业链路 API 合同测试。"""

import asyncio
import json

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sse_starlette.sse import EventSourceResponse

from app.core.security import SingleUserMiddleware
from app.core.exceptions import JuneException
from app.models.database import Base
from app.models.schemas import FollowUpRequest
from app.repositories.commerce_repo import CommerceRepository
from app.repositories.session_repo import SessionRepository
from app.routes.commerce import router as commerce_router
from app.services.commerce_service import CommerceService
from app.services.mvp_service import MvpService


class FakeLLM:
    def __init__(self):
        self.chat_calls = []
        self.connection_result = {"ok": True, "model": "fake-model"}

    def get_api_key(self):
        return ""

    def set_model(self, model, base_url=""):
        pass

    def set_api_key(self, key):
        pass

    async def test_connection(self, model="", base_url="", api_key=""):
        return self.connection_result

    async def chat(self, messages, api_key="", model="", base_url="", temperature=0.7):
        self.chat_calls.append({
            "messages": messages,
            "api_key": api_key,
            "model": model,
            "base_url": base_url,
        })
        yield "先完成付费人群筛选，并把结果整理成可售卖的商业目标。"
        yield "<tracking>{\"blocker\":\"人群还不够窄\",\"next_action\":\"先列出10个具体客户\",\"vertical\":\"本地实体商家\",\"artifacts\":[]}</tracking>"


def make_client(tmp_path):
    engine = create_engine(
        f"sqlite:///{tmp_path / 'commerce.db'}",
        connect_args={"check_same_thread": False},
    )
    Base.metadata.create_all(engine)
    db = Session(engine)
    repo = CommerceRepository(db)
    llm = FakeLLM()

    app = FastAPI()
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:5173"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.add_middleware(SingleUserMiddleware)
    app.add_exception_handler(JuneException, lambda request, exc: JSONResponse(
        status_code=exc.code,
        content={"code": exc.code, "message": exc.message, "data": exc.data},
    ))
    app.include_router(commerce_router, prefix="/api")
    app.state.commerce_repo = repo
    app.state.commerce_service = CommerceService(repo, llm)
    app.state.mvp_service = MvpService(repo, SessionRepository(db), llm, None)
    return TestClient(app), db, engine, llm


def test_model_services_crud_and_concurrent_version(tmp_path):
    client, db, engine, _ = make_client(tmp_path)
    try:
        listed = client.get("/api/model-services")
        assert listed.status_code == 200
        services = listed.json()["data"]
        assert len(services) == 5
        assert all("encrypted_api_key" not in json.dumps(service) for service in services)

        deepseek = next(service for service in services if service["id"] == "deepseek")
        payload = {
            "id": deepseek["id"],
            "display_name": "DeepSeek Gateway",
            "vendor": "DeepSeek",
            "base_url": "https://api.deepseek.com/v1",
            "protocol": "openai-compatible",
            "api_key": "sk-new",
            "version": deepseek["version"],
            "models": [{
                "id": "",
                "model_id": "deepseek-chat",
                "display_name": "DeepSeek Chat",
                "context_tokens": 128000,
                "max_output_tokens": 8192,
                "reasoning": "medium",
            }],
        }
        updated = client.put(f"/api/model-services/{deepseek['id']}", json=payload)
        assert updated.status_code == 200
        assert updated.json()["data"]["apiKeyReady"] is True
        assert updated.json()["data"]["version"] == deepseek["version"] + 1

        stale = client.put(
            f"/api/model-services/{deepseek['id']}",
            json={**payload, "display_name": "Stale"},
        )
        assert stale.status_code == 400
        assert "刷新后重试" in stale.json()["message"]

        custom = {
            "id": "private-gateway",
            "display_name": "Private Gateway",
            "vendor": "Self-hosted",
            "base_url": "https://api.openai.com/custom",
            "protocol": "custom",
            "api_key": "sk-private",
            "version": 0,
            "models": [{
                "id": "",
                "model_id": "private-large",
                "display_name": "Private Large",
                "context_tokens": 1000000,
                "max_output_tokens": 16384,
                "reasoning": "high",
            }],
        }
        created = client.post("/api/model-services", json=custom)
        assert created.status_code == 200
        conflict = client.post("/api/model-services", json=custom)
        assert conflict.status_code == 400

        deleted = client.delete("/api/model-services/private-gateway")
        assert deleted.status_code == 200
    finally:
        db.close()
        engine.dispose()


def test_cors_preflight_bypasses_user_token_auth(tmp_path):
    client, db, engine, _ = make_client(tmp_path)
    try:
        response = client.options(
            "/api/coach/status",
            headers={
                "Origin": "http://localhost:5173",
                "Access-Control-Request-Method": "GET",
                "Access-Control-Request-Headers": "authorization,content-type",
                # Browsers send the header before the actual token is evaluated.
                "Authorization": "Bearer invalid-token",
            },
        )
        assert response.status_code == 200
        assert response.headers["access-control-allow-origin"] == "http://localhost:5173"
        assert "access-control-allow-headers" in response.headers
    finally:
        db.close()
        engine.dispose()


def test_free_user_can_install_without_payment(tmp_path):
    client, db, engine, _ = make_client(tmp_path)
    try:
        response = client.post("/api/coach/start", json={
            "model_name": "glm-5.2",
            "base_url": "https://open.bigmodel.cn/api/paas/v4",
            "api_key": "sk-byok",
        })
        assert response.status_code == 200
        assert response.json()["data"]["status"]["paid"] is True
    finally:
        db.close()
        engine.dispose()


def test_install_failure_returns_sanitized_reason(tmp_path):
    client, db, engine, llm = make_client(tmp_path)
    try:
        llm.connection_result = {
            "ok": False,
            "error": "AI 工具账户余额不足，请先充值后再连接。",
            "http_status": 402,
        }
        response = client.post("/api/coach/start", json={
            "model_name": "deepseek-chat",
            "base_url": "https://api.deepseek.com/v1",
            "api_key": "sk-byok",
        })
        assert response.status_code == 400
        assert "AI 工具账户余额不足" in response.json()["message"]
        assert "sk-byok" not in response.text
    finally:
        db.close()
        engine.dispose()


def test_install_autorun_and_reuses_skill(tmp_path):
    client, db, engine, _ = make_client(tmp_path)
    try:

        installed = client.post("/api/coach/start", json={
            "model_name": "glm-5.2",
            "base_url": "https://open.bigmodel.cn/api/paas/v4",
            "api_key": "sk-byok",
        })
        assert installed.status_code == 200
        installed_data = installed.json()["data"]
        assert installed_data["run"]["currentStepOrder"] == 1
        assert "encrypted_api_key" not in json.dumps(installed_data)
        assert "sk-byok" not in json.dumps(installed_data)

        restarted = client.post("/api/coach/start", json={
            "model_name": "glm-5.2",
            "base_url": "https://open.bigmodel.cn/api/paas/v4",
        })
        assert restarted.status_code == 200
        assert restarted.json()["data"]["status"]["apiKeyReady"] is True
        assert restarted.json()["data"]["run"]["id"] == installed_data["run"]["id"]

        detail = client.get(
            f"/api/mvp-runs/{installed_data['run']['id']}",
        )
        assert detail.status_code == 200
        run = detail.json()["data"]
        assert len(run["steps"]) == 10
        assert [step["title"] for step in run["steps"]] == [
            "选择愿意付费的人群和痛点",
            "定义一个最小可售卖结果",
            "写出 Vibe Coding 商业需求简报",
            "选择最小产品形态",
            "用自然语言让 AI 生成第一版 MVP",
            "用 5 分钟迭代法改到可试用",
            "制作报价、收款方式和交付说明",
            "准备获客素材和首批 20 个潜在客户",
            "发起首次销售并完成一次最小交付",
            "复盘转化、交付和下一轮迭代",
        ]
        assert run["messages"][0]["role"] == "assistant"
        assert "5 个问题" in run["messages"][0]["content"]
        assert "怎么收款" in run["messages"][0]["content"]

        report = client.get(
            f"/api/mvp-runs/{run['id']}/report",
        ).content.decode("utf-8")
        visible_content = json.dumps(run, ensure_ascii=False) + report
        for forbidden in ["API", "Base URL", "模型调用", "框架", "代码结构", "Prompt", "CORS"]:
            assert forbidden not in visible_content
    finally:
        db.close()
        engine.dispose()


def test_completion_locks_first_path_and_second_path_remains_active(tmp_path):
    client, db, engine, _ = make_client(tmp_path)
    try:
        installed = client.post("/api/coach/start", json={
            "model_name": "glm-5.2",
            "base_url": "https://open.bigmodel.cn/api/paas/v4",
            "api_key": "sk-byok",
        }).json()["data"]
        run_id = installed["run"]["id"]

        detail = client.get(f"/api/mvp-runs/{run_id}").json()["data"]
        skipped = client.patch(
            f"/api/mvp-runs/{run_id}/steps/{detail['steps'][1]['id']}",
            json={"artifact_title": "跳过", "artifact_content": "x" * 30, "completed": True},
        )
        assert skipped.status_code == 400
        assert "按顺序" in skipped.json()["message"]

        for step in detail["steps"]:
            response = client.patch(
                f"/api/mvp-runs/{run_id}/steps/{step['id']}",
                json={
                    "artifact_title": step["requiredArtifact"],
                    "artifact_content": f"{step['title']}的客观交付记录，包含具体动作和结果。",
                    "completed": True,
                },
            )
            assert response.status_code == 200

        locked_detail = client.get(f"/api/mvp-runs/{run_id}").json()["data"]
        assert locked_detail["status"] == "completed"
        assert locked_detail["completedAt"] is not None

        chat = client.post(f"/api/mvp-runs/{run_id}/chat", json={
            "message": "我还没完成产品打造，请继续",
        })
        assert chat.status_code == 403

        follow_up = client.post(f"/api/mvp-runs/{run_id}/follow-up", json={
            "session_id": run_id,
            "parent_thread_id": "main",
            "thread_id": "f1",
            "level": 1,
            "source": {
                "type": "text",
                "selected_text": "",
                "source_message_id": "m1",
                "source_message_role": "assistant",
            },
            "query": "继续补课",
        })
        assert follow_up.status_code == 403

        first_step = locked_detail["steps"][0]
        patch = client.patch(
            f"/api/mvp-runs/{run_id}/steps/{first_step['id']}",
            json={"artifact_title": "重写", "artifact_content": "x" * 30, "completed": True},
        )
        assert patch.status_code == 403

        report = client.get(f"/api/mvp-runs/{run_id}/report")
        assert report.status_code == 200
        assert "全部节点已完成，本路径已锁定" in response_text(report)

        second = client.post("/api/mvp-runs", json={
            "title": "第二个 MVP",
            "vertical": "跨境电商",
        })
        assert second.status_code == 200
        assert second.json()["data"]["status"] == "active"
    finally:
        db.close()
        engine.dispose()


def test_tracking_metadata_is_hidden_and_updates_project(tmp_path):
    client, db, engine, llm = make_client(tmp_path)
    try:
        installed = client.post("/api/coach/start", json={
            "model_name": "glm-5.2",
            "base_url": "https://open.bigmodel.cn/api/paas/v4",
            "api_key": "sk-byok",
        }).json()["data"]
        run_id = installed["run"]["id"]

        chat = client.post(f"/api/mvp-runs/{run_id}/chat", json={
            "message": "我想服务本地实体商家",
        })
        assert chat.status_code == 200
        assert "<tracking>" not in chat.text

        detail = client.get(f"/api/mvp-runs/{run_id}").json()["data"]
        assert detail["blocker"] == "人群还不够窄"
        assert detail["nextAction"] == "先列出10个具体客户"
        assert detail["vertical"] == "本地实体商家"
        assert "<tracking>" not in json.dumps(detail["messages"])
        assert llm.chat_calls[0]["api_key"] == "sk-byok"
        assert llm.chat_calls[0]["model"] == "glm-5.2"

    finally:
        db.close()
        engine.dispose()


def test_follow_up_hides_tracking_metadata(tmp_path):
    client, db, engine, _ = make_client(tmp_path)
    try:
        installed = client.post("/api/coach/start", json={
            "model_name": "glm-5.2",
            "base_url": "https://open.bigmodel.cn/api/paas/v4",
            "api_key": "sk-byok",
        }).json()["data"]
        run_id = installed["run"]["id"]

        async def consume_follow_up():
            body = FollowUpRequest(
                session_id=run_id,
                parent_thread_id="main",
                thread_id="follow-1",
                level=1,
                source={
                    "type": "text",
                    "selected_text": "",
                    "source_message_id": "m1",
                    "source_message_role": "assistant",
                },
                query="什么是垂直人群？",
            )
            return [item async for item in client.app.state.mvp_service.stream_follow_up("local", run_id, body)]

        events = asyncio.run(consume_follow_up())
        assert "<tracking>" not in json.dumps(events)
        refreshed = client.get(f"/api/mvp-runs/{run_id}").json()["data"]
        assert "<tracking>" not in json.dumps(refreshed["threadMessages"])
    finally:
        db.close()
        engine.dispose()


def response_text(response):
    return response.content.decode("utf-8")
