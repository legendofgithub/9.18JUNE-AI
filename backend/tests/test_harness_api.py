import json
import os
import asyncio
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sse_starlette.sse import AppStatus

from app.core.exceptions import JuneException
from app.core.security import SingleUserMiddleware
from app.models.database import Base
from app.models.database import ToolCallModel
from app.repositories.commerce_repo import CommerceRepository
from app.repositories.harness_repo import HarnessRepository
from app.repositories.session_repo import SessionRepository
from app.routes.commerce import router as commerce_router
from app.routes.harness import router as harness_router
from app.services.agent_service import AgentService
from app.services.commerce_service import CommerceService
from app.services.mvp_service import MvpService


class FakeToolLLM:
    def __init__(self):
        self.calls = 0

    def get_api_key(self):
        return ""

    async def chat(self, messages, api_key="", model="", base_url="", temperature=0.7, tools=None):
        self.calls += 1
        if self.calls == 1:
            yield {
                "type": "tool_calls",
                "tool_calls": [{
                    "id": "call_write",
                    "type": "function",
                    "function": {
                        "name": "write_file",
                        "arguments": json.dumps({
                            "path": "deliverables/offer.md",
                            "content": "# 报价\n- MVP 指令整理：3000 元\n",
                        }),
                    },
                }],
            }
        else:
            yield "已生成报价文档，并写入项目沙箱。"


def make_client(tmp_path):
    engine = create_engine(
        f"sqlite:///{tmp_path / 'harness.db'}",
        connect_args={"check_same_thread": False},
    )
    Base.metadata.create_all(engine)
    db = Session(engine)
    commerce = CommerceRepository(db)
    harness = HarnessRepository(db)
    llm = FakeToolLLM()

    app = FastAPI()
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:5173"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.add_middleware(SingleUserMiddleware)
    app.add_exception_handler(JuneException, lambda request, exc: __import__("fastapi").responses.JSONResponse(
        status_code=exc.code,
        content={"code": exc.code, "message": exc.message, "data": exc.data},
    ))
    app.include_router(commerce_router, prefix="/api")
    app.include_router(harness_router, prefix="/api")
    app.state.commerce_repo = commerce
    app.state.commerce_service = CommerceService(commerce, llm)
    app.state.mvp_service = MvpService(commerce, SessionRepository(db), llm, None)
    app.state.agent_service = AgentService(
        harness,
        commerce,
        llm,
        tmp_path / "workspace",
        None,
    )
    return TestClient(app), db, engine, commerce, harness, llm, tmp_path / "workspace"


LOCAL = "local"


def activate_paid_user(commerce, user):
    # 单用户模式下仅保留「安装技能」语义，helper 名保留以减少改动面
    commerce.install_skill(
        LOCAL,
        "fake-model",
        "https://model.example.com/v1",
        True,
        "",
    )


def create_active_run(commerce, user):
    skill = commerce.find_installed_skill(LOCAL)
    return commerce.create_run(LOCAL, skill, "Harness 商业项目", "本地商家")


def parse_sse(text):
    events = []
    current = None
    for line in text.splitlines():
        if line.startswith("event:"):
            current = line[6:].strip()
        elif line.startswith("data:"):
            raw = line[5:].strip()
            if raw:
                events.append((current, json.loads(raw)))
    return events


