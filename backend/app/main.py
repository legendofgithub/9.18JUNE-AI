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
from pathlib import Path
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse

from .core.config import settings
from .core.exceptions import JuneException
from .core.observability import ObservabilityMiddleware, RuntimeMetrics
from .core.security import TokenAuthMiddleware, ensure_token
from .models.database import (
    RequestSessionMiddleware,
    get_request_scoped_session,
    init_db,
    request_db_scope,
)
from .repositories import SessionRepository
from .repositories.commerce_repo import CommerceRepository
from .services import SessionService
from .services.admin_service import AdminService
from .services.auth_service import AuthService
from .services.commerce_service import CommerceService
from .services.mvp_service import MvpService
from .services.deepseek import DeepSeekService
from .thread_manager import thread_manager
from .routes import admin, auth, commerce, sessions, models


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

    # 初始化数据库
    init_db(settings.db_path)
    print(f"[June] 数据库已初始化: {settings.db_path}")

    # 确保 API Token（开发模式自动生成）
    ensure_token()

    # 装配依赖链；仓储持有的代理会在每个请求内解析到独立 Session。
    db_session = get_request_scoped_session()
    session_repo = SessionRepository(db_session)
    commerce_repo = CommerceRepository(db_session)
    with request_db_scope(settings.db_path):
        commerce_repo.seed_products()
        if settings.JUNE_ADMIN_PASSWORD:
            commerce_repo.seed_admin(
                settings.JUNE_ADMIN_IDENTITY,
                settings.JUNE_ADMIN_EMAIL,
                settings.JUNE_ADMIN_PASSWORD,
                settings.JUNE_ADMIN_DISPLAY_NAME,
            )
    deepseek_service = DeepSeekService()
    app.state.session_service = SessionService(session_repo, deepseek_service, thread_manager)
    app.state.deepseek_service = deepseek_service
    app.state.db_session = db_session
    app.state.commerce_repo = commerce_repo
    app.state.auth_service = AuthService(commerce_repo)
    app.state.commerce_service = CommerceService(commerce_repo, deepseek_service)
    app.state.admin_service = AdminService(commerce_repo, app.state.auth_service)
    app.state.mvp_service = MvpService(commerce_repo, session_repo, deepseek_service, thread_manager)
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

    # 等待 SSE 流自然断开，避免客户端收到 RST
    await asyncio.sleep(5)


# ── FastAPI 应用实例 ──

app = FastAPI(
    title="June AI API",
    description="Vibe Coding 变现训练官：用自然语言做最小商业 MVP",
    version="2.0.0",
    lifespan=lifespan,
)

app.state.runtime_metrics = RuntimeMetrics()

app.add_middleware(RequestSessionMiddleware, db_path=settings.db_path)

# ── 中间件 ──

# CORS（来源从配置读取，不再硬编码通配符）
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Token 鉴权（开发模式自动生成 token，生产模式从 .env 读取）
app.add_middleware(TokenAuthMiddleware)
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
    """兜底异常处理"""
    import traceback
    traceback.print_exc()
    return JSONResponse(
        status_code=500,
        content={
            "code": 500,
            "message": f"服务器内部错误: {str(exc)}",
            "data": None,
            "timestamp": int(__import__("time").time() * 1000),
        },
    )


# ── 注册路由 ──

app.include_router(sessions.router, prefix="/api")
app.include_router(models.router, prefix="/api")
app.include_router(auth.router, prefix="/api")
app.include_router(commerce.router, prefix="/api")
app.include_router(admin.router, prefix="/api")


# ── 公开端点 ──


@app.get("/")
async def root():
    return {"name": "June AI API", "version": "2.0.0", "status": "running", "env": settings.JUNE_ENV}


@app.get("/health")
async def health():
    """健康检查 —— 验证数据库可读写 + 线程状态"""
    import sqlite3

    db_status = "disconnected"
    try:
        conn = sqlite3.connect(settings.db_path)
        conn.execute("SELECT 1")
        conn.close()
        db_status = "connected"
    except Exception as e:
        db_status = f"error: {e}"

    return {
        "status": "healthy" if db_status == "connected" else "degraded",
        "db": db_status,
        "active_threads": thread_manager.active_count(),
        "metrics": app.state.runtime_metrics.snapshot(),
    }


@app.get("/api/status")
async def system_status(request: Request):
    """系统状态端点 —— 返回版本、数据库状态、API 配置信息（需 Token）"""
    import sqlite3

    db_ok = False
    try:
        conn = sqlite3.connect(settings.db_path)
        conn.execute("SELECT 1")
        conn.close()
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

frontend_dist = Path(__file__).resolve().parent.parent.parent / "frontend" / "dist"
if frontend_dist.exists():
    app.mount("/assets", StaticFiles(directory=frontend_dist / "assets"), name="assets")

    @app.get("/{full_path:path}")
    async def serve_frontend(full_path: str):
        """SPA 回退：所有非 /api 请求返回 index.html"""
        file_path = frontend_dist / full_path
        if file_path.exists() and file_path.is_file():
            return FileResponse(file_path)
        return FileResponse(frontend_dist / "index.html")
