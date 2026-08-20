import argparse
import os
import sqlite3
import time
from datetime import datetime
from pathlib import Path


def database_path() -> Path:
    configured = os.getenv("JUNE_DB_PATH", "").strip()
    if configured:
        return Path(configured).resolve()
    return Path(__file__).resolve().parent.parent / "june.db"


def backup_directory() -> Path:
    configured = os.getenv("JUNE_BACKUP_DIR", "").strip()
    if configured:
        return Path(configured).resolve()
    return database_path().parent / "backups"


def create_backup() -> Path:
    source = database_path()
    if not source.exists():
        raise FileNotFoundError(f"Database not found: {source}")

    destination_dir = backup_directory()
    destination_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    destination = destination_dir / f"june-{timestamp}.db"
    temporary = destination.with_suffix(".db.tmp")

    source_connection = sqlite3.connect(source)
    destination_connection = sqlite3.connect(temporary)
    try:
        source_connection.backup(destination_connection)
        destination_connection.execute("PRAGMA integrity_check")
        result = destination_connection.execute("PRAGMA integrity_check").fetchone()
        if not result or result[0] != "ok":
            raise RuntimeError("Backup integrity check failed")
    finally:
        destination_connection.close()
        source_connection.close()
    temporary.replace(destination)
    return destination


def prune_backups(retention: int) -> int:
    backups = sorted(backup_directory().glob("june-*.db"))
    removed = 0
    for stale in backups[:-retention] if retention > 0 else []:
        stale.unlink()
        removed += 1
    return removed


def main() -> None:
    parser = argparse.ArgumentParser(description="Backup the June SQLite database")
    parser.add_argument("--loop", action="store_true", help="Run continuously for a container sidecar")
    parser.add_argument("--interval-seconds", type=int, default=24 * 60 * 60)
    parser.add_argument("--retention", type=int, default=int(os.getenv("JUNE_BACKUP_RETENTION", "14")))
    args = parser.parse_args()

    while True:
        try:
            destination = create_backup()
            removed = prune_backups(max(args.retention, 1))
            print(f"backup created: {destination}; pruned: {removed}", flush=True)
        except Exception as exc:
            print(f"backup failed: {type(exc).__name__}: {exc}", flush=True)
        if not args.loop:
            return
        time.sleep(max(args.interval_seconds, 60))


if __name__ == "__main__":
    main()