def test_agent_write_requires_approval_then_resumes_and_persists(tmp_path):
    client, db, engine, commerce, harness, llm, workspace = make_client(tmp_path)
    try:
        AppStatus.should_exit_event = asyncio.Event()
        activate_paid_user(commerce, {"id": "local"})
        mvp_run = create_active_run(commerce, {"id": "local"})
        project = client.post("/api/harness/projects", json={
            "title": "报价项目",
            "mvp_run_id": mvp_run.id,
        }).json()["data"]
        session = project["sessions"][0]
        assert client.patch(
            f"/api/harness/sessions/{session['id']}",
            json={"permission": "workspace-write"},
        ).status_code == 200

        response = client.post(
            f"/api/harness/sessions/{session['id']}/run",
            json={"session_id": session["id"], "message": "生成报价文档", "permission": "workspace-write"},
        )
        assert response.status_code == 200
        events = parse_sse(response.text)
        assert any(event == "tool.start" for event, _ in events)
        approval_event = next(payload for event, payload in events if event == "approval.required")
        agent_run_id = next(
            payload["toolCall"]["agentRunId"]
            for event, payload in events
            if event == "tool.start"
        )

        trace = client.get(
            f"/api/harness/agent-runs/{agent_run_id}",
        ).json()["data"]
        call = next(item for item in trace["toolCalls"] if item["id"] == approval_event["approval"]["toolCallId"])
        assert call["status"] == "waiting_approval"
        assert call["arguments"]["content"]["bytes"] > 0
        assert "报价" not in call["arguments"]["content"]
        stored_call = db.get(ToolCallModel, call["id"])
        assert "MVP 指令整理" not in stored_call.arguments_json
        assistant_meta = next(
            message for message in harness.list_messages(session["id"])
            if message.role == "assistant" and "toolCalls" in (message.meta_json or "{}")
        )
        assert "MVP 指令整理" not in assistant_meta.meta_json
        pending = workspace / "_pending" / project["id"] / f"{call['id']}.pending"
        assert pending.is_file()

        reloaded = client.get("/api/harness/projects").json()["data"]
        restored_run = reloaded[0]["sessions"][0]["agentRun"]
        assert restored_run["status"] == "waiting_approval"
        assert restored_run["toolCalls"][0]["status"] == "waiting_approval"

        approved = client.post(
            f"/api/harness/agent-runs/{trace['id']}/approval",
            json={"approved": True, "tool_call_id": call["id"]},
        ).json()["data"]
        assert approved["status"] == "waiting_tool"
        target = workspace / project["id"] / "deliverables" / "offer.md"
        assert target.read_text(encoding="utf-8").startswith("# 报价")
        assert not pending.exists()

        AppStatus.should_exit_event = asyncio.Event()
        resume_client = TestClient(client.app)
        resumed = resume_client.post(
            f"/api/harness/agent-runs/{trace['id']}/resume",
        )
        assert resumed.status_code == 200
        assert any(payload.get("type") == "done" for _, payload in parse_sse(resumed.text))

        reloaded = client.get("/api/harness/projects").json()["data"]
        messages = reloaded[0]["sessions"][0]["messages"]
        assert any(message["role"] == "tool" for message in messages)
        assert messages[-1]["content"] == "已生成报价文档，并写入项目沙箱。"
    finally:
        db.close()
        engine.dispose()


def test_read_only_rejects_write_and_paths_are_sandboxed(tmp_path):
    client, db, engine, commerce, harness, _, workspace = make_client(tmp_path)
    try:
        activate_paid_user(commerce, {"id": "local"})
        mvp_run = create_active_run(commerce, {"id": "local"})
        project = client.post("/api/harness/projects", json={
            "title": "只读项目",
            "mvp_run_id": mvp_run.id,
        }).json()["data"]
        session = project["sessions"][0]
        assert client.patch(
            f"/api/harness/sessions/{session['id']}",
            json={"permission": "workspace-write"},
        ).status_code == 200
        denied = client.post(
            f"/api/harness/sessions/{session['id']}/files",
            json={"files": [{"path": "../escape.txt", "content": "bad"}]},
        )
        assert denied.status_code == 400
        assert "路径" in denied.json()["message"] or "路径" in str(denied.json())

        service = client.app.state.agent_service
        project_model = harness.get_project("local", project["id"])
        try:
            service.tools.safe_file_target(project_model, "../escape.txt")
            raise AssertionError("path traversal was accepted")
        except Exception as exc:
            assert "沙箱外" in str(exc)
        try:
            service.tools.safe_file_target(project_model, "/absolute.txt")
            raise AssertionError("absolute path was accepted")
        except Exception as exc:
            assert "相对路径" in str(exc)
        assert not (workspace / "escape.txt").exists()

        sandbox = workspace / project["id"]
        (sandbox / "keep.txt").write_text("keep", encoding="utf-8")
        deleted = client.delete(f"/api/harness/projects/{project['id']}")
        assert deleted.status_code == 200
        assert not sandbox.exists()
    finally:
        db.close()
        engine.dispose()


def test_context_compression(tmp_path):
    client, db, engine, commerce, harness, _, __ = make_client(tmp_path)
    try:
        activate_paid_user(commerce, {"id": "local"})
        mvp_run = create_active_run(commerce, {"id": "local"})
        project = client.post("/api/harness/projects", json={
            "title": "上下文项目",
            "mvp_run_id": mvp_run.id,
        }).json()["data"]
        session = harness.get_session("local", project["sessions"][0]["id"])
        for index in range(12):
            harness.add_message(session, "user" if index % 2 == 0 else "assistant", f"消息 {index} " + "细节" * 100)

        context = client.get(
            f"/api/harness/sessions/{session.id}/context",
        ).json()["data"]
        assert context["components"]
        compressed = client.post(
            f"/api/harness/sessions/{session.id}/context/compress",
        ).json()["data"]
        assert "早期对话要点" in compressed["summary"]
    finally:
        db.close()
        engine.dispose()


def test_free_user_can_create_project_after_install(tmp_path):
    client, db, engine, commerce, _, __, ___ = make_client(tmp_path)
    try:
        activate_paid_user(commerce, {"id": "local"})
        create_active_run(commerce, {"id": "local"})
        response = client.post("/api/harness/projects", json={"title": "免费用户项目"})
        assert response.status_code == 200
    finally:
        db.close()
        engine.dispose()
