import json
import hmac
import threading
import time
from pathlib import Path

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import PlainTextResponse

from .config import settings


class RuntimeMetrics:
    def __init__(self):
        self.started_at = time.time()
        self.counters = {
            "http_requests_total": 0,
            "http_errors_total": 0,
            "sse_requests_total": 0,
            "june_agent_runs_total": 0,
            "june_agent_tool_calls_total": 0,
            "june_agent_tool_failures_total": 0,
            "june_agent_approvals_total": 0,
            "june_agent_cancellations_total": 0,
            "june_follow_up_total": 0,
            "june_follow_up_depth_total": 0,
        }
        self._lock = threading.Lock()

    def inc(self, name: str, amount: int = 1) -> None:
        with self._lock:
            self.counters[name] = self.counters.get(name, 0) + amount

    def snapshot(self) -> dict:
        with self._lock:
            return {
                **self.counters,
                "process_uptime_seconds": int(time.time() - self.started_at),
            }

    def prometheus(self) -> str:
        snapshot = self.snapshot()
        lines = [
            "# TYPE june_uptime_seconds counter",
            f"june_uptime_seconds {snapshot['process_uptime_seconds']}",
            "# TYPE june_http_requests_total counter",
            f"june_http_requests_total {snapshot['http_requests_total']}",
            "# TYPE june_http_errors_total counter",
            f"june_http_errors_total {snapshot['http_errors_total']}",
            "# TYPE june_sse_requests_total counter",
            f"june_sse_requests_total {snapshot['sse_requests_total']}",
            "# TYPE june_agent_runs_total counter",
            f"june_agent_runs_total {snapshot['june_agent_runs_total']}",
            "# TYPE june_agent_tool_calls_total counter",
            f"june_agent_tool_calls_total {snapshot['june_agent_tool_calls_total']}",
            "# TYPE june_agent_tool_failures_total counter",
            f"june_agent_tool_failures_total {snapshot['june_agent_tool_failures_total']}",
            "# TYPE june_agent_approvals_total counter",
            f"june_agent_approvals_total {snapshot['june_agent_approvals_total']}",
            "# TYPE june_agent_cancellations_total counter",
            f"june_agent_cancellations_total {snapshot['june_agent_cancellations_total']}",
            "# TYPE june_follow_up_total counter",
            f"june_follow_up_total {snapshot['june_follow_up_total']}",
            "# TYPE june_follow_up_depth_total counter",
            f"june_follow_up_depth_total {snapshot['june_follow_up_depth_total']}",
        ]
        return "\n".join(lines) + "\n"


class ObservabilityMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, metrics: RuntimeMetrics):
        super().__init__(app)
        self.metrics = metrics
        self.log_path = Path(settings.log_path) / "app.jsonl"
        self.log_path.parent.mkdir(parents=True, exist_ok=True)

    async def dispatch(self, request: Request, call_next):
        if request.url.path == "/metrics":
            expected = settings.JUNE_METRICS_TOKEN or settings.JUNE_API_TOKEN
            supplied = request.headers.get("authorization", "")
            candidate = supplied[7:] if supplied.startswith("Bearer ") else request.headers.get("x-metrics-token", "")
            if not expected or not candidate or not hmac.compare_digest(candidate, expected):
                return PlainTextResponse("Not Found", status_code=404)
            return PlainTextResponse(self.metrics.prometheus(), media_type="text/plain; version=0.0.4")

        started = time.perf_counter()
        try:
            response = await call_next(request)
        except Exception:
            self.metrics.inc("http_requests_total")
            self.metrics.inc("http_errors_total")
            self._write_log(request, 500, started)
            raise

        duration_ms = int((time.perf_counter() - started) * 1000)
        self.metrics.inc("http_requests_total")
        if response.status_code >= 500:
            self.metrics.inc("http_errors_total")
        if "text/event-stream" in response.headers.get("content-type", ""):
            self.metrics.inc("sse_requests_total")
        self._write_log(request, response.status_code, started, duration_ms)
        return response

    def _write_log(self, request: Request, status_code: int, started: float, duration_ms: int | None = None) -> None:
        elapsed = duration_ms if duration_ms is not None else int((time.perf_counter() - started) * 1000)
        record = {
            "timestamp": int(time.time() * 1000),
            "method": request.method,
            "path": request.url.path,
            "status": status_code,
            "duration_ms": elapsed,
        }
        try:
            with self.log_path.open("a", encoding="utf-8") as stream:
                stream.write(json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n")
        except OSError:
            # Metrics remain in memory if the volume is unavailable.
            pass
