"""Copy a June SQLite database into an Alembic-managed PostgreSQL database."""

import argparse
import os
import sqlite3
from datetime import datetime
from pathlib import Path

from sqlalchemy import create_engine, inspect, text

from app.models.database import ALEMBIC_HEAD, Base, init_db


def normalized_destination(raw_url: str) -> str:
    if raw_url.startswith("postgres://"):
        return raw_url.replace("postgres://", "postgresql+psycopg://", 1)
    if raw_url.startswith("postgresql://"):
        return raw_url.replace("postgresql://", "postgresql+psycopg://", 1)
    return raw_url


def backup_source(source_path: Path) -> Path:
    if not source_path.is_file():
        raise FileNotFoundError(f"Source database not found: {source_path}")
    destination_dir = source_path.parent / "backups"
    destination_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    destination = destination_dir / f"pre-postgres-migration-{timestamp}.db"
    temporary = destination.with_suffix(".db.tmp")
    with sqlite3.connect(source_path) as source, sqlite3.connect(temporary) as target:
        source.backup(target)
        result = target.execute("PRAGMA integrity_check").fetchone()
        if not result or result[0] != "ok":
            raise RuntimeError("Source backup integrity check failed")
    temporary.replace(destination)
    return destination


def verify_destination(engine) -> None:
    if engine.dialect.name != "postgresql":
        raise ValueError("Destination JUNE_DATABASE_URL must be PostgreSQL")
    inspector = inspect(engine)
    if "alembic_version" not in inspector.get_table_names():
        raise RuntimeError("Destination is not initialized; run `alembic upgrade head` first")
    with engine.connect() as connection:
        versions = [row[0] for row in connection.execute(text("SELECT version_num FROM alembic_version"))]
    if ALEMBIC_HEAD not in versions:
        raise RuntimeError(f"Destination must be upgraded to {ALEMBIC_HEAD} before data migration")


def row_counts(engine) -> dict[str, int]:
    inspector = inspect(engine)
    counts: dict[str, int] = {}
    with engine.connect() as connection:
        for table in Base.metadata.sorted_tables:
            if table.name in inspector.get_table_names():
                counts[table] = connection.execute(
                    text(f'SELECT COUNT(*) FROM "{table}"')
                ).scalar_one()
    return counts


def migrate(source_path: Path, destination_url: str, dry_run: bool = False) -> dict[str, int]:
    source_url = f"sqlite:///{source_path.resolve()}"
    init_db(source_url)
    source_engine = create_engine(source_url)
    destination_engine = create_engine(
        destination_url,
        pool_pre_ping=True,
        connect_args={"sslmode": "require"},
    )
    verify_destination(destination_engine)

    destination_before = row_counts(destination_engine)
    populated = {table: count for table, count in destination_before.items() if count}
    if populated:
        raise RuntimeError(f"Destination application tables are not empty: {populated}")

    copied: dict[str, int] = {}
    with destination_engine.begin() as destination_connection:
        for table in Base.metadata.sorted_tables:
            with source_engine.connect() as source_connection:
                rows = [dict(row) for row in source_connection.execute(table.select())]
            copied[table.name] = len(rows)
            if rows and not dry_run:
                destination_connection.execute(table.insert(), rows)

    if not dry_run:
        actual = row_counts(destination_engine)
        mismatches = {
            table: (copied[table], actual[table])
            for table in copied
            if copied[table] != actual[table]
        }
        if mismatches:
            raise RuntimeError(f"Post-copy row-count mismatch: {mismatches}")
    return copied


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", default=str(Path(__file__).resolve().parent.parent / "june.db"))
    parser.add_argument("--destination", default=os.getenv("JUNE_DATABASE_URL", ""))
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--confirm", choices=["MIGRATE_JUNE_DATA"])
    args = parser.parse_args()
    if not args.destination:
        parser.error("Set JUNE_DATABASE_URL or pass --destination")
    if not args.dry_run and args.confirm != "MIGRATE_JUNE_DATA":
        parser.error("Non-dry-run migration requires --confirm MIGRATE_JUNE_DATA")

    source = Path(args.source).expanduser().resolve()
    backup = backup_source(source)
    result = migrate(source, normalized_destination(args.destination), args.dry_run)
    mode = "dry-run copied" if args.dry_run else "copied"
    print(f"source_backup={backup}")
    print(f"mode={mode}")
    for table, count in result.items():
        print(f"{table}={count}")


if __name__ == "__main__":
    main()
