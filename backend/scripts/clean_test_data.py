import argparse
import os
import sqlite3
from pathlib import Path

from backup import backup_directory, create_backup


CONFIRM_TOKEN = "CLEAN_JUNE_DATA"


def database_path() -> Path:
    configured = os.getenv("JUNE_DB_PATH", "").strip()
    if configured:
        return Path(configured).resolve()
    return Path(__file__).resolve().parent.parent / "june.db"


def placeholders(values) -> str:
    return ",".join("?" for _ in values)


def load_candidates(connection: sqlite3.Connection, emails: list[str], guests_only: bool, non_admin: bool) -> list[dict]:
    clauses = []
    params = []
    if emails:
        clauses.append(f"email IN ({placeholders(emails)})")
        params.extend(item.strip().lower() for item in emails)
    if guests_only:
        clauses.append("email LIKE 'guest-%@june.local'")
    if non_admin:
        clauses.append("is_admin = 0")
    if not clauses:
        return []
    query = f"""
        SELECT id, email, identity, display_name, is_admin
        FROM users
        WHERE {' OR '.join(clauses)}
        ORDER BY created_at
    """
    return [
        {"id": row[0], "email": row[1], "identity": row[2], "display_name": row[3], "is_admin": row[4]}
        for row in connection.execute(query, params).fetchall()
    ]


def owned_counts(connection: sqlite3.Connection, user_id: str) -> dict[str, int]:
    queries = {
        "orders": "SELECT COUNT(*) FROM orders WHERE owner_id = ?",
        "runs": "SELECT COUNT(*) FROM mvp_runs WHERE owner_id = ?",
        "modelServices": "SELECT COUNT(*) FROM model_services WHERE owner_id = ?",
        "analyticsEvents": "SELECT COUNT(*) FROM analytics_events WHERE owner_id = ?",
    }
    return {name: connection.execute(query, (user_id,)).fetchone()[0] for name, query in queries.items()}


def delete_user_data(connection: sqlite3.Connection, user_id: str) -> None:
    run_rows = connection.execute("SELECT id FROM mvp_runs WHERE owner_id = ?", (user_id,)).fetchall()
    run_ids = [row[0] for row in run_rows]
    if run_ids:
        values = placeholders(run_ids)
        connection.execute(f"DELETE FROM run_events WHERE run_id IN ({values})", run_ids)
        connection.execute(f"DELETE FROM run_artifacts WHERE run_id IN ({values})", run_ids)
        connection.execute(f"DELETE FROM run_steps WHERE run_id IN ({values})", run_ids)
        connection.execute(f"DELETE FROM thread_states WHERE session_id IN ({values})", run_ids)
        connection.execute(f"DELETE FROM messages WHERE session_id IN ({values})", run_ids)
        connection.execute(f"DELETE FROM threads WHERE session_id IN ({values})", run_ids)
        connection.execute(f"DELETE FROM files WHERE session_id IN ({values})", run_ids)
        connection.execute(f"DELETE FROM sessions WHERE id IN ({values})", run_ids)

    connection.execute(
        "DELETE FROM model_entries WHERE service_id IN (SELECT id FROM model_services WHERE owner_id = ?)",
        (user_id,),
    )
    connection.execute("DELETE FROM model_services WHERE owner_id = ?", (user_id,))
    connection.execute("DELETE FROM mvp_runs WHERE owner_id = ?", (user_id,))
    connection.execute("DELETE FROM installed_skills WHERE owner_id = ?", (user_id,))
    connection.execute("DELETE FROM payment_events WHERE order_id IN (SELECT id FROM orders WHERE owner_id = ?)", (user_id,))
    connection.execute("DELETE FROM orders WHERE owner_id = ?", (user_id,))
    connection.execute("DELETE FROM entitlements WHERE owner_id = ?", (user_id,))
    connection.execute("DELETE FROM analytics_events WHERE owner_id = ?", (user_id,))
    account = connection.execute("SELECT identity OR email FROM users WHERE id = ?", (user_id,)).fetchone()
    if account:
        connection.execute("DELETE FROM login_throttles WHERE account = ?", (account[0],))
    connection.execute("DELETE FROM users WHERE id = ?", (user_id,))


