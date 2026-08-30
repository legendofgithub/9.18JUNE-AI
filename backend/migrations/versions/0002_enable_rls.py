"""Enable default-deny row level security on application tables.

Revision ID: 0002_enable_rls
Revises: 0001_initial_schema
Create Date: 2026-08-26
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0002_enable_rls"
down_revision: Union[str, None] = "0001_initial_schema"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _tables() -> list[str]:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return []
    return sorted(
        table
        for table in sa.inspect(bind).get_table_names()
        if table != "alembic_version"
    )


def _set_rls(enabled: bool) -> None:
    action = "ENABLE" if enabled else "DISABLE"
    for table in _tables():
        op.execute(f'ALTER TABLE "{table}" {action} ROW LEVEL SECURITY')


def upgrade() -> None:
    _set_rls(True)


def downgrade() -> None:
    _set_rls(False)
