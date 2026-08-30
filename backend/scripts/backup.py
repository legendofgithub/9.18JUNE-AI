import argparse
import os
import shutil
import sqlite3
import subprocess
import time
from urllib.parse import unquote, urlsplit
from datetime import datetime
from pathlib import Path


def database_path() -> Path:
    configured = os.getenv("JUNE_DB_PATH", "").strip()
    if configured:
        return Path(configured).resolve()
    return Path(__file__).resolve().parent.parent / "june.db"


def database_url() -> str:
    url = os.getenv("JUNE_DATABASE_URL", "").strip()
    if url.startswith("postgres://"):
        url = url.replace("postgres://", "postgresql+psycopg://", 1)
    elif url.startswith("postgresql://"):
        url = url.replace("postgresql://", "postgresql+psycopg://", 1)
    return url


def backup_directory() -> Path:
    configured = os.getenv("JUNE_BACKUP_DIR", "").strip()
    if configured:
        return Path(configured).resolve()
    return database_path().parent / "backups"


def offsite_directory() -> Path | None:
    configured = os.getenv("JUNE_OFFSITE_BACKUP_DIR", "").strip()
    if not configured:
        return None
    return Path(configured).expanduser().resolve()


def create_backup() -> Path:
    url = database_url()
    if url:
        return create_postgres_backup(url)
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


def create_postgres_backup(url: str) -> Path:
    parsed = urlsplit(url)
    if parsed.scheme not in {"postgresql", "postgresql+psycopg"}:
        raise ValueError("JUNE_DATABASE_URL must be a PostgreSQL connection URL")
    destination_dir = backup_directory()
    destination_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    destination = destination_dir / f"june-{timestamp}.dump"
    temporary = destination.with_suffix(".dump.tmp")

    environment = os.environ.copy()
    environment["PGSSLMODE"] = "require"
    if parsed.password:
        environment["PGPASSWORD"] = unquote(parsed.password)
    command = [
        "pg_dump",
        "--format=custom",
        "--no-owner",
        "--no-privileges",
        f"--file={temporary}",
        f"--host={parsed.hostname}",
        f"--port={parsed.port or 5432}",
        f"--username={unquote(parsed.username or '')}",
        f"--dbname={parsed.path.lstrip('/')}",
    ]
    try:
        completed = subprocess.run(
            command,
            environment=environment,
            capture_output=True,
            text=True,
            check=False,
        )
        if completed.returncode != 0:
            raise RuntimeError(f"pg_dump failed with exit code {completed.returncode}")
        if not temporary.is_file() or temporary.stat().st_size == 0:
            raise RuntimeError("pg_dump did not create a non-empty backup")
        listing = subprocess.run(
            ["pg_restore", "--list", str(temporary)],
            capture_output=True,
            text=True,
            check=False,
        )
        if listing.returncode != 0:
            raise RuntimeError("Backup validation with pg_restore failed")
        temporary.replace(destination)
        return destination
    finally:
        if temporary.exists():
            temporary.unlink()


def prune_backups(retention: int) -> int:
    backups = sorted(backup_directory().glob("june-*.db")) + sorted(backup_directory().glob("june-*.dump"))
    removed = 0
    for stale in backups[:-retention] if retention > 0 else []:
        stale.unlink()
        removed += 1
    return removed

def copy_to_offsite(source: Path, target_dir: Path | None) -> Path | None:
    """Copy a local backup to a configured offsite directory (filesystem/network mount)."""
    if target_dir is None:
        return None
    target_dir.mkdir(parents=True, exist_ok=True)
    destination = target_dir / source.name
    temporary = target_dir / f"{source.name}.tmp"
    shutil.copy2(source, temporary)
    temporary.replace(destination)
    return destination


def prune_offsite(retention: int, target_dir: Path | None = None) -> int:
    if target_dir is None:
        target_dir = offsite_directory()
    if target_dir is None:
        return 0
    backups = sorted(target_dir.glob("june-*.db")) + sorted(target_dir.glob("june-*.dump"))
    removed = 0
    for stale in backups[:-retention] if retention > 0 else []:
        stale.unlink()
        removed += 1
    return removed



def main() -> None:
    parser = argparse.ArgumentParser(description="Backup the June SQLite or PostgreSQL database")
    parser.add_argument("--loop", action="store_true", help="Run continuously for a container sidecar")
    parser.add_argument("--interval-seconds", type=int, default=24 * 60 * 60)
    parser.add_argument("--retention", type=int, default=int(os.getenv("JUNE_BACKUP_RETENTION", "14")))
    parser.add_argument(
        "--offsite-dir",
        default=os.getenv("JUNE_OFFSITE_BACKUP_DIR", "").strip() or None,
        help="Optional offsite directory/network mount to copy backups to",
    )
    args = parser.parse_args()
    offsite = Path(args.offsite_dir).expanduser().resolve() if args.offsite_dir else None

    while True:
        try:
            destination = create_backup()
            removed = prune_backups(max(args.retention, 1))
            offsite_removed = 0
            offsite_destination = copy_to_offsite(destination, offsite)
            if offsite_destination is not None:
                offsite_removed = prune_offsite(max(args.retention, 1), offsite)
            print(
                f"backup created: {destination}; pruned: {removed}; "
                f"offsite: {offsite_destination or 'disabled'}; offsite_pruned: {offsite_removed}",
                flush=True,
            )
        except Exception as exc:
            print(f"backup failed: {type(exc).__name__}: {exc}", flush=True)
        if not args.loop:
            return
        time.sleep(max(args.interval_seconds, 60))


if __name__ == "__main__":
    main()