def reset_commerce_data(connection: sqlite3.Connection) -> None:
    """Remove test commerce/training data while retaining accounts and audit history."""
    run_ids = [row[0] for row in connection.execute("SELECT id FROM mvp_runs").fetchall()]
    if run_ids:
        values = placeholders(run_ids)
        connection.execute(f"DELETE FROM run_events WHERE run_id IN ({values})", run_ids)
        connection.execute(f"DELETE FROM run_artifacts WHERE run_id IN ({values})", run_ids)
        connection.execute(f"DELETE FROM run_steps WHERE run_id IN ({values})", run_ids)
        connection.execute(f"DELETE FROM thread_states WHERE session_id IN ({values})", run_ids)
        connection.execute(f"DELETE FROM messages WHERE session_id IN ({values})", run_ids)
        connection.execute(f"DELETE FROM threads WHERE session_id IN ({values})", run_ids)
        connection.execute(f"DELETE FROM files WHERE session_id IN ({values})", run_ids)
        connection.execute(f"DELETE FROM sessions WHERE id IN ({values})", run_ids)

    connection.execute("DELETE FROM model_entries")
    connection.execute("DELETE FROM model_services")
    connection.execute("DELETE FROM mvp_runs")
    connection.execute("DELETE FROM installed_skills")
    connection.execute("DELETE FROM payment_events")
    connection.execute("DELETE FROM orders")
    connection.execute("DELETE FROM entitlements")
    connection.execute("DELETE FROM analytics_events")


def main() -> None:
    parser = argparse.ArgumentParser(description="Remove selected local test users and their derived data")
    parser.add_argument("--db", type=Path, default=database_path())
    parser.add_argument("--email", action="append", default=[])
    parser.add_argument("--guests", action="store_true")
    parser.add_argument("--non-admin", action="store_true")
    parser.add_argument(
        "--reset-commerce",
        action="store_true",
        help="Remove all sandbox/test orders, entitlements, runs, and model-service keys; keep accounts",
    )
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--confirm", default="")
    args = parser.parse_args()

    if not (args.email or args.guests or args.non_admin or args.reset_commerce):
        parser.error("Select users with --email/--guests/--non-admin or use --reset-commerce")
    if not args.dry_run and args.confirm != CONFIRM_TOKEN:
        parser.error(f"Refusing to delete; pass --confirm {CONFIRM_TOKEN}")
    if not args.db.exists():
        parser.error(f"Database does not exist: {args.db}")

    os.environ["JUNE_DB_PATH"] = str(args.db)
    connection = sqlite3.connect(args.db)
    connection.execute("PRAGMA foreign_keys=ON")
    try:
        candidates = load_candidates(connection, args.email, args.guests, args.non_admin)
        print(f"Selected users: {len(candidates)}")
        for user in candidates:
            print(
                f"- {user['email']} ({user['display_name'] or user['identity'] or 'no name'}): "
                f"{owned_counts(connection, user['id'])}"
            )
        if args.dry_run:
            print("Dry run only; no rows were changed.")
            return
        if not candidates:
            return

        backup = create_backup()
        print(f"Backup created: {backup}")
        with connection:
            if args.reset_commerce:
                reset_commerce_data(connection)
                print("Reset commerce, training, model-service, and analytics data")
            for user in candidates:
                delete_user_data(connection, user["id"])
                print(f"Deleted data for {user['email']}")
        integrity = connection.execute("PRAGMA integrity_check").fetchone()[0]
        print(f"Integrity check: {integrity}")
        print(f"Backups are stored in: {backup_directory()}")
    finally:
        connection.close()


if __name__ == "__main__":
    main()
