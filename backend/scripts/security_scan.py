"""Security dependency scanner for June AI.

Checks Python and frontend dependencies for known vulnerabilities.

Prerequisites:
  - Python: pip install pip-audit
  - Frontend: npm ci (or at least node_modules present)

Usage:
  python scripts/security_scan.py
  python scripts/security_scan.py --python-only
  python scripts/security_scan.py --frontend-only
"""
import argparse
import shutil
import subprocess
import sys
from pathlib import Path


BACKEND_DIR = Path(__file__).resolve().parent.parent
FRONTEND_DIR = BACKEND_DIR.parent / "frontend"


def run_python_scan() -> int:
    if shutil.which("pip-audit") is None:
        print("[security] pip-audit 未安装，跳过 Python 依赖扫描。")
        print("[security] 安装命令: pip install pip-audit")
        return 0
    print("[security] 正在扫描 Python 依赖 ...")
    result = subprocess.run(
        [sys.executable, "-m", "pip_audit", "--requirement", str(BACKEND_DIR / "requirements.txt")],
        cwd=str(BACKEND_DIR),
    )
    return result.returncode


def run_frontend_scan() -> int:
    if not (FRONTEND_DIR / "package-lock.json").exists():
        print("[security] 未找到 frontend/package-lock.json，跳过前端依赖扫描。")
        return 0
    npm = shutil.which("npm")
    if npm is None:
        print("[security] 未找到 npm，跳过前端依赖扫描。")
        return 0
    print("[security] 正在扫描前端依赖 ...")
    result = subprocess.run(
        [npm, "audit", "--omit=dev"],
        cwd=str(FRONTEND_DIR),
    )
    return result.returncode


def main() -> int:
    parser = argparse.ArgumentParser(description="Scan June AI dependencies for known vulnerabilities")
    parser.add_argument("--python-only", action="store_true", help="Only scan Python dependencies")
    parser.add_argument("--frontend-only", action="store_true", help="Only scan frontend dependencies")
    args = parser.parse_args()

    exit_code = 0
    if not args.frontend_only:
        exit_code |= run_python_scan()
    if not args.python_only:
        exit_code |= run_frontend_scan()

    if exit_code:
        print("[security] 发现依赖漏洞或扫描命令失败，请根据上方输出修复后重试。", file=sys.stderr)
    else:
        print("[security] 扫描完成，未发现已知依赖漏洞（或工具未安装）。")
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
