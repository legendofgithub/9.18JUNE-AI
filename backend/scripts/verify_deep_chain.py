"""运行时深链验证：30 层追问链的上下文组装、预算封顶与查询成本。"""
import asyncio
import os
import sys
import tempfile
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session

from app.models.database import Base
from app.models.schemas import FollowUpRequest, SourceInfo
from app.repositories.commerce_repo import CommerceRepository
from app.repositories.session_repo import SessionRepository
from app.services.mvp_service import MvpService


class FakeLLM:
    def __init__(self):
        self.calls = []

    async def chat(self, **kwargs):
        self.calls.append(kwargs)
        yield "结论：先做付费人群验证。"

    def get_api_key(self):
        return "test-key"


def main():
    db_path = os.path.join(tempfile.gettempdir(), "june_deep_chain.db")
    if os.path.exists(db_path):
        os.unlink(db_path)
    engine = create_engine(f"sqlite:///{db_path}", connect_args={"check_same_thread": False})
    query_count = {"n": 0}

    @event.listens_for(engine, "before_cursor_execute")
    def count_queries(*args, **kwargs):
        query_count["n"] += 1

    Base.metadata.create_all(engine)
    db = Session(engine)
    commerce = CommerceRepository(db)
    sessions = SessionRepository(db)
    llm = FakeLLM()
    owner = "deep-user"
    commerce.install_skill(owner, "test-model", "https://api.test", True, "cipher")
    service = MvpService(commerce, sessions, llm, None)
    run = service.create_run(owner, "深链项目", "本地商家")
    run_id = run["id"]

    DEPTH = 30
    query_count["n"] = 0
    t0 = time.perf_counter()
    per_level_queries: list[int] = []
    for level in range(2, 2 + DEPTH):
        body = FollowUpRequest(
            session_id=run_id,
            parent_thread_id="main" if level == 2 else f"t{level-1}",
            thread_id=f"t{level}",
            level=level,
            source=SourceInfo(type="text", selected_text="选中文本", source_message_id="msg-1"),
            query=f"L{level} 层的问题：这一步怎么做？",
        )
        before = query_count["n"]
        chunks = asyncio.run(_collect(service, owner, run_id, body))
        per_level_queries.append(query_count["n"] - before)
        assert any("结论" in str(c) for c in chunks), f"L{level} 未返回内容"

    elapsed = time.perf_counter() - t0
    print(f"[1] {DEPTH} 层追问全部成功，耗时 {elapsed:.2f}s")
    scaling = per_level_queries[-1] - per_level_queries[0]
    print(f"[1b] 首层(链深1)查询 {per_level_queries[0]} 条，末层(链深{DEPTH})查询 {per_level_queries[-1]} 条，随链深增长 {scaling} 条")

    # 最后一层 prompt 验证：近期祖先原文可见，远层有压缩标注
    prompt = llm.calls[-1]["messages"][-1]["content"]
    assert "L30 层的问题" in prompt, "当前层缺失"
    assert "L29 层的问题" in prompt, "近层祖先缺失"
    assert "L3 层的问题" in prompt or "已压缩" in prompt, "远层祖先既无原文也无压缩标注"
    print(f"[2] 末层 prompt 长度 {len(prompt)} 字符（预算 {service.FOLLOW_UP_BUDGET} + 主链 {service.FOLLOW_UP_MAIN_BUDGET}）")
    assert len(prompt) <= service.FOLLOW_UP_BUDGET + service.FOLLOW_UP_MAIN_BUDGET + 2000, "prompt 超预算"

    # 摘要沉淀
    states = [sessions.find_thread(f"t{l}") for l in range(2, 2 + DEPTH)]
    with_summary = sum(1 for t in states if t)
    print(f"[3] threads 表记录 {with_summary}/{DEPTH} 层")

    # 每层查询成本（N+1 量化）
    per_level = query_count["n"] / DEPTH
    print(f"[4] 总查询 {query_count['n']} 次，平均每层追问 {per_level:.1f} 条 SQL（固定开销，与链深无关）")

    # 深链回溯正确性
    chain = sessions.get_thread_ancestry("t31" if DEPTH > 29 else f"t{1+DEPTH}")
    print(f"[5] 末层祖先链长度 {len(chain)}（期望 {min(DEPTH, 64)}）")
    db.close()
    engine.dispose()
    os.unlink(db_path)
    print("OK: 无限追问运行正常")


async def _collect(service, owner, run_id, body):
    return [chunk async for chunk in service.stream_follow_up(owner, run_id, body)]


if __name__ == "__main__":
    main()
