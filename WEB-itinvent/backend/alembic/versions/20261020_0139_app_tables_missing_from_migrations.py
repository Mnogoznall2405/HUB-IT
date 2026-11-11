"""Create the app tables that no earlier migration created (employee absences, AI bots/KB, transfer-act jobs).

Revision ID: 20261020_0139
Revises: 20261020_0138

Eight ORM tables were only ever created by the development-time `create_all` (see
`appdb/db.py`): `employee_absences`, `ai_bots`, `ai_bot_conversations`, `ai_bot_runs`,
`ai_pending_actions`, `ai_kb_documents`, `ai_kb_chunks`, `transfer_act_jobs`. A database built from
migrations alone (new stand, restore, clean install) therefore lacked them. This revision is the
prerequisite for turning the development DDL off.

Safe against production, where the tables may already exist: every step is "create if missing"
(table, then each non-unique index by name). Existing tables, data and constraints are never
altered. Unique constraints are created only together with a newly created table.

Downgrade is intentionally a no-op: on a database that predates this revision the tables hold live
data created outside Alembic, so dropping them on downgrade would destroy it.
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20261020_0139"
down_revision = "20261020_0138"
branch_labels = None
depends_on = None


# Frozen copy of the models at the time of this revision (never import the live ORM models here).
TABLES = (
    {
        "name": "employee_absences",
        "columns": lambda: (
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True, nullable=False),
            sa.Column("user_id", sa.Integer(), nullable=True),
            sa.Column("display_name", sa.String(length=255), nullable=False),
            sa.Column("department", sa.String(length=255), nullable=True),
            sa.Column("kind", sa.String(length=32), nullable=False),
            sa.Column("starts_on", sa.Date(), nullable=False),
            sa.Column("ends_on", sa.Date(), nullable=False),
            sa.Column("comment", sa.String(length=500), nullable=True),
            sa.Column("source", sa.String(length=32), nullable=False),
            sa.Column("created_by", sa.Integer(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        ),
        "uniques": (),
        "indexes": (
            ("ix_app_employee_absences_range", ['starts_on', 'ends_on']),
            ("ix_app_employee_absences_user_id", ['user_id']),
        ),
    },
    {
        "name": "ai_bots",
        "columns": lambda: (
            sa.Column("id", sa.String(length=64), primary_key=True, nullable=False),
            sa.Column("slug", sa.String(length=80), nullable=False),
            sa.Column("title", sa.String(length=255), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("system_prompt", sa.Text(), nullable=False),
            sa.Column("model", sa.String(length=255), nullable=False),
            sa.Column("temperature", sa.Float(), nullable=False),
            sa.Column("max_tokens", sa.Integer(), nullable=False),
            sa.Column("allowed_kb_scope_json", sa.Text(), nullable=False),
            sa.Column("enabled_tools_json", sa.Text(), nullable=False),
            sa.Column("tool_settings_json", sa.Text(), nullable=False),
            sa.Column("allow_file_input", sa.Boolean(), nullable=False),
            sa.Column("allow_generated_artifacts", sa.Boolean(), nullable=False),
            sa.Column("allow_kb_document_delivery", sa.Boolean(), nullable=False),
            sa.Column("surface", sa.String(length=32), nullable=False),
            sa.Column("placement", sa.String(length=24), nullable=False),
            sa.Column("sort_order", sa.Integer(), nullable=False),
            sa.Column("required_permission", sa.String(length=128), nullable=False),
            sa.Column("use_personal_memory", sa.Boolean(), nullable=False),
            sa.Column("is_enabled", sa.Boolean(), nullable=False),
            sa.Column("bot_user_id", sa.Integer(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        ),
        "uniques": (("uq_app_ai_bots_slug", ['slug']),),
        "indexes": (
            ("ix_app_ai_bots_bot_user_id", ['bot_user_id']),
            ("ix_app_ai_bots_is_enabled", ['is_enabled']),
            ("ix_app_ai_bots_placement", ['placement']),
            ("ix_app_ai_bots_slug", ['slug']),
            ("ix_app_ai_bots_surface", ['surface']),
        ),
    },
    {
        "name": "ai_bot_conversations",
        "columns": lambda: (
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True, nullable=False),
            sa.Column("bot_id", sa.String(length=64), nullable=False),
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("conversation_id", sa.String(length=36), nullable=False),
            sa.Column("rolling_summary", sa.Text(), nullable=False),
            sa.Column("summary_until_seq", sa.BigInteger(), nullable=False),
            sa.Column("context_reset_seq", sa.BigInteger(), nullable=False),
            sa.Column("use_personal_memory", sa.Boolean(), nullable=False),
            sa.Column("title_source", sa.String(length=24), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        ),
        "uniques": (("uq_app_ai_bot_conversations_conversation", ['conversation_id']),),
        "indexes": (
            ("ix_app_ai_bot_conversations_bot_id", ['bot_id']),
            ("ix_app_ai_bot_conversations_conversation_id", ['conversation_id']),
            ("ix_app_ai_bot_conversations_user_bot_updated", ['user_id', 'bot_id', 'updated_at']),
            ("ix_app_ai_bot_conversations_user_id", ['user_id']),
        ),
    },
    {
        "name": "ai_bot_runs",
        "columns": lambda: (
            sa.Column("id", sa.String(length=64), primary_key=True, nullable=False),
            sa.Column("bot_id", sa.String(length=64), nullable=False),
            sa.Column("conversation_id", sa.String(length=36), nullable=False),
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("trigger_message_id", sa.String(length=36), nullable=False),
            sa.Column("status", sa.String(length=24), nullable=False),
            sa.Column("stage", sa.String(length=64), nullable=True),
            sa.Column("status_text", sa.Text(), nullable=True),
            sa.Column("error_text", sa.Text(), nullable=True),
            sa.Column("request_json", sa.Text(), nullable=False),
            sa.Column("result_json", sa.Text(), nullable=False),
            sa.Column("usage_json", sa.Text(), nullable=False),
            sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        ),
        "uniques": (),
        "indexes": (
            ("ix_app_ai_bot_runs_bot_conversation_created_at", ['bot_id', 'conversation_id', 'created_at']),
            ("ix_app_ai_bot_runs_bot_id", ['bot_id']),
            ("ix_app_ai_bot_runs_conversation_id", ['conversation_id']),
            ("ix_app_ai_bot_runs_status", ['status']),
            ("ix_app_ai_bot_runs_status_created_at", ['status', 'created_at']),
            ("ix_app_ai_bot_runs_trigger_message_id", ['trigger_message_id']),
            ("ix_app_ai_bot_runs_user_id", ['user_id']),
        ),
    },
    {
        "name": "transfer_act_jobs",
        "columns": lambda: (
            sa.Column("id", sa.String(length=64), primary_key=True, nullable=False),
            sa.Column("operation", sa.String(length=32), nullable=False),
            sa.Column("status", sa.String(length=24), nullable=False),
            sa.Column("status_text", sa.Text(), nullable=False),
            sa.Column("db_id", sa.String(length=128), nullable=True),
            sa.Column("user_id", sa.Integer(), nullable=True),
            sa.Column("username", sa.String(length=50), nullable=False),
            sa.Column("request_count", sa.Integer(), nullable=False),
            sa.Column("payload_json", sa.Text(), nullable=False),
            sa.Column("result_json", sa.Text(), nullable=False),
            sa.Column("error_text", sa.Text(), nullable=True),
            sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        ),
        "uniques": (),
        "indexes": (
            ("ix_app_transfer_act_jobs_db_id", ['db_id']),
            ("ix_app_transfer_act_jobs_operation", ['operation']),
            ("ix_app_transfer_act_jobs_status", ['status']),
            ("ix_app_transfer_act_jobs_status_created_at", ['status', 'created_at']),
            ("ix_app_transfer_act_jobs_user_created_at", ['user_id', 'created_at']),
            ("ix_app_transfer_act_jobs_user_id", ['user_id']),
        ),
    },
    {
        "name": "ai_pending_actions",
        "columns": lambda: (
            sa.Column("id", sa.String(length=64), primary_key=True, nullable=False),
            sa.Column("action_type", sa.String(length=64), nullable=False),
            sa.Column("status", sa.String(length=24), nullable=False),
            sa.Column("conversation_id", sa.String(length=36), nullable=False),
            sa.Column("run_id", sa.String(length=64), nullable=False),
            sa.Column("message_id", sa.String(length=36), nullable=True),
            sa.Column("requester_user_id", sa.Integer(), nullable=False),
            sa.Column("database_id", sa.String(length=128), nullable=True),
            sa.Column("payload_json", sa.Text(), nullable=False),
            sa.Column("preview_json", sa.Text(), nullable=False),
            sa.Column("result_json", sa.Text(), nullable=False),
            sa.Column("error_text", sa.Text(), nullable=True),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("executed_by_user_id", sa.Integer(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        ),
        "uniques": (),
        "indexes": (
            ("ix_app_ai_pending_actions_action_type", ['action_type']),
            ("ix_app_ai_pending_actions_conversation_id", ['conversation_id']),
            ("ix_app_ai_pending_actions_database_id", ['database_id']),
            ("ix_app_ai_pending_actions_executed_by_user_id", ['executed_by_user_id']),
            ("ix_app_ai_pending_actions_message_id", ['message_id']),
            ("ix_app_ai_pending_actions_requester_user_id", ['requester_user_id']),
            ("ix_app_ai_pending_actions_run_id", ['run_id']),
            ("ix_app_ai_pending_actions_run_status", ['run_id', 'status']),
            ("ix_app_ai_pending_actions_status", ['status']),
            ("ix_app_ai_pending_actions_status_expires_at", ['status', 'expires_at']),
        ),
    },
    {
        "name": "ai_kb_documents",
        "columns": lambda: (
            sa.Column("id", sa.String(length=64), primary_key=True, nullable=False),
            sa.Column("kb_article_id", sa.String(length=64), nullable=False),
            sa.Column("title", sa.String(length=255), nullable=False),
            sa.Column("status", sa.String(length=32), nullable=False),
            sa.Column("content_hash", sa.String(length=128), nullable=False),
            sa.Column("payload_json", sa.Text(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        ),
        "uniques": (("uq_app_ai_kb_documents_article", ['kb_article_id']),),
        "indexes": (
            ("ix_app_ai_kb_documents_status", ['status']),
        ),
    },
    {
        "name": "ai_kb_chunks",
        "columns": lambda: (
            sa.Column("id", sa.String(length=64), primary_key=True, nullable=False),
            sa.Column("document_id", sa.String(length=64), nullable=False),
            sa.Column("kb_article_id", sa.String(length=64), nullable=False),
            sa.Column("chunk_index", sa.Integer(), nullable=False),
            sa.Column("title", sa.String(length=255), nullable=False),
            sa.Column("content", sa.Text(), nullable=False),
            sa.Column("metadata_json", sa.Text(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        ),
        "uniques": (),
        "indexes": (
            ("ix_app_ai_kb_chunks_document_id", ['document_id']),
            ("ix_app_ai_kb_chunks_document_id_chunk_index", ['document_id', 'chunk_index']),
            ("ix_app_ai_kb_chunks_kb_article_id", ['kb_article_id']),
        ),
    },
)


def _scope() -> str:
    return str(op.get_context().config.attributes.get("itinvent_scope", "all") or "all").strip().lower()


def _schema() -> str | None:
    return "app" if op.get_bind().dialect.name == "postgresql" else None


def _index_names(table: str, schema: str | None) -> set[str]:
    return {str(item.get("name") or "") for item in sa.inspect(op.get_bind()).get_indexes(table, schema=schema)}


def upgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()
    for spec in TABLES:
        name = spec["name"]
        if not sa.inspect(op.get_bind()).has_table(name, schema=schema):
            constraints = [sa.UniqueConstraint(*columns, name=unique_name) for unique_name, columns in spec["uniques"]]
            op.create_table(name, *spec["columns"](), *constraints, schema=schema)
        existing = _index_names(name, schema)
        for index_name, columns in spec["indexes"]:
            if index_name not in existing:
                op.create_index(index_name, name, list(columns), unique=False, schema=schema)
    if op.get_bind().dialect.name == "postgresql":
        # Full-text index of the KB retrieval (revision 20260427_0023 skipped it when the table did not exist yet).
        # concat_ws() is only STABLE, so PostgreSQL rejects it inside an index expression ("functions in index
        # expression must be marked IMMUTABLE"); this is the immutable equivalent, identical to the live index.
        op.execute(
            "CREATE INDEX IF NOT EXISTS ix_app_ai_kb_chunks_fts_simple ON app.ai_kb_chunks "
            "USING GIN (to_tsvector('simple'::regconfig, "
            "COALESCE(title, '')::text || ' ' || COALESCE(content, '')))"
        )


def downgrade() -> None:
    # Intentionally a no-op: see the module docstring (the tables may predate this revision and hold live data).
    return
