"""Move chat event outbox schema ownership into Alembic."""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260502_0028"
down_revision = "20260501_0027"
branch_labels = None
depends_on = None


def _scope() -> str:
    return str(op.get_context().config.attributes.get("itinvent_scope", "all") or "all").strip().lower()


def _schema(name: str) -> str | None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        return name
    return None


def _has_table(schema: str | None, table_name: str) -> bool:
    return sa.inspect(op.get_bind()).has_table(table_name, schema=schema)


def _index_names(schema: str | None, table_name: str) -> set[str]:
    if not _has_table(schema, table_name):
        return set()
    return {
        str(item.get("name") or "").strip()
        for item in sa.inspect(op.get_bind()).get_indexes(table_name, schema=schema)
    }


def _unique_constraint_names(schema: str | None, table_name: str) -> set[str]:
    if not _has_table(schema, table_name):
        return set()
    return {
        str(item.get("name") or "").strip()
        for item in sa.inspect(op.get_bind()).get_unique_constraints(table_name, schema=schema)
    }


def _create_index_if_missing(
    index_names: set[str],
    name: str,
    table_name: str,
    columns: list[str],
    *,
    schema: str | None,
) -> None:
    if name in index_names:
        return
    op.create_index(name, table_name, columns, unique=False, schema=schema)
    index_names.add(name)


def upgrade() -> None:
    if _scope() == "app":
        return

    chat_schema = _schema("chat")
    table_name = "chat_event_outbox"
    table_exists = _has_table(chat_schema, table_name)
    if not table_exists:
        op.create_table(
            table_name,
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("event_type", sa.String(length=64), nullable=False),
            sa.Column("target_scope", sa.String(length=16), nullable=False),
            sa.Column("target_user_id", sa.Integer(), nullable=False),
            sa.Column("conversation_id", sa.String(length=36), nullable=True),
            sa.Column("message_id", sa.String(length=36), nullable=True),
            sa.Column("payload_json", sa.Text(), nullable=False),
            sa.Column("dedupe_key", sa.String(length=255), nullable=True),
            sa.Column("status", sa.String(length=32), nullable=False),
            sa.Column("attempt_count", sa.Integer(), nullable=False),
            sa.Column("next_attempt_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("last_error", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("dedupe_key", name="uq_chat_event_outbox_dedupe_key"),
            schema=chat_schema,
        )

    constraint_names = _unique_constraint_names(chat_schema, table_name)
    if op.get_bind().dialect.name != "sqlite" and "uq_chat_event_outbox_dedupe_key" not in constraint_names:
        op.create_unique_constraint(
            "uq_chat_event_outbox_dedupe_key",
            table_name,
            ["dedupe_key"],
            schema=chat_schema,
        )

    index_names = _index_names(chat_schema, table_name)
    _create_index_if_missing(index_names, "ix_chat_event_outbox_event_type", table_name, ["event_type"], schema=chat_schema)
    _create_index_if_missing(index_names, "ix_chat_event_outbox_target_user_id", table_name, ["target_user_id"], schema=chat_schema)
    _create_index_if_missing(index_names, "ix_chat_event_outbox_conversation_id", table_name, ["conversation_id"], schema=chat_schema)
    _create_index_if_missing(index_names, "ix_chat_event_outbox_message_id", table_name, ["message_id"], schema=chat_schema)
    _create_index_if_missing(index_names, "ix_chat_event_outbox_status", table_name, ["status"], schema=chat_schema)
    _create_index_if_missing(
        index_names,
        "ix_chat_event_outbox_status_next_attempt_at",
        table_name,
        ["status", "next_attempt_at"],
        schema=chat_schema,
    )
    _create_index_if_missing(
        index_names,
        "ix_chat_event_outbox_target_user_id_status",
        table_name,
        ["target_user_id", "status"],
        schema=chat_schema,
    )
    _create_index_if_missing(index_names, "ix_chat_event_outbox_updated_at", table_name, ["updated_at"], schema=chat_schema)


def downgrade() -> None:
    if _scope() == "app":
        return

    chat_schema = _schema("chat")
    table_name = "chat_event_outbox"
    if not _has_table(chat_schema, table_name):
        return

    index_names = _index_names(chat_schema, table_name)
    for index_name in (
        "ix_chat_event_outbox_updated_at",
        "ix_chat_event_outbox_target_user_id_status",
        "ix_chat_event_outbox_status_next_attempt_at",
        "ix_chat_event_outbox_status",
        "ix_chat_event_outbox_message_id",
        "ix_chat_event_outbox_conversation_id",
        "ix_chat_event_outbox_target_user_id",
        "ix_chat_event_outbox_event_type",
    ):
        if index_name in index_names:
            op.drop_index(index_name, table_name=table_name, schema=chat_schema)

    constraint_names = _unique_constraint_names(chat_schema, table_name)
    if op.get_bind().dialect.name != "sqlite" and "uq_chat_event_outbox_dedupe_key" in constraint_names:
        op.drop_constraint("uq_chat_event_outbox_dedupe_key", table_name, type_="unique", schema=chat_schema)
    op.drop_table(table_name, schema=chat_schema)
