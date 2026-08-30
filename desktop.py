"""Windows desktop launcher for the packaged June AI application."""

from __future__ import annotations

import os
import secrets
import socket
import sys
import threading
import time
import urllib.request
import webbrowser
from pathlib import Path


def _parse_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.is_file():
        return values
    for raw_line in path.read_text(encoding="utf-8-sig").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def _configure_environment(data_root: Path) -> None:
    data_root.mkdir(parents=True, exist_ok=True)
    runtime_path = data_root / "june.env"
    runtime = _parse_env_file(runtime_path)
    changed = False
    for key in ("JUNE_AUTH_SECRET", "JUNE_API_TOKEN", "JUNE_BYOK_KEY"):
        if key not in runtime:
            runtime[key] = secrets.token_hex(32)
            changed = True
    if changed:
        runtime_path.write_text(
            "\n".join(f"{key}={value}" for key, value in runtime.items()) + "\n",
            encoding="utf-8",
        )

    user_env = {}
    if getattr(sys, "frozen", False):
        user_env = _parse_env_file(Path(sys.executable).resolve().parent / ".env")

    for key, value in user_env.items():
        if key != "JUNE_DATABASE_URL":
            os.environ.setdefault(key, value)
    for key, value in runtime.items():
        os.environ[key] = value
    os.environ["JUNE_DATABASE_URL"] = ""

    defaults = {
        "JUNE_ENV": "desktop",
        "JUNE_DESKTOP_DATA_DIR": str(data_root),
        "JUNE_DB_PATH": str(data_root / "june.db"),
        "JUNE_LOG_PATH": str(data_root / "logs"),
        "JUNE_WORKSPACE_ROOT": str(data_root / "workspaces"),
        "SERVER_HOST": "127.0.0.1",
        "JUNE_PAYMENT_PROVIDER": "sandbox",
    }
    for key, value in defaults.items():
        os.environ.setdefault(key, value)


def _acquire_single_instance_lock(lock_path: Path):
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    handle = lock_path.open("a+b")
    if sys.platform == "win32":
        import msvcrt

        try:
            handle.seek(0)
            msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
            return handle
        except OSError:
            handle.close()
            return None
    try:
        import fcntl

        handle.seek(0)
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        return handle
    except (ImportError, OSError):
        handle.close()
        return None


def _find_port() -> int:
    for port in (8787, 8788, 8789):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
            probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                probe.bind(("127.0.0.1", port))
                return port
            except OSError:
                continue
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.bind(("127.0.0.1", 0))
        return int(probe.getsockname()[1])


def _open_when_ready(url: str) -> None:
    if os.getenv("JUNE_DESKTOP_NO_BROWSER") == "1":
        return

    def worker() -> None:
        for _ in range(120):
            try:
                with urllib.request.urlopen(f"{url}/health", timeout=1) as response:
                    if response.status == 200:
                        webbrowser.open(url)
                        return
            except OSError:
                time.sleep(0.25)

    threading.Thread(target=worker, daemon=True).start()


def main() -> int:
    configured_data_root = os.getenv("JUNE_DESKTOP_DATA_DIR")
    if configured_data_root:
        data_root = Path(configured_data_root).expanduser().resolve()
    elif getattr(sys, "frozen", False):
        data_root = Path(sys.executable).resolve().parent / "data"
    else:
        data_root = Path(__file__).resolve().parent / "desktop-data"
    _configure_environment(data_root)

    lock = _acquire_single_instance_lock(data_root / "june.lock")
    if lock is None:
        url_file = data_root / "runtime.url"
        if url_file.is_file():
            webbrowser.open(url_file.read_text(encoding="utf-8").strip())
            return 0
        print("June AI 已在运行，但无法读取现有窗口地址。")
        return 0

    port = _find_port()
    url = f"http://127.0.0.1:{port}"
    (data_root / "runtime.url").write_text(url, encoding="utf-8")

    from uvicorn import Config, Server

    from backend.app.main import app

    print(f"June AI 正在启动：{url}")
    print(f"数据目录：{data_root}")
    print("关闭此窗口即可退出 June AI。")
    _open_when_ready(url)
    try:
        Server(Config(app, host="127.0.0.1", port=port, log_level="info")).run()
    except KeyboardInterrupt:
        pass
    finally:
        try:
            lock.close()
        except Exception:
            pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
