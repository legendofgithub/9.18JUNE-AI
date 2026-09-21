"""
June AI 应用入口 —— FastAPI 应用装配

启动时：
1. 加载配置（Pydantic Settings，自动读取 .env）
2. 初始化数据库（SQLite + SQLAlchemy ORM）
3. 装配依赖链：Repository → Service → Routes
4. 注册中间件（CORS、Token 鉴权）
5. 注册全局异常处理器
"""
import os
import asyncio
import sys
from pathlib import Path
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse

from .core.config import settings
from .core.exceptions import JuneException
from .core.observability import ObservabilityMiddleware, RuntimeMetrics
from .core.security import SingleUserMiddleware, ensure_byok_key, ensure_token
from .models.database import (
    RequestSessionMiddleware,
    get_engine,
    get_request_scoped_session,
    init_db,
    request_db_scope,
    verify_managed_database,
)
from .repositories import SessionRepository
from .repositories.commerce_repo import CommerceRepository
from .repositories.harness_repo import HarnessRepository
from .services.agent_service import AgentService
from .services.commerce_service import CommerceService
from .services.mvp_service import MvpService
from .services.deepseek import DeepSeekService
from .thread_manager import thread_manager
from .routes import commerce, harness, models


@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期管理"""
    # ── 启动阶段 ──
    print(f"[June] 启动模式: {settings.JUNE_ENV}")

    # 校验配置
    errors = settings.validate()
    if errors:
        for err in errors:
            print(f"[June] WARNING  {err}")
        if settings.is_production:
            raise RuntimeError("生产模式配置校验失败，请检查 .env 文件")

    # 初始化数据库。外部 Postgres/Supabase 必须先显式执行 Alembic 迁移。
    if settings.is_vercel_runtime and not settings.database_url:
        raise RuntimeError("Vercel 部署必须配置 JUNE_DATABASE_URL（Supabase Postgres）")
    if settings.database_url:
        verify_managed_database(settings.database_url)
        print("[June] 已连接托管数据库，并确认迁移版本")
    else:
        init_db(settings.connection_url)
        print(f"[June] SQLite 数据库已初始化: {settings.db_path}")

    # 确保 API Token（开发模式自动生成）
    ensure_token()
    ensure_byok_key()

    # 装配依赖链；仓储持有的代理会在每个请求内解析到独立 Session。
    db_session = get_request_scoped_session()
    session_repo = SessionRepository(db_session)
    commerce_repo = CommerceRepository(db_session)
    harness_repo = HarnessRepository(db_session)
    deepseek_service = DeepSeekService()
    app.state.deepseek_service = deepseek_service
    app.state.db_session = db_session
    app.state.commerce_repo = commerce_repo
    app.state.commerce_service = CommerceService(commerce_repo, deepseek_service)
    app.state.mvp_service = MvpService(commerce_repo, session_repo, deepseek_service, thread_manager)
    app.state.agent_service = AgentService(
        harness_repo,
        commerce_repo,
        deepseek_service,
        Path(settings.workspace_root),
        app.state.runtime_metrics,
    )
    with request_db_scope(settings.connection_url):
        recovered = app.state.agent_service.recover_interrupted()
    if recovered:
        print(f"[June] 已把 {recovered} 个中断 Agent 执行标记为 failed(interrupted)")
    # 启动 ThreadManager
    await thread_manager.start_cleanup(interval=settings.THREAD_CLEANUP_INTERVAL)
    print(f"[June] ThreadManager 已启动（空闲超时: {thread_manager._idle_timeout}s）")

    yield

    # ── 关闭阶段 ──
    await thread_manager.stop_cleanup()
    print(f"[June] ThreadManager 已停止，活跃线程数: {thread_manager.active_count()}")

    # 关闭数据库连接
    if hasattr(app.state, "db_session"):
        app.state.db_session.close()

    # 本地/自托管等待 SSE 流自然断开；Vercel 关闭窗口只有 500ms。
    if not settings.is_vercel_runtime:
        await asyncio.sleep(5)


# ── FastAPI 应用实例 ──

app = FastAPI(
    title="June AI API",
    description="June AI：无限追问的 AI 辅助伴学系统",
    version="2.0.0",
    lifespan=lifespan,
)

app.state.runtime_metrics = RuntimeMetrics()

app.add_middleware(RequestSessionMiddleware, connection_url=settings.connection_url)

# ── 中间件 ──

# CORS（来源从配置读取，不再硬编码通配符）
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 单用户模式：所有 /api/* 请求归属固定本地身份（无登录）
app.add_middleware(SingleUserMiddleware)
app.add_middleware(ObservabilityMiddleware, metrics=app.state.runtime_metrics)

# ── 全局异常处理 ──


@app.exception_handler(JuneException)
async def june_exception_handler(request: Request, exc: JuneException):
    """统一处理 JuneException 及其子类"""
    return JSONResponse(
        status_code=exc.code if exc.code < 500 else 500,
        content={
            "code": exc.code,
            "message": exc.message,
            "data": exc.data,
            "timestamp": int(__import__("time").time() * 1000),
        },
    )


@app.exception_handler(Exception)
async def general_exception_handler(request: Request, exc: Exception):
    """Log unexpected failures without exposing internals to clients."""
    import traceback
    traceback.print_exc()
    return JSONResponse(
        status_code=500,
        content={
            "code": 500,
            "message": "服务器内部错误，请稍后重试",
            "data": None,
            "timestamp": int(__import__("time").time() * 1000),
        },
    )


# ── 注册路由 ──

app.include_router(models.router, prefix="/api")
app.include_router(commerce.router, prefix="/api")
app.include_router(harness.router, prefix="/api")


# ── 公开端点 ──


@app.get("/")
async def root():
    if (frontend_dist / "index.html").is_file():
        return FileResponse(frontend_dist / "index.html")
    return {"name": "June AI API", "version": "2.0.0", "status": "running", "env": settings.JUNE_ENV}


@app.get("/health")
async def health():
    """健康检查 —— 验证数据库连接 + 线程状态"""
    from sqlalchemy import text

    db_status = "connected"
    try:
        engine = get_engine(settings.connection_url)
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
    except Exception as e:
        db_status = "error"
        print(f"[June] Health database check failed: {type(e).__name__}")

    return {
        "status": "healthy" if db_status == "connected" else "degraded",
        "db": db_status,
        "active_threads": thread_manager.active_count(),
    }


@app.get("/api/status")
async def system_status(request: Request):
    """系统状态端点 —— 返回版本、数据库状态、API 配置信息（需 Token）"""
    from sqlalchemy import text

    db_ok = False
    try:
        engine = get_engine(settings.connection_url)
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
        db_ok = True
    except Exception:
        pass

    llm_configured = bool(settings.llm_api_key or request.app.state.deepseek_service.get_api_key())

    return {
        "version": "2.0.0",
        "env": settings.JUNE_ENV,
        "db": "connected" if db_ok else "error",
        "llm_api_configured": llm_configured,
        "llm_base_url": settings.llm_base_url,
        "llm_model": settings.llm_default_model,
        "active_threads": thread_manager.active_count(),
    }


# ── 前端静态文件托管（生产模式） ──

if getattr(sys, "frozen", False):
    frontend_dist = Path(getattr(sys, "_MEIPASS", Path(sys.executable).resolve().parent)) / "frontend" / "dist"
else:
    frontend_dist = Path(__file__).resolve().parent.parent.parent / "frontend" / "dist"
if (frontend_dist / "index.html").exists():
    # 注意：不要用 app.frontend()，该方法在当前 FastAPI 版本已不存在，会在生产/桌面模式下直接崩。
    assets_dir = frontend_dist / "assets"
    if assets_dir.exists():
        app.mount("/assets", StaticFiles(directory=str(assets_dir)), name="frontend-assets")

    _frontend_root = frontend_dist.resolve()

    @app.get("/", include_in_schema=False)
    async def _frontend_index():
        return FileResponse(_frontend_root / "index.html")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def _frontend_spa(full_path: str):
        """SPA fallback：命中真实文件就返回，否则回落到 index.html（前端用 hash 路由）"""
        target = (frontend_dist / full_path).resolve()
        if target.is_file() and str(target).startswith(str(_frontend_root)):
            return FileResponse(target)
        return FileResponse(_frontend_root / "index.html")
