# PostgreSQL — DDL snapshot (live introspection)

_Сгенерировано: 2026-11-24 11:29 UTC_  
_Источник: `APP_DATABASE_URL` → `postgresql+psycopg://postgres@127.0.0.1:55433/v31_mig` (`127.0.0.1:55433/v31_mig`)_

Автообновляется после `alembic upgrade` и dev-инициализации PostgreSQL. Обзор: [POSTGRES_APP_SCHEMA.md](./POSTGRES_APP_SCHEMA.md).

---

## Schema `app` (187 tables)

### `app._v31_probe_collab`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `file_id` **PK** | varchar(64) | no | `` |
| `user_id` | integer | no | `` |
| `created_at` | timestamptz | no | `` |
| `updated_at` | timestamptz | no | `` |

- **Primary key:** `file_id`

---

### `app.ad_user_branch_overrides`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `login` **PK** | varchar(255) | no | `` |
| `branch_no` | integer | no | `` |
| `updated_at` | timestamptz | no | `` |

- **Primary key:** `login`

---

### `app.agent_api_keys`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `agent_id` **PK** | varchar(255) | no | `` |
| `hostname` | varchar(255) | no | `''::character varying` |
| `scan_key_sha256` | varchar(64) | yes | `` |
| `scan_key_enc` | text | yes | `` |
| `inv_key_sha256` | varchar(64) | yes | `` |
| `inv_key_enc` | text | yes | `` |
| `source` | varchar(32) | no | `'auto'::character varying` |
| `created_at` | bigint | no | `` |
| `updated_at` | bigint | no | `` |
| `enroll_ip` | varchar(64) | no | `''::character varying` |
| `contested_count` | integer | no | `0` |

- **Primary key:** `agent_id`
- **Indexes:**
  - `ix_app_agent_api_keys_inv_sha` UNIQUE: (inv_key_sha256)
  - `ix_app_agent_api_keys_scan_sha` UNIQUE: (scan_key_sha256)

---

### `app.ai_bot_access`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `bot_id` **PK** | varchar(64) | no | `` |
| `user_id` **PK** | integer | no | `` |
| `allowed` | boolean | no | `false` |
| `updated_by` | integer | no | `` |
| `updated_at` | timestamptz | no | `` |

- **Primary key:** `bot_id, user_id`
- **Indexes:**
  - `ix_app_ai_bot_access_user_id`: (user_id)

---

### `app.ai_bot_conversations`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | integer | no | `nextval('app.ai_bot_conversations_id_seq'::regclass)` |
| `bot_id` | varchar(64) | no | `` |
| `user_id` | integer | no | `` |
| `conversation_id` | varchar(36) | no | `` |
| `rolling_summary` | text | no | `` |
| `summary_until_seq` | bigint | no | `` |
| `context_reset_seq` | bigint | no | `` |
| `rolling_summary_llm` | text | no | `''::text` |
| `summary_llm_until_seq` | bigint | no | `'0'::bigint` |
| `last_run_seq` | bigint | no | `'0'::bigint` |
| `use_personal_memory` | boolean | no | `` |
| `title_source` | varchar(24) | no | `` |
| `created_at` | timestamptz | no | `` |
| `updated_at` | timestamptz | no | `` |

- **Primary key:** `id`
- **Indexes:**
  - `ix_app_ai_bot_conversations_bot_id`: (bot_id)
  - `ix_app_ai_bot_conversations_conversation_id`: (conversation_id)
  - `ix_app_ai_bot_conversations_user_bot_updated`: (user_id, bot_id, updated_at)
  - `ix_app_ai_bot_conversations_user_id`: (user_id)
  - `uq_app_ai_bot_conversations_conversation` UNIQUE: (conversation_id)

---

### `app.ai_bot_runs`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | varchar(64) | no | `` |
| `bot_id` | varchar(64) | no | `` |
| `conversation_id` | varchar(36) | no | `` |
| `user_id` | integer | no | `` |
| `trigger_message_id` | varchar(36) | no | `` |
| `status` | varchar(24) | no | `` |
| `stage` | varchar(64) | yes | `` |
| `status_text` | text | yes | `` |
| `error_text` | text | yes | `` |
| `request_json` | text | no | `` |
| `result_json` | text | no | `` |
| `usage_json` | text | no | `` |
| `started_at` | timestamptz | yes | `` |
| `completed_at` | timestamptz | yes | `` |
| `queue_seq` | bigint | yes | `` |
| `created_at` | timestamptz | no | `` |
| `updated_at` | timestamptz | no | `` |

- **Primary key:** `id`
- **Indexes:**
  - `ix_app_ai_bot_runs_bot_conversation_created_at`: (bot_id, conversation_id, created_at)
  - `ix_app_ai_bot_runs_bot_id`: (bot_id)
  - `ix_app_ai_bot_runs_conversation_id`: (conversation_id)
  - `ix_app_ai_bot_runs_conversation_status_queue_seq`: (conversation_id, status, queue_seq)
  - `ix_app_ai_bot_runs_status`: (status)
  - `ix_app_ai_bot_runs_status_created_at`: (status, created_at)
  - `ix_app_ai_bot_runs_trigger_message_id`: (trigger_message_id)
  - `ix_app_ai_bot_runs_user_id`: (user_id)
  - `uq_app_ai_bot_runs_running_conversation` UNIQUE: (conversation_id)

---

### `app.ai_bots`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | varchar(64) | no | `` |
| `slug` | varchar(80) | no | `` |
| `title` | varchar(255) | no | `` |
| `description` | text | yes | `` |
| `system_prompt` | text | no | `` |
| `model` | varchar(255) | no | `` |
| `temperature` | double precision | no | `` |
| `max_tokens` | integer | no | `` |
| `allowed_kb_scope_json` | text | no | `` |
| `enabled_tools_json` | text | no | `` |
| `tool_settings_json` | text | no | `` |
| `allow_file_input` | boolean | no | `` |
| `allow_generated_artifacts` | boolean | no | `` |
| `allow_kb_document_delivery` | boolean | no | `` |
| `surface` | varchar(32) | no | `` |
| `placement` | varchar(24) | no | `` |
| `sort_order` | integer | no | `` |
| `required_permission` | varchar(128) | no | `` |
| `use_personal_memory` | boolean | no | `` |
| `is_enabled` | boolean | no | `` |
| `bot_user_id` | integer | yes | `` |
| `created_at` | timestamptz | no | `` |
| `updated_at` | timestamptz | no | `` |

- **Primary key:** `id`
- **Indexes:**
  - `ix_app_ai_bots_bot_user_id`: (bot_user_id)
  - `ix_app_ai_bots_is_enabled`: (is_enabled)
  - `ix_app_ai_bots_placement`: (placement)
  - `ix_app_ai_bots_slug`: (slug)
  - `ix_app_ai_bots_surface`: (surface)
  - `uq_app_ai_bots_slug` UNIQUE: (slug)

---

### `app.ai_kb_chunks`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | varchar(64) | no | `` |
| `document_id` | varchar(64) | no | `` |
| `kb_article_id` | varchar(64) | no | `` |
| `chunk_index` | integer | no | `` |
| `title` | varchar(255) | no | `` |
| `content` | text | no | `` |
| `metadata_json` | text | no | `` |
| `created_at` | timestamptz | no | `` |
| `updated_at` | timestamptz | no | `` |

- **Primary key:** `id`
- **Indexes:**
  - `ix_app_ai_kb_chunks_document_id`: (document_id)
  - `ix_app_ai_kb_chunks_document_id_chunk_index`: (document_id, chunk_index)
  - `ix_app_ai_kb_chunks_fts_simple`: ((expression))
  - `ix_app_ai_kb_chunks_kb_article_id`: (kb_article_id)

---

### `app.ai_kb_documents`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | varchar(64) | no | `` |
| `kb_article_id` | varchar(64) | no | `` |
| `title` | varchar(255) | no | `` |
| `status` | varchar(32) | no | `` |
| `content_hash` | varchar(128) | no | `` |
| `payload_json` | text | no | `` |
| `created_at` | timestamptz | no | `` |
| `updated_at` | timestamptz | no | `` |

- **Primary key:** `id`
- **Indexes:**
  - `ix_app_ai_kb_documents_status`: (status)
  - `uq_app_ai_kb_documents_article` UNIQUE: (kb_article_id)

---

### `app.ai_memory_events`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | varchar(64) | no | `` |
| `user_id` | integer | no | `` |
| `conversation_id` | varchar(36) | no | `` |
| `message_id` | varchar(64) | no | `` |
| `conversation_seq` | bigint | no | `'0'::bigint` |
| `status` | varchar(24) | no | `` |
| `changes_json` | text | no | `'[]'::text` |
| `created_at` | timestamptz | no | `` |

- **Primary key:** `id`
- **Indexes:**
  - `ix_app_ai_memory_events_user_conversation_seq`: (user_id, conversation_id, conversation_seq)
  - `uq_app_ai_memory_events_user_message` UNIQUE: (user_id, message_id)

---

### `app.ai_memory_facts`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `memory_id` **PK** | varchar(64) | no | `` |
| `user_id` | integer | no | `` |
| `fact_key` | varchar(96) | no | `` |
| `version` | integer | no | `1` |

- **Primary key:** `memory_id`
- **Indexes:**
  - `ix_app_ai_memory_facts_user_id`: (user_id)
  - `uq_app_ai_memory_facts_user_key` UNIQUE: (user_id, fact_key)

---

### `app.ai_memory_state`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `user_id` **PK** | integer | no | `nextval('app.ai_memory_state_user_id_seq'::regclass)` |
| `revision` | bigint | no | `'0'::bigint` |
| `write_barrier_at` | timestamptz | yes | `` |

- **Primary key:** `user_id`

---

### `app.ai_pending_actions`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | varchar(64) | no | `` |
| `action_type` | varchar(64) | no | `` |
| `status` | varchar(24) | no | `` |
| `conversation_id` | varchar(36) | no | `` |
| `run_id` | varchar(64) | no | `` |
| `message_id` | varchar(36) | yes | `` |
| `requester_user_id` | integer | no | `` |
| `database_id` | varchar(128) | yes | `` |
| `payload_json` | text | no | `` |
| `preview_json` | text | no | `` |
| `result_json` | text | no | `` |
| `error_text` | text | yes | `` |
| `expires_at` | timestamptz | no | `` |
| `executed_by_user_id` | integer | yes | `` |
| `created_at` | timestamptz | no | `` |
| `updated_at` | timestamptz | no | `` |

- **Primary key:** `id`
- **Indexes:**
  - `ix_app_ai_pending_actions_action_type`: (action_type)
  - `ix_app_ai_pending_actions_conversation_id`: (conversation_id)
  - `ix_app_ai_pending_actions_database_id`: (database_id)
  - `ix_app_ai_pending_actions_executed_by_user_id`: (executed_by_user_id)
  - `ix_app_ai_pending_actions_message_id`: (message_id)
  - `ix_app_ai_pending_actions_requester_user_id`: (requester_user_id)
  - `ix_app_ai_pending_actions_run_id`: (run_id)
  - `ix_app_ai_pending_actions_run_status`: (run_id, status)
  - `ix_app_ai_pending_actions_status`: (status)
  - `ix_app_ai_pending_actions_status_expires_at`: (status, expires_at)

---

### `app.ai_sandbox_files`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | varchar(64) | no | `` |
| `session_id` | varchar(64) | no | `` |
| `job_id` | varchar(64) | no | `` |
| `conversation_id` | varchar(36) | no | `` |
| `relative_path` | varchar(1024) | no | `` |
| `file_name` | varchar(255) | no | `` |
| `file_kind` | varchar(24) | no | `` |
| `content_type` | varchar(255) | no | `'application/octet-stream'::character varying` |
| `size_bytes` | bigint | no | `'0'::bigint` |
| `sha256` | varchar(64) | no | `''::character varying` |
| `is_changed` | boolean | no | `false` |
| `diff_text` | text | no | `''::text` |
| `source_message_id` | varchar(36) | yes | `` |
| `source_attachment_id` | varchar(36) | yes | `` |
| `chat_message_id` | varchar(36) | yes | `` |
| `chat_attachment_id` | varchar(36) | yes | `` |
| `delivery_status` | varchar(24) | no | `'not_applicable'::character varying` |
| `created_at` | timestamptz | no | `` |
| `updated_at` | timestamptz | no | `` |

- **Primary key:** `id`
- **Foreign keys:**
  - `job_id` → `app.ai_sandbox_jobs` (`id`)
  - `session_id` → `app.ai_sandbox_sessions` (`id`)
- **Indexes:**
  - `ix_app_ai_sandbox_files_conversation_id`: (conversation_id)
  - `ix_app_ai_sandbox_files_file_kind`: (file_kind)
  - `ix_app_ai_sandbox_files_job_id`: (job_id)
  - `ix_app_ai_sandbox_files_session_id`: (session_id)
  - `ix_app_ai_sandbox_files_session_kind`: (session_id, file_kind, created_at)
  - `uq_app_ai_sandbox_files_job_path` UNIQUE: (job_id, relative_path)

---

### `app.ai_sandbox_gateway_grants`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | varchar(64) | no | `` |
| `job_id` | varchar(64) | no | `` |
| `session_id` | varchar(64) | no | `` |
| `user_id` | integer | no | `` |
| `token_hash` | varchar(64) | no | `` |
| `status` | varchar(24) | no | `'active'::character varying` |
| `request_count` | integer | no | `0` |
| `max_requests` | integer | no | `128` |
| `expires_at` | timestamptz | no | `` |
| `last_used_at` | timestamptz | yes | `` |
| `revoked_at` | timestamptz | yes | `` |
| `created_at` | timestamptz | no | `` |
| `updated_at` | timestamptz | no | `` |

- **Primary key:** `id`
- **Foreign keys:**
  - `job_id` → `app.ai_sandbox_jobs` (`id`)
  - `session_id` → `app.ai_sandbox_sessions` (`id`)
- **Indexes:**
  - `ix_app_ai_sandbox_gateway_grants_expires_at`: (expires_at)
  - `ix_app_ai_sandbox_gateway_grants_expiry`: (status, expires_at)
  - `ix_app_ai_sandbox_gateway_grants_job_id`: (job_id)
  - `ix_app_ai_sandbox_gateway_grants_job_status`: (job_id, status)
  - `ix_app_ai_sandbox_gateway_grants_session_id`: (session_id)
  - `ix_app_ai_sandbox_gateway_grants_status`: (status)
  - `ix_app_ai_sandbox_gateway_grants_user_id`: (user_id)
  - `uq_app_ai_sandbox_gateway_grants_token_hash` UNIQUE: (token_hash)

---

### `app.ai_sandbox_jobs`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | varchar(64) | no | `` |
| `session_id` | varchar(64) | no | `` |
| `conversation_id` | varchar(36) | no | `` |
| `user_id` | integer | no | `` |
| `prompt_message_id` | varchar(36) | no | `''::character varying` |
| `job_type` | varchar(24) | no | `'prompt'::character varying` |
| `target_file_id` | varchar(64) | yes | `` |
| `status` | varchar(24) | no | `'preparing'::character varying` |
| `attempt` | integer | no | `0` |
| `claimed_by` | varchar(128) | yes | `` |
| `claimed_at` | timestamptz | yes | `` |
| `heartbeat_at` | timestamptz | yes | `` |
| `deadline_at` | timestamptz | no | `` |
| `result_json` | text | no | `'{}'::text` |
| `finalization_state` | varchar(24) | no | `'not_required'::character varying` |
| `finalization_markdown` | text | no | `''::text` |
| `assistant_message_id` | varchar(36) | yes | `` |
| `cleanup_terminal_status` | varchar(24) | yes | `` |
| `error_code` | varchar(64) | no | `''::character varying` |
| `started_at` | timestamptz | yes | `` |
| `completed_at` | timestamptz | yes | `` |
| `created_at` | timestamptz | no | `` |
| `updated_at` | timestamptz | no | `` |

- **Primary key:** `id`
- **Foreign keys:**
  - `session_id` → `app.ai_sandbox_sessions` (`id`)
- **Indexes:**
  - `ix_app_ai_sandbox_jobs_conversation_id`: (conversation_id)
  - `ix_app_ai_sandbox_jobs_deadline_at`: (deadline_at)
  - `ix_app_ai_sandbox_jobs_finalization`: (status, finalization_state, updated_at)
  - `ix_app_ai_sandbox_jobs_finalization_state`: (finalization_state)
  - `ix_app_ai_sandbox_jobs_heartbeat`: (status, heartbeat_at)
  - `ix_app_ai_sandbox_jobs_job_type`: (job_type)
  - `ix_app_ai_sandbox_jobs_prompt_message_id`: (prompt_message_id)
  - `ix_app_ai_sandbox_jobs_session_created`: (session_id, created_at)
  - `ix_app_ai_sandbox_jobs_session_id`: (session_id)
  - `ix_app_ai_sandbox_jobs_status`: (status)
  - `ix_app_ai_sandbox_jobs_status_created`: (status, created_at)
  - `ix_app_ai_sandbox_jobs_user_id`: (user_id)
  - `uq_app_ai_sandbox_jobs_message_type` UNIQUE: (conversation_id, prompt_message_id, job_type)
  - `uq_app_ai_sandbox_jobs_one_active_per_user` UNIQUE: (user_id)

---

### `app.ai_sandbox_permissions`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | varchar(64) | no | `` |
| `session_id` | varchar(64) | no | `` |
| `job_id` | varchar(64) | no | `` |
| `user_id` | integer | no | `` |
| `opencode_permission_id` | varchar(200) | no | `` |
| `tool` | varchar(64) | no | `` |
| `operation` | varchar(128) | no | `''::character varying` |
| `arguments_preview_json` | text | no | `'{}'::text` |
| `action_id` | varchar(64) | yes | `` |
| `status` | varchar(24) | no | `'pending'::character varying` |
| `grant_scope` | varchar(16) | yes | `` |
| `responded_by_user_id` | integer | yes | `` |
| `requested_at` | timestamptz | no | `` |
| `responded_at` | timestamptz | yes | `` |
| `created_at` | timestamptz | no | `` |
| `updated_at` | timestamptz | no | `` |

- **Primary key:** `id`
- **Foreign keys:**
  - `job_id` → `app.ai_sandbox_jobs` (`id`)
  - `session_id` → `app.ai_sandbox_sessions` (`id`)
- **Indexes:**
  - `ix_app_ai_sandbox_permissions_action_id`: (action_id)
  - `ix_app_ai_sandbox_permissions_job_id`: (job_id)
  - `ix_app_ai_sandbox_permissions_session_id`: (session_id)
  - `ix_app_ai_sandbox_permissions_status`: (status)
  - `ix_app_ai_sandbox_permissions_user_id`: (user_id)
  - `ix_app_ai_sandbox_permissions_user_status`: (user_id, status, requested_at)
  - `uq_app_ai_sandbox_permissions_opencode` UNIQUE: (session_id, opencode_permission_id)

---

### `app.ai_sandbox_sessions`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | varchar(64) | no | `` |
| `conversation_id` | varchar(36) | no | `` |
| `user_id` | integer | no | `` |
| `workspace_key` | varchar(128) | no | `` |
| `opencode_session_id` | varchar(200) | yes | `` |
| `status` | varchar(24) | no | `'new'::character varying` |
| `credential_ref` | varchar(255) | no | `''::character varying` |
| `purge_token` | varchar(64) | yes | `` |
| `last_activity_at` | timestamptz | no | `` |
| `expires_at` | timestamptz | no | `` |
| `created_at` | timestamptz | no | `` |
| `updated_at` | timestamptz | no | `` |

- **Primary key:** `id`
- **Indexes:**
  - `ix_app_ai_sandbox_sessions_conversation_id`: (conversation_id)
  - `ix_app_ai_sandbox_sessions_expiry`: (status, expires_at)
  - `ix_app_ai_sandbox_sessions_status`: (status)
  - `ix_app_ai_sandbox_sessions_user_activity`: (user_id, last_activity_at)
  - `ix_app_ai_sandbox_sessions_user_id`: (user_id)
  - `uq_app_ai_sandbox_sessions_conversation` UNIQUE: (conversation_id)
  - `uq_app_ai_sandbox_sessions_workspace_key` UNIQUE: (workspace_key)

---

### `app.ai_sandbox_transfer_grants`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | varchar(64) | no | `` |
| `job_id` | varchar(64) | no | `` |
| `file_id` | varchar(64) | no | `` |
| `user_id` | integer | no | `` |
| `direction` | varchar(24) | no | `` |
| `token_hash` | varchar(64) | no | `` |
| `status` | varchar(24) | no | `'issued'::character varying` |
| `expires_at` | timestamptz | no | `` |
| `consumed_at` | timestamptz | yes | `` |
| `created_at` | timestamptz | no | `` |
| `updated_at` | timestamptz | no | `` |

- **Primary key:** `id`
- **Foreign keys:**
  - `file_id` → `app.ai_sandbox_files` (`id`)
  - `job_id` → `app.ai_sandbox_jobs` (`id`)
- **Indexes:**
  - `ix_app_ai_sandbox_transfer_grants_expires_at`: (expires_at)
  - `ix_app_ai_sandbox_transfer_grants_expiry`: (status, expires_at)
  - `ix_app_ai_sandbox_transfer_grants_file_id`: (file_id)
  - `ix_app_ai_sandbox_transfer_grants_job`: (job_id, created_at)
  - `ix_app_ai_sandbox_transfer_grants_job_id`: (job_id)
  - `ix_app_ai_sandbox_transfer_grants_status`: (status)
  - `ix_app_ai_sandbox_transfer_grants_user_id`: (user_id)
  - `uq_app_ai_sandbox_transfer_grants_token_hash` UNIQUE: (token_hash)

---

### `app.ai_user_memories`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | varchar(64) | no | `` |
| `user_id` | integer | no | `` |
| `category` | varchar(48) | no | `'preference'::character varying` |
| `content` | text | no | `` |
| `normalized_hash` | varchar(64) | no | `` |
| `is_active` | boolean | no | `true` |
| `created_at` | timestamptz | no | `` |
| `updated_at` | timestamptz | no | `` |

- **Primary key:** `id`
- **Indexes:**
  - `ix_app_ai_user_memories_category`: (category)
  - `ix_app_ai_user_memories_is_active`: (is_active)
  - `ix_app_ai_user_memories_normalized_hash`: (normalized_hash)
  - `ix_app_ai_user_memories_user_active_updated`: (user_id, is_active, updated_at)
  - `ix_app_ai_user_memories_user_id`: (user_id)
  - `uq_app_ai_user_memories_user_hash` UNIQUE: (user_id, normalized_hash)

---

### `app.ai_user_memory_sources`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | integer | no | `nextval('app.ai_user_memory_sources_id_seq'::regclass)` |
| `memory_id` | varchar(64) | no | `` |
| `conversation_id` | varchar(36) | no | `` |
| `message_id` | varchar(36) | no | `` |
| `created_at` | timestamptz | no | `` |

- **Primary key:** `id`
- **Indexes:**
  - `ix_app_ai_user_memory_sources_conversation`: (conversation_id, created_at)
  - `ix_app_ai_user_memory_sources_conversation_id`: (conversation_id)
  - `ix_app_ai_user_memory_sources_memory_id`: (memory_id)
  - `ix_app_ai_user_memory_sources_message_id`: (message_id)
  - `uq_app_ai_user_memory_sources_memory_message` UNIQUE: (memory_id, message_id)

---

### `app.app_settings`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `key` **PK** | varchar(128) | no | `` |
| `value_json` | text | no | `` |
| `updated_at` | timestamptz | no | `` |

- **Primary key:** `key`

---

### `app.branch_work_schedules`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `branch_name` **PK** | varchar(255) | no | `` |
| `work_start_min` | integer | no | `540` |
| `work_end_min` | integer | no | `1080` |
| `lunch_start_min` | integer | yes | `` |
| `lunch_end_min` | integer | yes | `` |
| `tz_offset_minutes` | integer | no | `0` |
| `workdays_mask` | integer | no | `31` |
| `updated_by` | varchar(255) | no | `''::character varying` |
| `updated_at` | timestamptz | no | `` |

- **Primary key:** `branch_name`

---

### `app.browser_probe_focus_events`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `event_key` **PK** | varchar(64) | no | `` |
| `received_at` | timestamptz | no | `` |

- **Primary key:** `event_key`

---

### `app.browser_probe_media`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | varchar(512) | no | `` |
| `computer_name` | varchar(255) | no | `` |
| `file_name` | varchar(512) | no | `` |
| `content` | bytea | yes | `` |
| `content_type` | varchar(128) | no | `'application/octet-stream'::character varying` |
| `created_at` | timestamptz | no | `` |
| `storage_path` | varchar(1024) | yes | `` |

- **Primary key:** `id`
- **Indexes:**
  - `ix_app_browser_probe_media_computer`: (computer_name)
  - `ix_app_browser_probe_media_created_at`: (created_at)
  - `uq_app_browser_probe_media_host_file` UNIQUE: (computer_name, file_name)

---

### `app.browser_probe_visits`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | varchar(512) | no | `` |
| `computer_name` | varchar(255) | no | `` |
| `windows_user` | varchar(255) | no | `''::character varying` |
| `browser` | varchar(32) | no | `''::character varying` |
| `profile` | varchar(128) | no | `''::character varying` |
| `visit_id` | varchar(64) | no | `''::character varying` |
| `url` | text | no | `''::text` |
| `title` | varchar(512) | no | `''::character varying` |
| `domain` | varchar(255) | no | `''::character varying` |
| `category` | varchar(32) | no | `'other'::character varying` |
| `visited_at` | timestamptz | yes | `` |
| `dwell_sec` | double precision | yes | `` |
| `screenshot_file` | varchar(512) | no | `''::character varying` |
| `created_at` | timestamptz | no | `` |
| `idle_sec` | double precision | yes | `` |

- **Primary key:** `id`
- **Indexes:**
  - `ix_app_browser_probe_hist_latest`: (computer_name, browser, visited_at)
  - `ix_app_browser_probe_visits_category`: (category)
  - `ix_app_browser_probe_visits_computer_visited`: (computer_name, visited_at)
  - `ix_app_browser_probe_visits_visited_computer`: (visited_at, computer_name)
  - `uq_app_browser_probe_visits_host_visit` UNIQUE: (computer_name, browser, profile, visit_id)

---

### `app.construction_day_crews`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `object_id` **PK** | varchar(64) | no | `` |
| `work_date` **PK** | date | no | `` |
| `version` | integer | no | `` |
| `payload_json` | text | no | `` |

- **Primary key:** `object_id, work_date`

---

### `app.construction_direction_role_assignments`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | integer | no | `nextval('app.construction_direction_role_assignments_id_seq'::regclass)` |
| `object_id` | varchar(64) | no | `` |
| `group_ref` | varchar(64) | no | `` |
| `role_key` | varchar(32) | no | `` |
| `employee_code` | varchar(128) | no | `` |
| `employee_name` | varchar(255) | no | `` |
| `employee_position` | varchar(255) | no | `''::character varying` |
| `employee_department` | varchar(255) | no | `''::character varying` |
| `employee_department_location` | varchar(255) | no | `''::character varying` |
| `valid_from` | timestamptz | no | `now()` |
| `valid_to` | timestamptz | yes | `` |
| `assigned_by_user_id` | integer | no | `` |
| `created_at` | timestamptz | no | `now()` |

- **Primary key:** `id`
- **Indexes:**
  - `ix_app_construction_direction_roles_employee`: (employee_code)
  - `ix_app_construction_direction_roles_object_group`: (object_id, group_ref, role_key)
  - `uq_app_construction_direction_active_role` UNIQUE: (object_id, group_ref, role_key)

---

### `app.construction_object_1c_groups`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | integer | no | `nextval('app.construction_object_1c_groups_id_seq'::regclass)` |
| `object_id` | varchar(64) | no | `` |
| `group_ref` | varchar(64) | no | `` |
| `group_name` | varchar(255) | no | `''::character varying` |
| `created_by_user_id` | integer | no | `` |
| `created_at` | timestamptz | no | `now()` |

- **Primary key:** `id`
- **Indexes:**
  - `ix_app_construction_object_1c_groups_object`: (object_id)
  - `uq_app_construction_object_1c_group_ref` UNIQUE: (group_ref)

---

### `app.construction_object_role_assignments`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | integer | no | `nextval('app.construction_object_role_assignments_id_seq'::regclass)` |
| `object_id` | varchar(64) | no | `` |
| `role_key` | varchar(32) | no | `` |
| `employee_code` | varchar(128) | no | `` |
| `employee_name` | varchar(255) | no | `` |
| `employee_position` | varchar(255) | no | `''::character varying` |
| `employee_department` | varchar(255) | no | `''::character varying` |
| `employee_department_location` | varchar(255) | no | `''::character varying` |
| `valid_from` | timestamptz | no | `now()` |
| `valid_to` | timestamptz | yes | `` |
| `assigned_by_user_id` | integer | no | `` |
| `created_at` | timestamptz | no | `now()` |

- **Primary key:** `id`
- **Indexes:**
  - `ix_app_construction_object_roles_employee`: (employee_code)
  - `ix_app_construction_object_roles_object`: (object_id, role_key)
  - `uq_app_construction_object_active_role` UNIQUE: (object_id, role_key)

---

### `app.construction_objects`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | varchar(64) | no | `` |
| `name` | varchar(255) | no | `` |
| `is_active` | boolean | no | `true` |
| `created_by_user_id` | integer | no | `` |
| `updated_by_user_id` | integer | no | `` |
| `created_at` | timestamptz | no | `now()` |
| `updated_at` | timestamptz | no | `now()` |

- **Primary key:** `id`
- **Indexes:**
  - `ix_app_construction_objects_active_name`: (is_active, name)

---

### `app.construction_planning_audit`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | integer | no | `nextval('app.construction_planning_audit_id_seq'::regclass)` |
| `object_id` | varchar(64) | no | `` |
| `period` | date | no | `` |
| `kind` | varchar(16) | no | `` |
| `actor_user_id` | integer | no | `` |
| `actor_name` | varchar(255) | no | `` |
| `changed_at` | timestamptz | no | `` |
| `before_json` | text | no | `` |
| `after_json` | text | no | `` |

- **Primary key:** `id`
- **Indexes:**
  - `ix_construction_planning_audit_scope`: (object_id, period, id)

---

### `app.construction_week_plans`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `object_id` **PK** | varchar(64) | no | `` |
| `week_start` **PK** | date | no | `` |
| `version` | integer | no | `` |
| `payload_json` | text | no | `` |
| `baseline_json` | text | no | `` |

- **Primary key:** `object_id, week_start`

---

### `app.construction_work_audit`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | integer | no | `nextval('app.construction_work_audit_id_seq'::regclass)` |
| `work_id` | varchar(36) | no | `` |
| `actor_user_id` | integer | no | `` |
| `actor_name` | varchar(255) | no | `` |
| `changed_at` | timestamptz | no | `` |
| `action` | varchar(16) | no | `` |
| `before_json` | text | no | `` |
| `after_json` | text | no | `` |

- **Primary key:** `id`
- **Foreign keys:**
  - `work_id` → `app.construction_work_items` (`id`)
- **Indexes:**
  - `ix_app_construction_work_audit`: (work_id, id)

---

### `app.construction_work_entries`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | integer | no | `nextval('app.construction_work_entries_id_seq'::regclass)` |
| `work_id` | varchar(36) | no | `` |
| `work_date` | date | no | `` |
| `quantity` | numeric | no | `` |
| `details_json` | text | no | `` |

- **Primary key:** `id`
- **Foreign keys:**
  - `work_id` → `app.construction_work_items` (`id`)
- **Indexes:**
  - `uq_app_construction_work_day` UNIQUE: (work_id, work_date)

---

### `app.construction_work_items`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | varchar(36) | no | `` |
| `object_id` | varchar(64) | no | `` |
| `group_ref` | varchar(64) | no | `` |
| `plan_json` | text | no | `` |
| `version` | integer | no | `` |

- **Primary key:** `id`
- **Indexes:**
  - `ix_app_construction_work_scope`: (object_id, group_ref)

---

### `app.department_memberships`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | integer | no | `nextval('app.department_memberships_id_seq'::regclass)` |
| `department_id` | varchar(64) | no | `` |
| `user_id` | integer | no | `` |
| `role` | varchar(32) | no | `'member'::character varying` |
| `source` | varchar(32) | no | `'manual'::character varying` |
| `is_active` | boolean | no | `true` |
| `created_at` | timestamptz | no | `` |
| `updated_at` | timestamptz | no | `` |

- **Primary key:** `id`
- **Indexes:**
  - `ix_app_department_memberships_department_active`: (department_id, is_active)
  - `ix_app_department_memberships_user_active`: (user_id, is_active)
  - `uq_app_department_membership_role` UNIQUE: (department_id, user_id, role)

---

### `app.departments`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | varchar(64) | no | `` |
| `name` | varchar(255) | no | `` |
| `source` | varchar(32) | no | `'manual'::character varying` |
| `is_active` | boolean | no | `true` |
| `created_at` | timestamptz | no | `` |
| `updated_at` | timestamptz | no | `` |

- **Primary key:** `id`
- **Indexes:**
  - `ix_departments_is_active`: (is_active)
  - `ix_departments_name`: (name)

---

### `app.desktop_presence`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `session_id` **PK** | varchar(64) | no | `` |
| `user_id` | integer | no | `` |
| `created_at` | timestamptz | no | `now()` |
| `last_seen_at` | timestamptz | no | `now()` |
| `expires_at` | timestamptz | no | `` |

- **Primary key:** `session_id`
- **Indexes:**
  - `ix_app_desktop_presence_expires_at`: (expires_at)
  - `ix_app_desktop_presence_user_expires`: (user_id, expires_at)
  - `ix_app_desktop_presence_user_id`: (user_id)

---

### `app.dlp_activity_buckets`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `computer_name` **PK** | varchar(255) | no | `` |
| `windows_user` **PK** | varchar(255) | no | `` |
| `bucket_start` **PK** | timestamptz | no | `` |
| `active_sec` | double precision | no | `'0'::double precision` |
| `passive_sec` | double precision | no | `'0'::double precision` |
| `away_sec` | double precision | no | `'0'::double precision` |
| `locked_sec` | double precision | no | `'0'::double precision` |
| `apps` | json | yes | `` |
| `updated_at` | timestamptz | no | `` |

- **Primary key:** `computer_name, windows_user, bucket_start`
- **Indexes:**
  - `ix_app_dlp_activity_buckets_bucket_start`: (bucket_start)
  - `ix_app_dlp_activity_buckets_computer_start`: (computer_name, bucket_start)

---

### `app.docflow_audit_events`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | varchar(64) | no | `` |
| `user_id` | integer | no | `` |
| `event_type` | varchar(64) | no | `` |
| `outcome` | varchar(32) | no | `` |
| `error_code` | varchar(64) | yes | `` |
| `correlation_id` | varchar(64) | no | `` |
| `created_at` | timestamptz | no | `` |

- **Primary key:** `id`
- **Indexes:**
  - `ix_app_docflow_audit_events_correlation_id`: (correlation_id)
  - `ix_app_docflow_audit_events_event_type`: (event_type)
  - `ix_app_docflow_audit_events_user_id`: (user_id)
  - `ix_app_docflow_audit_user_created`: (user_id, created_at)

---

### `app.docflow_commands`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | varchar(64) | no | `` |
| `user_id` | integer | no | `` |
| `idempotency_key` | varchar(128) | no | `` |
| `request_hash` | varchar(64) | no | `` |
| `task_ref` | varchar(36) | no | `` |
| `action` | varchar(32) | no | `` |
| `status` | varchar(32) | no | `'pending'::character varying` |
| `outcome` | varchar(32) | yes | `` |
| `state_token_hash` | varchar(64) | no | `` |
| `error_code` | varchar(64) | yes | `` |
| `correlation_id` | varchar(64) | no | `` |
| `remote_before_json` | text | no | `'{}'::text` |
| `remote_after_json` | text | no | `'{}'::text` |
| `created_at` | timestamptz | no | `` |
| `updated_at` | timestamptz | no | `` |
| `completed_at` | timestamptz | yes | `` |

- **Primary key:** `id`
- **Indexes:**
  - `ix_app_docflow_command_status_updated`: (status, updated_at)
  - `ix_app_docflow_command_user_created`: (user_id, created_at)
  - `ix_app_docflow_commands_correlation_id`: (correlation_id)
  - `ix_app_docflow_commands_status`: (status)
  - `ix_app_docflow_commands_task_ref`: (task_ref)
  - `ix_app_docflow_commands_user_id`: (user_id)
  - `uq_app_docflow_command_user_key` UNIQUE: (user_id, idempotency_key)

---

### `app.docflow_credentials`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `user_id` **PK** | integer | no | `nextval('app.docflow_credentials_user_id_seq'::regclass)` |
| `login` | varchar(128) | no | `` |
| `password_enc` | text | no | `` |
| `key_version` | integer | no | `1` |
| `credential_version` | integer | no | `1` |
| `status` | varchar(32) | no | `'configured'::character varying` |
| `last_error_code` | varchar(64) | yes | `` |
| `last_verified_at` | timestamptz | yes | `` |
| `created_at` | timestamptz | no | `` |
| `updated_at` | timestamptz | no | `` |

- **Primary key:** `user_id`
- **Indexes:**
  - `ix_app_docflow_credentials_status`: (status)

---

### `app.document_preview_jobs`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | varchar(64) | no | `` |
| `scope` | varchar(32) | no | `` |
| `owner_user_id` | integer | no | `` |
| `resource_key` | varchar(64) | no | `` |
| `source_payload_json` | text | no | `'{}'::text` |
| `status` | varchar(20) | no | `'queued'::character varying` |
| `attempt_count` | integer | no | `0` |
| `next_attempt_at` | timestamptz | no | `` |
| `lease_owner` | varchar(96) | yes | `` |
| `lease_expires_at` | timestamptz | yes | `` |
| `artifact_rel_path` | text | no | `''::text` |
| `source_filename` | varchar(512) | no | `''::character varying` |
| `content_type` | varchar(255) | no | `'application/octet-stream'::character varying` |
| `pdf_filename` | varchar(512) | no | `''::character varying` |
| `source_kind` | varchar(32) | no | `''::character varying` |
| `page_count` | integer | no | `0` |
| `sheets_json` | text | no | `'[]'::text` |
| `last_error` | text | no | `''::text` |
| `created_at` | timestamptz | no | `` |
| `updated_at` | timestamptz | no | `` |
| `ready_at` | timestamptz | yes | `` |
| `expires_at` | timestamptz | no | `` |

- **Primary key:** `id`
- **Indexes:**
  - `ix_app_document_preview_jobs_expires`: (expires_at)
  - `ix_app_document_preview_jobs_lease`: (lease_expires_at)
  - `ix_app_document_preview_jobs_status_next`: (status, next_attempt_at)
  - `uq_app_document_preview_jobs_resource` UNIQUE: (scope, owner_user_id, resource_key)

---

### `app.employee_absences`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | integer | no | `nextval('app.employee_absences_id_seq'::regclass)` |
| `user_id` | integer | yes | `` |
| `display_name` | varchar(255) | no | `` |
| `department` | varchar(255) | yes | `` |
| `kind` | varchar(32) | no | `` |
| `starts_on` | date | no | `` |
| `ends_on` | date | no | `` |
| `comment` | varchar(500) | yes | `` |
| `source` | varchar(32) | no | `` |
| `created_by` | integer | yes | `` |
| `created_at` | timestamptz | no | `` |
| `updated_at` | timestamptz | no | `` |

- **Primary key:** `id`
- **Indexes:**
  - `ix_app_employee_absences_range`: (starts_on, ends_on)
  - `ix_app_employee_absences_user_id`: (user_id)

---

### `app.equipment_one_c_marks`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | integer | no | `nextval('app.equipment_one_c_marks_id_seq'::regclass)` |
| `db_id` | varchar(128) | no | `` |
| `inv_no` | varchar(64) | no | `` |
| `marked_by` | varchar(128) | no | `''::character varying` |
| `marked_at` | timestamptz | no | `CURRENT_TIMESTAMP` |
| `note` | varchar(500) | no | `''::character varying` |
| `kind` | varchar(16) | no | `'ok'::character varying` |
| `part_no_snapshot` | varchar(200) | yes | `` |
| `model_snapshot` | varchar(255) | yes | `` |

- **Primary key:** `id`
- **Indexes:**
  - `uq_app_equipment_one_c_marks_db_inv` UNIQUE: (db_id, inv_no)

---

### `app.equipment_photo_checks`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | integer | no | `nextval('app.equipment_photo_checks_id_seq'::regclass)` |
| `db_id` | varchar(128) | no | `` |
| `item_id` | integer | no | `` |
| `file_no` | integer | no | `` |
| `file_created_at` | varchar(64) | no | `` |
| `uploaded_by_user_id` | integer | yes | `` |
| `uploaded_by_name` | varchar(255) | yes | `` |
| `verified_by_user_id` | integer | yes | `` |
| `verified_by_name` | varchar(255) | yes | `` |
| `verified_at` | timestamptz | yes | `` |
| `created_at` | timestamptz | no | `` |
| `rejected_by_user_id` | integer | yes | `` |
| `rejected_by_name` | varchar(255) | yes | `` |
| `rejected_at` | timestamptz | yes | `` |
| `reject_reason` | varchar(500) | yes | `` |

- **Primary key:** `id`
- **Indexes:**
  - `ix_app_equipment_photo_checks_db_item`: (db_id, item_id)
  - `uq_app_equipment_photo_checks_db_item_file` UNIQUE: (db_id, item_id, file_no)

---

### `app.equipment_photo_ocr`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | integer | no | `nextval('app.equipment_photo_ocr_id_seq'::regclass)` |
| `db_id` | varchar(128) | no | `` |
| `item_id` | integer | no | `` |
| `file_no` | integer | no | `` |
| `file_created_at` | varchar(64) | no | `` |
| `photo_type` | varchar(16) | no | `` |
| `serials_json` | text | no | `` |
| `model` | varchar(128) | no | `` |
| `tokens_in` | integer | no | `` |
| `tokens_out` | integer | no | `` |
| `analyzed_at` | timestamptz | no | `` |

- **Primary key:** `id`
- **Indexes:**
  - `ix_app_equipment_photo_ocr_db_item`: (db_id, item_id)
  - `uq_app_equipment_photo_ocr_db_item_file` UNIQUE: (db_id, item_id, file_no)

---

### `app.equipment_photo_upload_ledger`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `upload_id` **PK** | varchar(64) | no | `` |
| `item_id` | integer | no | `` |
| `created_by` | varchar(64) | no | `''::character varying` |
| `state` | varchar(16) | no | `'inserting'::character varying` |
| `file_no` | integer | yes | `` |
| `started_at` | timestamptz | no | `now()` |
| `updated_at` | timestamptz | no | `now()` |

- **Primary key:** `upload_id`
- **Indexes:**
  - `ix_app_equipment_photo_upload_ledger_item`: (item_id, state)

---

### `app.equipment_recent_acts`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | integer | no | `nextval('app.equipment_recent_acts_id_seq'::regclass)` |
| `user_id` | integer | no | `` |
| `db_id` | varchar(128) | no | `` |
| `doc_no` | integer | no | `` |
| `doc_number` | varchar(128) | no | `` |
| `last_action` | varchar(64) | no | `` |
| `last_action_label` | varchar(120) | no | `` |
| `snapshot_json` | text | no | `` |
| `activity_count` | integer | no | `` |
| `created_at` | timestamptz | no | `` |
| `last_activity_at` | timestamptz | no | `` |

- **Primary key:** `id`
- **Indexes:**
  - `ix_app_equipment_recent_acts_user_activity`: (user_id, last_activity_at)
  - `ix_app_equipment_recent_acts_user_db_activity`: (user_id, db_id, last_activity_at)
  - `ix_equipment_recent_acts_user_id`: (user_id)
  - `uq_app_equipment_recent_acts_user_db_doc` UNIQUE: (user_id, db_id, doc_no)

---

### `app.equipment_recent_cards`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | integer | no | `nextval('app.equipment_recent_cards_id_seq'::regclass)` |
| `user_id` | integer | no | `` |
| `db_id` | varchar(128) | no | `` |
| `inv_no` | varchar(64) | no | `` |
| `last_action` | varchar(64) | no | `` |
| `last_action_label` | varchar(120) | no | `` |
| `snapshot_json` | text | no | `` |
| `activity_count` | integer | no | `` |
| `created_at` | timestamptz | no | `` |
| `last_activity_at` | timestamptz | no | `` |

- **Primary key:** `id`
- **Indexes:**
  - `ix_app_equipment_recent_cards_user_activity`: (user_id, last_activity_at)
  - `ix_app_equipment_recent_cards_user_db_activity`: (user_id, db_id, last_activity_at)
  - `ix_equipment_recent_cards_user_id`: (user_id)
  - `uq_app_equipment_recent_cards_user_db_inv` UNIQUE: (user_id, db_id, inv_no)

---

### `app.equipment_transfer_act_reminder_groups`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | text | no | `` |
| `reminder_id` | text | no | `` |
| `generated_act_id` | text | yes | `` |
| `old_employee_name` | text | no | `` |
| `inv_nos_json` | text | no | `'[]'::text` |
| `equipment_count` | integer | no | `0` |
| `matched_doc_no` | integer | yes | `` |
| `matched_doc_number` | text | yes | `` |
| `completed_at` | text | yes | `` |

- **Primary key:** `id`
- **Foreign keys:**
  - `reminder_id` → `app.equipment_transfer_act_reminders` (`reminder_id`)
- **Indexes:**
  - `idx_equipment_transfer_act_reminder_groups_reminder`: (reminder_id)

---

### `app.equipment_transfer_act_reminders`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `reminder_id` **PK** | text | no | `` |
| `task_id` | text | no | `` |
| `db_id` | text | yes | `` |
| `assignee_user_id` | integer | no | `` |
| `controller_user_id` | integer | no | `` |
| `created_by_user_id` | integer | no | `` |
| `new_employee_no` | text | yes | `` |
| `new_employee_name` | text | no | `` |
| `status` | text | no | `'open'::text` |
| `created_at` | text | no | `` |
| `updated_at` | text | no | `` |
| `completed_at` | text | yes | `` |

- **Primary key:** `reminder_id`
- **Indexes:**
  - `idx_equipment_transfer_act_reminders_assignee_status`: (assignee_user_id, status, updated_at)
  - `idx_equipment_transfer_act_reminders_db_status`: (db_id, status, updated_at)
  - `idx_equipment_transfer_act_reminders_task_id` UNIQUE: (task_id)

---

### `app.feedback_suggestions`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | varchar(36) | no | `` |
| `user_id` | integer | no | `` |
| `category` | varchar(32) | no | `` |
| `title` | varchar(120) | no | `` |
| `message` | text | no | `` |
| `section` | varchar(64) | yes | `` |
| `status` | varchar(32) | no | `'new'::character varying` |
| `admin_note` | varchar(1000) | yes | `` |
| `handled_by_user_id` | integer | yes | `` |
| `created_at` | timestamptz | no | `now()` |
| `updated_at` | timestamptz | no | `now()` |

- **Primary key:** `id`
- **Indexes:**
  - `ix_app_feedback_suggestions_status_created`: (status, created_at)
  - `ix_app_feedback_suggestions_user_created`: (user_id, created_at)

---

### `app.file_left_events`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | varchar(64) | no | `` |
| `ts` | integer | no | `` |
| `channel` | varchar(32) | no | `` |
| `file_name` | varchar(512) | no | `` |
| `dest_path` | text | no | `` |
| `src_path` | text | no | `''::text` |
| `size` | bigint | yes | `` |
| `sha256` | varchar(64) | no | `''::character varying` |
| `windows_user` | varchar(255) | no | `''::character varying` |
| `computer_name` | varchar(255) | no | `''::character varying` |
| `details_json` | text | no | `'{}'::text` |
| `created_at` | timestamptz | no | `` |

- **Primary key:** `id`
- **Indexes:**
  - `ix_app_file_left_events_channel_ts`: (channel, ts)
  - `ix_app_file_left_events_computer_ts`: (computer_name, ts)
  - `ix_app_file_left_events_ts`: (ts)

---

### `app.hub_announcement_attachments`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | text | no | `` |
| `announcement_id` | text | no | `` |
| `file_name` | text | no | `` |
| `file_path` | text | no | `` |
| `file_mime` | text | yes | `` |
| `file_size` | integer | no | `` |
| `uploaded_by_user_id` | integer | no | `` |
| `uploaded_by_username` | text | no | `` |
| `uploaded_at` | text | no | `` |
| `sort_order` | integer | no | `0` |
| `is_cover` | integer | no | `0` |

- **Primary key:** `id`
- **Indexes:**
  - `idx_hub_announcement_attachments_announcement`: (announcement_id, uploaded_at)

---

### `app.hub_announcement_bookmarks`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `announcement_id` **PK** | text | no | `` |
| `user_id` **PK** | integer | no | `` |
| `created_at` | text | no | `` |

- **Primary key:** `announcement_id, user_id`
- **Indexes:**
  - `idx_hub_bookmarks_user`: (user_id, created_at)

---

### `app.hub_announcement_categories`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | text | no | `` |
| `name` | text | no | `` |
| `slug` | text | no | `` |
| `is_active` | integer | no | `1` |
| `created_by_user_id` | integer | no | `` |
| `created_at` | text | no | `` |
| `updated_at` | text | no | `` |

- **Primary key:** `id`
- **Indexes:**
  - `hub_announcement_categories_slug_key` UNIQUE: (slug)

---

### `app.hub_announcement_comment_attachments`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | text | no | `` |
| `comment_id` | text | no | `` |
| `announcement_id` | text | no | `` |
| `file_name` | text | no | `` |
| `file_path` | text | no | `` |
| `file_mime` | text | yes | `` |
| `file_size` | integer | no | `` |
| `uploaded_by_user_id` | integer | no | `` |
| `uploaded_at` | text | no | `` |

- **Primary key:** `id`
- **Indexes:**
  - `idx_hub_comment_attachments_comment`: (comment_id, uploaded_at)

---

### `app.hub_announcement_comment_mentions`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `comment_id` **PK** | text | no | `` |
| `user_id` **PK** | integer | no | `` |
| `username` | text | no | `''::text` |
| `full_name` | text | no | `''::text` |

- **Primary key:** `comment_id, user_id`

---

### `app.hub_announcement_comment_reactions`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `comment_id` **PK** | text | no | `` |
| `user_id` **PK** | integer | no | `` |
| `reaction_type` | text | no | `` |
| `username` | text | no | `''::text` |
| `full_name` | text | no | `''::text` |
| `created_at` | text | no | `` |
| `updated_at` | text | no | `` |

- **Primary key:** `comment_id, user_id`
- **Indexes:**
  - `idx_hub_comment_reactions_comment`: (comment_id, reaction_type)

---

### `app.hub_announcement_comments`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | text | no | `` |
| `announcement_id` | text | no | `` |
| `user_id` | integer | no | `` |
| `username` | text | no | `''::text` |
| `full_name` | text | no | `''::text` |
| `body` | text | no | `` |
| `created_at` | text | no | `` |
| `updated_at` | text | no | `` |
| `parent_comment_id` | text | yes | `` |
| `root_comment_id` | text | yes | `` |
| `reply_to_user_id` | integer | yes | `` |
| `reply_to_username` | text | no | `''::text` |
| `deleted_at` | text | yes | `` |
| `deleted_by_user_id` | integer | yes | `` |
| `change_version` | integer | no | `1` |

- **Primary key:** `id`
- **Indexes:**
  - `idx_hub_announcement_comments_announcement`: (announcement_id, created_at)
  - `idx_hub_comments_root`: (announcement_id, root_comment_id, created_at)

---

### `app.hub_announcement_likes`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `announcement_id` **PK** | text | no | `` |
| `user_id` **PK** | integer | no | `` |
| `username` | text | no | `''::text` |
| `full_name` | text | no | `''::text` |
| `created_at` | text | no | `` |

- **Primary key:** `announcement_id, user_id`
- **Indexes:**
  - `idx_hub_announcement_likes_announcement`: (announcement_id, created_at)

---

### `app.hub_announcement_poll_options`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | text | no | `` |
| `poll_id` | text | no | `` |
| `text` | text | no | `''::text` |
| `sort_order` | integer | no | `0` |

- **Primary key:** `id`
- **Indexes:**
  - `idx_hub_poll_options_poll`: (poll_id, sort_order)

---

### `app.hub_announcement_poll_votes`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `poll_id` **PK** | text | no | `` |
| `option_id` **PK** | text | no | `` |
| `user_id` **PK** | integer | no | `` |
| `created_at` | text | no | `` |

- **Primary key:** `poll_id, option_id, user_id`
- **Indexes:**
  - `idx_hub_poll_votes_option`: (option_id)
  - `idx_hub_poll_votes_poll_user`: (poll_id, user_id)

---

### `app.hub_announcement_polls`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | text | no | `` |
| `announcement_id` | text | no | `` |
| `question` | text | no | `''::text` |
| `allows_multiple` | integer | no | `0` |
| `is_anonymous` | integer | no | `0` |
| `closes_at` | text | yes | `` |
| `created_at` | text | no | `` |
| `updated_at` | text | no | `` |

- **Primary key:** `id`
- **Indexes:**
  - `hub_announcement_polls_announcement_id_key` UNIQUE: (announcement_id)

---

### `app.hub_announcement_reactions`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `announcement_id` **PK** | text | no | `` |
| `user_id` **PK** | integer | no | `` |
| `reaction_type` | text | no | `` |
| `username` | text | no | `''::text` |
| `full_name` | text | no | `''::text` |
| `created_at` | text | no | `` |
| `updated_at` | text | no | `` |

- **Primary key:** `announcement_id, user_id`
- **Indexes:**
  - `idx_hub_announcement_reactions_announcement`: (announcement_id, reaction_type)

---

### `app.hub_announcement_reads`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `announcement_id` **PK** | text | no | `` |
| `user_id` **PK** | integer | no | `` |
| `username` | text | no | `` |
| `full_name` | text | no | `` |
| `read_at` | text | no | `` |
| `seen_version` | integer | no | `` |
| `acknowledged_version` | integer | no | `` |
| `acknowledged_at` | text | yes | `` |

- **Primary key:** `announcement_id, user_id`

---

### `app.hub_announcement_tag_links`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `announcement_id` **PK** | text | no | `` |
| `tag_id` **PK** | text | no | `` |

- **Primary key:** `announcement_id, tag_id`
- **Indexes:**
  - `idx_hub_tag_links_tag`: (tag_id, announcement_id)

---

### `app.hub_announcement_tags`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | text | no | `` |
| `name` | text | no | `` |
| `slug` | text | no | `` |
| `created_at` | text | no | `` |

- **Primary key:** `id`
- **Indexes:**
  - `hub_announcement_tags_slug_key` UNIQUE: (slug)

---

### `app.hub_announcements`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | text | no | `` |
| `title` | text | no | `` |
| `preview` | text | no | `` |
| `body` | text | no | `` |
| `priority` | text | no | `` |
| `is_active` | integer | no | `` |
| `author_user_id` | integer | no | `` |
| `author_username` | text | no | `` |
| `author_full_name` | text | no | `` |
| `published_at` | text | no | `` |
| `updated_at` | text | no | `` |
| `version` | integer | no | `` |
| `audience_scope` | text | no | `` |
| `audience_roles` | text | no | `` |
| `audience_user_ids` | text | no | `` |
| `requires_ack` | integer | no | `` |
| `is_pinned` | integer | no | `` |
| `pinned_until` | text | yes | `` |
| `published_from` | text | yes | `` |
| `expires_at` | text | yes | `` |
| `status` | text | no | `'published'::text` |
| `comments_enabled` | integer | no | `1` |
| `reactions_enabled` | integer | no | `1` |
| `publication_notified_at` | text | yes | `` |
| `category_id` | text | yes | `` |
| `audience_department_codes` | text | no | `'[]'::text` |
| `audience_cities` | text | no | `'[]'::text` |

- **Primary key:** `id`
- **Indexes:**
  - `idx_hub_announcements_published`: (is_active, published_at)
  - `idx_hub_announcements_status_due`: (status, published_from)

---

### `app.hub_notification_reads`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `notification_id` **PK** | text | no | `` |
| `user_id` **PK** | integer | no | `` |
| `read_at` | text | no | `` |

- **Primary key:** `notification_id, user_id`

---

### `app.hub_notifications`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | text | no | `` |
| `recipient_user_id` | integer | yes | `` |
| `event_type` | text | no | `` |
| `title` | text | no | `` |
| `body` | text | no | `` |
| `entity_type` | text | no | `` |
| `entity_id` | text | no | `` |
| `created_at` | text | no | `` |

- **Primary key:** `id`
- **Indexes:**
  - `idx_hub_notifications_entity`: (entity_type, entity_id)
  - `idx_hub_notifications_recipient`: (recipient_user_id, created_at)
  - `idx_hub_notifications_retention`: (entity_type, created_at, id)

---

### `app.hub_task_attachment_previews`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `attachment_id` **PK** | text | no | `` |
| `task_id` | text | no | `` |
| `status` | varchar(20) | no | `'queued'::character varying` |
| `attempt_count` | integer | no | `0` |
| `next_attempt_at` | text | no | `` |
| `lease_owner` | varchar(64) | yes | `` |
| `lease_expires_at` | text | yes | `` |
| `artifact_rel_path` | text | no | `''::text` |
| `pdf_filename` | varchar(255) | no | `''::character varying` |
| `source_kind` | varchar(32) | no | `''::character varying` |
| `page_count` | integer | no | `0` |
| `sheets_json` | text | no | `'[]'::text` |
| `last_error` | text | no | `''::text` |
| `created_at` | text | no | `` |
| `updated_at` | text | no | `` |
| `ready_at` | text | yes | `` |

- **Primary key:** `attachment_id`
- **Foreign keys:**
  - `attachment_id` → `app.hub_task_attachments` (`id`)
- **Indexes:**
  - `idx_hub_task_attachment_previews_lease_expires`: (lease_expires_at)
  - `idx_hub_task_attachment_previews_status_next_attempt`: (status, next_attempt_at)
  - `idx_hub_task_attachment_previews_task`: (task_id)

---

### `app.hub_task_attachments`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | text | no | `` |
| `task_id` | text | no | `` |
| `scope` | text | no | `` |
| `file_name` | text | no | `` |
| `file_path` | text | no | `` |
| `file_mime` | text | yes | `` |
| `file_size` | integer | no | `` |
| `uploaded_by_user_id` | integer | no | `` |
| `uploaded_by_username` | text | no | `` |
| `uploaded_at` | text | no | `` |

- **Primary key:** `id`
- **Indexes:**
  - `idx_hub_task_attachments_task`: (task_id, uploaded_at)

---

### `app.hub_task_canvases`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `task_id` **PK** | text | no | `` |
| `scene_json` | text | no | `'{"elements":[],"appState":{},"files":{}}'::text` |
| `revision` | integer | no | `0` |
| `updated_by_user_id` | integer | yes | `` |
| `updated_by_username` | text | no | `''::text` |
| `created_at` | text | no | `` |
| `updated_at` | text | no | `` |

- **Primary key:** `task_id`

---

### `app.hub_task_comment_reads`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `task_id` **PK** | text | no | `` |
| `user_id` **PK** | integer | no | `` |
| `last_seen_comment_id` | text | yes | `` |
| `last_seen_at` | text | no | `` |

- **Primary key:** `task_id, user_id`
- **Indexes:**
  - `idx_hub_task_comment_reads_task`: (task_id, user_id)

---

### `app.hub_task_comments`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | text | no | `` |
| `task_id` | text | no | `` |
| `user_id` | integer | no | `` |
| `username` | text | no | `` |
| `full_name` | text | no | `` |
| `body` | text | no | `` |
| `created_at` | text | no | `` |

- **Primary key:** `id`
- **Indexes:**
  - `idx_hub_task_comments_task`: (task_id, created_at)

---

### `app.hub_task_email_outbox`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | varchar(36) | no | `` |
| `dedupe_key` | varchar(512) | no | `` |
| `task_id` | varchar(36) | yes | `` |
| `recipient_user_id` | integer | no | `` |
| `recipient_email` | varchar(320) | no | `` |
| `event_type` | varchar(80) | no | `` |
| `subject` | varchar(500) | no | `` |
| `body_text` | text | no | `` |
| `status` | varchar(32) | no | `'pending'::character varying` |
| `attempt_count` | integer | no | `0` |
| `available_at` | varchar(64) | no | `` |
| `created_at` | varchar(64) | no | `` |
| `updated_at` | varchar(64) | no | `` |
| `sent_at` | varchar(64) | yes | `` |
| `last_error` | text | no | `''::text` |
| `body_html` | text | no | `''::text` |

- **Primary key:** `id`
- **Indexes:**
  - `idx_hub_task_email_outbox_status`: (status, available_at, created_at)
  - `uq_hub_task_email_outbox_dedupe` UNIQUE: (dedupe_key)

---

### `app.hub_task_objects`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | text | no | `` |
| `project_id` | text | no | `` |
| `name` | text | no | `` |
| `code` | text | no | `''::text` |
| `description` | text | no | `''::text` |
| `is_active` | integer | no | `1` |
| `created_at` | text | no | `` |
| `updated_at` | text | no | `` |

- **Primary key:** `id`
- **Indexes:**
  - `idx_hub_task_objects_project`: (project_id, is_active, name)

---

### `app.hub_task_projects`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | text | no | `` |
| `name` | text | no | `` |
| `code` | text | no | `''::text` |
| `description` | text | no | `''::text` |
| `is_active` | integer | no | `1` |
| `created_at` | text | no | `` |
| `updated_at` | text | no | `` |

- **Primary key:** `id`
- **Indexes:**
  - `idx_hub_task_projects_active`: (is_active, name)

---

### `app.hub_task_reports`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | text | no | `` |
| `task_id` | text | no | `` |
| `comment` | text | no | `` |
| `file_name` | text | yes | `` |
| `file_path` | text | yes | `` |
| `file_mime` | text | yes | `` |
| `file_size` | integer | yes | `` |
| `uploaded_by_user_id` | integer | no | `` |
| `uploaded_by_username` | text | no | `` |
| `uploaded_at` | text | no | `` |

- **Primary key:** `id`

---

### `app.hub_task_status_log`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | text | no | `` |
| `task_id` | text | no | `` |
| `old_status` | text | no | `` |
| `new_status` | text | no | `` |
| `changed_by_user_id` | integer | no | `` |
| `changed_by_username` | text | no | `` |
| `changed_at` | text | no | `` |

- **Primary key:** `id`
- **Indexes:**
  - `idx_hub_task_status_log_task`: (task_id, changed_at)

---

### `app.hub_tasks`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | text | no | `` |
| `title` | text | no | `` |
| `description` | text | no | `` |
| `status` | text | no | `` |
| `due_at` | text | yes | `` |
| `assignee_user_id` | integer | no | `` |
| `assignee_username` | text | no | `` |
| `assignee_full_name` | text | no | `` |
| `controller_user_id` | integer | no | `` |
| `controller_username` | text | no | `` |
| `controller_full_name` | text | no | `` |
| `created_by_user_id` | integer | no | `` |
| `created_by_username` | text | no | `` |
| `created_by_full_name` | text | no | `` |
| `created_at` | text | no | `` |
| `updated_at` | text | no | `` |
| `submitted_at` | text | yes | `` |
| `reviewed_at` | text | yes | `` |
| `reviewer_user_id` | integer | yes | `` |
| `reviewer_username` | text | yes | `` |
| `review_comment` | text | yes | `` |
| `priority` | text | no | `` |
| `reviewer_full_name` | text | no | `` |
| `project_id` | text | yes | `` |
| `object_id` | text | yes | `` |
| `protocol_date` | text | yes | `` |
| `completed_at` | text | yes | `` |
| `completed_at_source` | text | yes | `` |
| `department_id` | varchar(64) | yes | `` |
| `visibility_scope` | varchar(32) | no | `'private'::character varying` |
| `checklist_items` | text | no | `'[]'::text` |
| `email_deadline_remind_hours` | integer | yes | `` |
| `observer_user_ids` | text | no | `'[]'::text` |
| `assignee_user_ids` | text | no | `'[]'::text` |
| `parent_task_id` | text | yes | `` |

- **Primary key:** `id`
- **Indexes:**
  - `idx_hub_tasks_assignee`: (assignee_user_id, status, updated_at)
  - `idx_hub_tasks_completed_at`: (completed_at)
  - `idx_hub_tasks_controller`: (controller_user_id, status, updated_at)
  - `idx_hub_tasks_created_by`: (created_by_user_id, status, updated_at)
  - `idx_hub_tasks_department`: (department_id, updated_at)
  - `idx_hub_tasks_due_at`: (due_at)
  - `idx_hub_tasks_object`: (object_id, updated_at)
  - `idx_hub_tasks_parent`: (parent_task_id)
  - `idx_hub_tasks_project`: (project_id, updated_at)
  - `idx_hub_tasks_protocol_date`: (protocol_date)
  - `idx_hub_tasks_title_trgm`: ((expression))

---

### `app.inventory_change_events`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `event_id` **PK** | varchar(160) | no | `` |
| `mac_address` | varchar(64) | yes | `` |
| `hostname` | varchar(255) | yes | `` |
| `detected_at` | integer | no | `` |
| `report_type` | varchar(32) | no | `'full_snapshot'::character varying` |
| `change_types_json` | text | no | `'[]'::text` |
| `diff_json` | text | no | `'{}'::text` |
| `before_json` | text | no | `'{}'::text` |
| `after_json` | text | no | `'{}'::text` |
| `created_at` | timestamptz | no | `` |

- **Primary key:** `event_id`
- **Indexes:**
  - `ix_inventory_change_events_detected_at`: (detected_at)
  - `ix_inventory_change_events_hostname`: (hostname)
  - `ix_inventory_change_events_mac_address`: (mac_address)

---

### `app.inventory_host_sql_contexts`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | integer | no | `nextval('app.inventory_host_sql_contexts_id_seq'::regclass)` |
| `mac_address` | varchar(64) | no | `''::character varying` |
| `hostname` | varchar(255) | no | `''::character varying` |
| `db_id` | varchar(128) | no | `''::character varying` |
| `branch_no` | varchar(64) | yes | `` |
| `branch_name` | varchar(255) | yes | `` |
| `location_name` | varchar(255) | yes | `` |
| `employee_name` | varchar(255) | yes | `` |
| `ip_address` | text | yes | `` |
| `updated_at` | timestamptz | no | `` |
| `inventory_inv_no` | varchar(64) | yes | `` |
| `inventory_model_name` | varchar(255) | yes | `` |

- **Primary key:** `id`
- **Indexes:**
  - `ix_app_inventory_host_sql_contexts_branch_name`: (branch_name)
  - `ix_app_inventory_host_sql_contexts_db_id`: (db_id)
  - `ix_app_inventory_host_sql_contexts_hostname`: (hostname)
  - `ix_app_inventory_host_sql_contexts_mac_address`: (mac_address)
  - `ix_app_inventory_sql_ctx_branch_trgm`: (branch_name)
  - `ix_app_inventory_sql_ctx_db_branch`: (db_id, branch_name)
  - `ix_app_inventory_sql_ctx_db_id_trgm`: (db_id)
  - `ix_app_inventory_sql_ctx_db_mac`: (db_id, mac_address)
  - `ix_app_inventory_sql_ctx_employee_trgm`: (employee_name)
  - `ix_app_inventory_sql_ctx_host_db`: (hostname, db_id)
  - `ix_app_inventory_sql_ctx_location_trgm`: (location_name)
  - `ix_app_inventory_sql_ctx_mac_db`: (mac_address, db_id)
  - `ix_app_inventory_sql_ctx_updated_at`: (updated_at)
  - `uq_app_inventory_host_sql_context` UNIQUE: (mac_address, hostname, db_id)

---

### `app.inventory_hosts`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `mac_address` **PK** | varchar(64) | no | `` |
| `hostname` | varchar(255) | yes | `` |
| `user_login` | varchar(255) | yes | `` |
| `user_full_name` | varchar(255) | yes | `` |
| `ip_primary` | varchar(64) | yes | `` |
| `report_type` | varchar(32) | no | `'full_snapshot'::character varying` |
| `last_seen_at` | integer | yes | `` |
| `last_full_snapshot_at` | integer | yes | `` |
| `payload_json` | text | no | `'{}'::text` |
| `updated_at` | timestamptz | no | `` |
| `hidden_at` | integer | yes | `` |
| `hidden_by` | varchar(255) | yes | `` |
| `hidden_reason` | varchar(255) | yes | `` |

- **Primary key:** `mac_address`
- **Indexes:**
  - `ix_app_inventory_hosts_hidden_at`: (hidden_at)
  - `ix_app_inventory_hosts_hostname_trgm`: (hostname)
  - `ix_app_inventory_hosts_ip_primary_trgm`: (ip_primary)
  - `ix_app_inventory_hosts_updated_at`: (updated_at)
  - `ix_app_inventory_hosts_user_full_name_trgm`: (user_full_name)
  - `ix_app_inventory_hosts_user_login_trgm`: (user_login)
  - `ix_inventory_hosts_hostname`: (hostname)
  - `ix_inventory_hosts_ip_primary`: (ip_primary)
  - `ix_inventory_hosts_last_seen_at`: (last_seen_at)
  - `ix_inventory_hosts_user_full_name`: (user_full_name)
  - `ix_inventory_hosts_user_login`: (user_login)

---

### `app.inventory_outlook_files`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | integer | no | `nextval('app.inventory_outlook_files_id_seq'::regclass)` |
| `mac_address` | varchar(64) | no | `` |
| `kind` | varchar(32) | no | `'archive'::character varying` |
| `file_path` | text | yes | `` |
| `file_type` | varchar(32) | yes | `` |
| `size_bytes` | bigint | no | `'0'::bigint` |
| `last_modified_at` | integer | yes | `` |
| `updated_at` | timestamptz | no | `` |

- **Primary key:** `id`
- **Indexes:**
  - `ix_app_inventory_outlook_file_path_trgm`: (file_path)
  - `ix_app_inventory_outlook_file_type_trgm`: (file_type)
  - `ix_app_inventory_outlook_files_file_path`: (file_path)
  - `ix_app_inventory_outlook_files_file_type`: (file_type)
  - `ix_app_inventory_outlook_files_kind`: (kind)
  - `ix_app_inventory_outlook_files_mac_address`: (mac_address)
  - `ix_app_inventory_outlook_files_size_bytes`: (size_bytes)
  - `ix_app_inventory_outlook_mac_kind`: (mac_address, kind)

---

### `app.inventory_user_profiles`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | integer | no | `nextval('app.inventory_user_profiles_id_seq'::regclass)` |
| `mac_address` | varchar(64) | no | `` |
| `user_name` | varchar(255) | yes | `` |
| `profile_path` | text | yes | `` |
| `total_size_bytes` | bigint | no | `'0'::bigint` |
| `files_count` | integer | no | `0` |
| `dirs_count` | integer | no | `0` |
| `errors_count` | integer | no | `0` |
| `partial` | boolean | no | `false` |
| `updated_at` | timestamptz | no | `` |

- **Primary key:** `id`
- **Indexes:**
  - `ix_app_inventory_profiles_mac_user`: (mac_address, user_name)
  - `ix_app_inventory_profiles_profile_path_trgm`: (profile_path)
  - `ix_app_inventory_profiles_user_name_trgm`: (user_name)
  - `ix_app_inventory_user_profiles_mac_address`: (mac_address)
  - `ix_app_inventory_user_profiles_profile_path`: (profile_path)
  - `ix_app_inventory_user_profiles_user_name`: (user_name)

---

### `app.it_object_audit`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | integer | no | `nextval('app.it_object_audit_id_seq'::regclass)` |
| `object_id` | varchar(64) | no | `` |
| `action` | varchar(40) | no | `` |
| `actor_user_id` | integer | no | `` |
| `target_user_id` | integer | yes | `` |
| `section` | varchar(32) | yes | `` |
| `level` | varchar(16) | yes | `` |
| `created_at` | timestamptz | no | `now()` |

- **Primary key:** `id`
- **Indexes:**
  - `ix_app_it_object_audit_object_created`: (object_id, created_at)

---

### `app.it_object_grants`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | integer | no | `nextval('app.it_object_grants_id_seq'::regclass)` |
| `object_id` | varchar(64) | no | `` |
| `user_id` | integer | no | `` |
| `user_name` | varchar(255) | no | `''::character varying` |
| `section` | varchar(32) | no | `` |
| `level` | varchar(16) | no | `` |
| `granted_by_user_id` | integer | no | `` |
| `created_at` | timestamptz | no | `now()` |
| `revoked_at` | timestamptz | yes | `` |
| `revoked_by_user_id` | integer | yes | `` |

- **Primary key:** `id`
- **Indexes:**
  - `ix_app_it_object_grants_user`: (user_id)
  - `uq_app_it_object_active_grant` UNIQUE: (object_id, user_id, section)

---

### `app.it_object_netmap_versions`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | integer | no | `nextval('app.it_object_netmap_versions_id_seq'::regclass)` |
| `object_id` | varchar(64) | no | `` |
| `version` | integer | no | `` |
| `file_name` | varchar(255) | no | `''::character varying` |
| `xml` | text | no | `''::text` |
| `saved_by_user_id` | integer | no | `` |
| `saved_by_name` | varchar(255) | no | `''::character varying` |
| `created_at` | timestamptz | no | `now()` |

- **Primary key:** `id`
- **Indexes:**
  - `ix_app_it_object_netmap_versions_obj`: (object_id)
  - `uq_app_it_object_netmap_versions_obj_ver` UNIQUE: (object_id, version)

---

### `app.it_object_netmaps`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | integer | no | `nextval('app.it_object_netmaps_id_seq'::regclass)` |
| `object_id` | varchar(64) | no | `` |
| `file_name` | varchar(255) | no | `''::character varying` |
| `xml` | text | no | `''::text` |
| `version` | integer | no | `1` |
| `updated_by_user_id` | integer | no | `` |
| `updated_by_name` | varchar(255) | no | `''::character varying` |
| `created_at` | timestamptz | no | `now()` |
| `updated_at` | timestamptz | no | `now()` |
| `preview_png` | bytea | yes | `` |

- **Primary key:** `id`
- **Indexes:**
  - `uq_app_it_object_netmaps_object` UNIQUE: (object_id)

---

### `app.it_object_owners`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | integer | no | `nextval('app.it_object_owners_id_seq'::regclass)` |
| `object_id` | varchar(64) | no | `` |
| `user_id` | integer | no | `` |
| `user_name` | varchar(255) | no | `''::character varying` |
| `valid_from` | timestamptz | no | `now()` |
| `valid_to` | timestamptz | yes | `` |
| `assigned_by_user_id` | integer | no | `` |

- **Primary key:** `id`
- **Indexes:**
  - `ix_app_it_object_owners_user`: (user_id)
  - `uq_app_it_object_active_owner` UNIQUE: (object_id)

---

### `app.it_object_password_links`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `entry_id` **PK** | varchar(64) | no | `` |
| `object_ref` | varchar(128) | no | `` |
| `created_by_user_id` | integer | no | `0` |
| `created_at` | timestamptz | no | `now()` |

- **Primary key:** `entry_id`
- **Indexes:**
  - `ix_app_it_object_password_links_object`: (object_ref)

---

### `app.it_object_role_assignments`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | integer | no | `nextval('app.it_object_role_assignments_id_seq'::regclass)` |
| `object_id` | varchar(64) | no | `` |
| `role_key` | varchar(32) | no | `` |
| `employee_code` | varchar(128) | no | `` |
| `employee_name` | varchar(255) | no | `` |
| `employee_position` | varchar(255) | no | `''::character varying` |
| `employee_department` | varchar(255) | no | `''::character varying` |
| `employee_department_location` | varchar(255) | no | `''::character varying` |
| `valid_from` | timestamptz | no | `now()` |
| `valid_to` | timestamptz | yes | `` |
| `assigned_by_user_id` | integer | no | `` |
| `created_at` | timestamptz | no | `now()` |

- **Primary key:** `id`
- **Indexes:**
  - `ix_app_it_object_roles_object`: (object_id, role_key)
  - `uq_app_it_object_active_role` UNIQUE: (object_id, role_key)

---

### `app.it_objects`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | varchar(64) | no | `` |
| `source_type` | varchar(32) | no | `` |
| `source_ref` | varchar(128) | no | `` |
| `name` | varchar(255) | no | `''::character varying` |
| `is_active` | boolean | no | `true` |
| `created_at` | timestamptz | no | `now()` |
| `updated_at` | timestamptz | no | `now()` |
| `linked_ref` | varchar(128) | yes | `` |

- **Primary key:** `id`
- **Indexes:**
  - `uq_app_it_objects_source` UNIQUE: (source_type, source_ref)

---

### `app.json_documents`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `file_name` **PK** | varchar(255) | no | `` |
| `kind` | varchar(16) | no | `'dict'::character varying` |
| `payload_json` | text | no | `'null'::text` |
| `updated_at` | timestamptz | no | `` |

- **Primary key:** `file_name`

---

### `app.json_records`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | integer | no | `nextval('app.json_records_id_seq'::regclass)` |
| `file_name` | varchar(255) | no | `` |
| `sort_order` | integer | no | `0` |
| `payload_json` | text | no | `'null'::text` |
| `created_at` | timestamptz | no | `` |
| `updated_at` | timestamptz | no | `` |

- **Primary key:** `id`
- **Indexes:**
  - `ix_json_records_file_name`: (file_name)
  - `ix_json_records_sort_order`: (sort_order)

---

### `app.mail_draft_context`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `draft_exchange_id` **PK** | text | no | `` |
| `user_id` | integer | no | `0` |
| `compose_mode` | text | no | `'draft'::text` |
| `reply_to_message_id` | text | yes | `` |
| `forward_message_id` | text | yes | `` |
| `updated_at` | text | no | `` |
| `compose_mailbox_id` | text | yes | `` |
| `forward_attachment_refs_json` | text | yes | `` |

- **Primary key:** `draft_exchange_id`
- **Indexes:**
  - `idx_mail_draft_context_user_updated`: (user_id, updated_at)

---

### `app.mail_folder_favorites`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `user_id` **PK** | integer | no | `` |
| `folder_id` **PK** | text | no | `` |
| `created_at` | text | no | `` |

- **Primary key:** `user_id, folder_id`
- **Indexes:**
  - `idx_mail_folder_favorites_user_created`: (user_id, created_at)

---

### `app.mail_it_templates`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | text | no | `` |
| `code` | text | no | `` |
| `title` | text | no | `` |
| `category` | text | no | `''::text` |
| `subject_template` | text | no | `` |
| `body_template_md` | text | no | `''::text` |
| `required_fields_json` | text | no | `'[]'::text` |
| `is_active` | integer | no | `1` |
| `created_by_user_id` | integer | no | `0` |
| `created_by_username` | text | no | `''::text` |
| `updated_by_user_id` | integer | no | `0` |
| `updated_by_username` | text | no | `''::text` |
| `created_at` | text | no | `` |
| `updated_at` | text | no | `` |

- **Primary key:** `id`
- **Indexes:**
  - `idx_mail_it_templates_active`: (is_active, updated_at)
  - `uq_mail_it_templates_code` UNIQUE: (code)

---

### `app.mail_messages_log`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | text | no | `` |
| `user_id` | integer | no | `0` |
| `username` | text | no | `''::text` |
| `direction` | text | no | `'outgoing'::text` |
| `folder_hint` | text | no | `''::text` |
| `subject` | text | no | `''::text` |
| `recipients_json` | text | no | `'[]'::text` |
| `sent_at` | text | no | `` |
| `status` | text | no | `'sent'::text` |
| `exchange_item_id` | text | yes | `` |
| `error_text` | text | yes | `` |

- **Primary key:** `id`
- **Indexes:**
  - `idx_mail_messages_log_user_time`: (user_id, sent_at)

---

### `app.mail_restore_hints`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `user_id` **PK** | integer | no | `` |
| `trash_exchange_id` **PK** | text | no | `` |
| `restore_folder` | text | no | `'inbox'::text` |
| `source_exchange_id` | text | yes | `` |
| `created_at` | text | no | `` |

- **Primary key:** `user_id, trash_exchange_id`
- **Indexes:**
  - `idx_mail_restore_hints_created`: (created_at)

---

### `app.mail_runtime_snapshots`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | integer | no | `nextval('app.mail_runtime_snapshots_id_seq'::regclass)` |
| `user_id` | integer | no | `` |
| `mailbox_id` | varchar(128) | no | `'aggregate'::character varying` |
| `snapshot_type` | varchar(32) | no | `` |
| `context_key` | varchar(255) | no | `'default'::character varying` |
| `payload_json` | text | no | `'{}'::text` |
| `status` | varchar(16) | no | `'ok'::character varying` |
| `last_error` | text | no | `''::text` |
| `as_of` | timestamptz | yes | `` |
| `expires_at` | timestamptz | yes | `` |
| `created_at` | timestamptz | no | `CURRENT_TIMESTAMP` |
| `updated_at` | timestamptz | no | `CURRENT_TIMESTAMP` |

- **Primary key:** `id`
- **Indexes:**
  - `ix_app_mail_runtime_snapshots_expires`: (expires_at)
  - `ix_app_mail_runtime_snapshots_user_type`: (user_id, snapshot_type)
  - `uq_app_mail_runtime_snapshot_scope` UNIQUE: (user_id, mailbox_id, snapshot_type, context_key)

---

### `app.mail_send_idempotency`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | varchar(64) | no | `` |
| `user_id` | integer | no | `` |
| `mailbox_id` | varchar(128) | no | `` |
| `idempotency_key` | varchar(128) | no | `` |
| `request_payload_hash` | varchar(64) | no | `` |
| `status` | varchar(16) | no | `'reserved'::character varying` |
| `internet_message_id` | varchar(255) | no | `''::character varying` |
| `response_json` | text | no | `'{}'::text` |
| `error_code` | varchar(64) | yes | `` |
| `processing_lease_until` | timestamptz | yes | `` |
| `created_at` | timestamptz | no | `CURRENT_TIMESTAMP` |
| `updated_at` | timestamptz | no | `CURRENT_TIMESTAMP` |
| `completed_at` | timestamptz | yes | `` |

- **Primary key:** `id`
- **Indexes:**
  - `ix_app_mail_send_idempotency_status`: (status)
  - `ix_app_mail_send_idempotency_status_lease`: (status, processing_lease_until)
  - `ix_app_mail_send_idempotency_user_created`: (user_id, created_at)
  - `ix_app_mail_send_idempotency_user_id`: (user_id)
  - `uq_app_mail_send_idempotency_scope` UNIQUE: (user_id, mailbox_id, idempotency_key)

---

### `app.mail_user_preferences`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `user_id` **PK** | integer | no | `nextval('app.mail_user_preferences_user_id_seq'::regclass)` |
| `prefs_json` | text | no | `'{}'::text` |
| `updated_at` | text | no | `` |

- **Primary key:** `user_id`

---

### `app.mail_visible_custom_folders`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `user_id` **PK** | integer | no | `` |
| `folder_id` **PK** | text | no | `` |
| `created_at` | text | no | `` |

- **Primary key:** `user_id, folder_id`
- **Indexes:**
  - `idx_mail_visible_custom_folders_user_created`: (user_id, created_at)

---

### `app.mailbox_quota_rows`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | integer | no | `nextval('app.mailbox_quota_rows_id_seq'::regclass)` |
| `snapshot_id` | integer | no | `` |
| `email` | varchar(320) | no | `''::character varying` |
| `display_name` | varchar(512) | no | `''::character varying` |
| `upn` | varchar(320) | no | `''::character varying` |
| `mailbox_type` | varchar(64) | no | `''::character varying` |
| `used_bytes` | bigint | yes | `` |
| `quota_bytes` | bigint | yes | `` |
| `free_bytes` | bigint | yes | `` |
| `used_percent` | double precision | yes | `` |
| `database_name` | varchar(255) | no | `''::character varying` |

- **Primary key:** `id`
- **Indexes:**
  - `ix_app_mailbox_quota_rows_snapshot_email`: (snapshot_id, email)
  - `ix_app_mailbox_quota_rows_snapshot_id`: (snapshot_id)
  - `ix_app_mailbox_quota_rows_snapshot_used_percent`: (snapshot_id, used_percent)

---

### `app.mailbox_quota_snapshots`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | integer | no | `nextval('app.mailbox_quota_snapshots_id_seq'::regclass)` |
| `imported_at` | timestamptz | no | `` |
| `collected_at` | timestamptz | yes | `` |
| `source_host` | varchar(255) | no | `''::character varying` |
| `exchange_server` | varchar(255) | no | `''::character varying` |
| `payload_sha256` | varchar(64) | no | `''::character varying` |
| `row_count` | integer | no | `0` |

- **Primary key:** `id`
- **Indexes:**
  - `ix_app_mailbox_quota_snapshots_imported_at`: (imported_at)
  - `ix_app_mailbox_quota_snapshots_payload_sha256`: (payload_sha256)

---

### `app.max_probe_chats`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | varchar(255) | no | `` |
| `computer_name` | varchar(255) | no | `` |
| `windows_user` | varchar(255) | no | `''::character varying` |
| `chat_id` | varchar(128) | no | `` |
| `chat_name` | varchar(512) | no | `` |
| `messages_json` | text | no | `'[]'::text` |
| `updated_at` | timestamptz | no | `` |

- **Primary key:** `id`
- **Indexes:**
  - `ix_app_max_probe_chats_computer`: (computer_name)
  - `ix_app_max_probe_chats_updated_at`: (updated_at)
  - `uq_app_max_probe_chats_host_chat` UNIQUE: (computer_name, chat_id)

---

### `app.max_probe_media`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | varchar(512) | no | `` |
| `computer_name` | varchar(255) | no | `` |
| `file_name` | varchar(512) | no | `` |
| `content` | bytea | yes | `` |
| `content_type` | varchar(128) | no | `'application/octet-stream'::character varying` |
| `created_at` | timestamptz | no | `` |
| `storage_path` | varchar(1024) | yes | `` |

- **Primary key:** `id`
- **Indexes:**
  - `ix_app_max_probe_media_computer`: (computer_name)
  - `ix_app_max_probe_media_created_at`: (created_at)
  - `uq_app_max_probe_media_host_file` UNIQUE: (computer_name, file_name)

---

### `app.mobile_biometric_credentials`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | varchar(64) | no | `` |
| `user_id` | integer | no | `` |
| `client_device_key_hash` | varchar(64) | no | `` |
| `token_hash` | varchar(64) | no | `` |
| `is_active` | boolean | no | `true` |
| `created_at` | timestamptz | no | `CURRENT_TIMESTAMP` |
| `last_used_at` | timestamptz | yes | `` |
| `revoked_at` | timestamptz | yes | `` |

- **Primary key:** `id`
- **Indexes:**
  - `ix_app_mobile_biometric_credentials_client_device_key_hash`: (client_device_key_hash)
  - `ix_app_mobile_biometric_credentials_is_active`: (is_active)
  - `ix_app_mobile_biometric_credentials_user_id`: (user_id)
  - `ix_app_mobile_biometric_user_active`: (user_id, is_active)
  - `uq_app_mobile_biometric_token_hash` UNIQUE: (token_hash)
  - `uq_app_mobile_biometric_user_device` UNIQUE: (user_id, client_device_key_hash)

---

### `app.monitoring_aggregates`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | varchar(36) | no | `` |
| `target_id` | varchar(36) | no | `` |
| `interface_id` | varchar(36) | no | `` |
| `resolution` | integer | no | `` |
| `bucket_at` | timestamptz | no | `` |
| `values` | json | no | `` |

- **Primary key:** `id`
- **Foreign keys:**
  - `target_id` → `app.monitoring_targets` (`id`)
- **Indexes:**
  - `ix_monitoring_aggregates_retention`: (resolution, bucket_at)
  - `uq_monitoring_aggregate` UNIQUE: (target_id, interface_id, resolution, bucket_at)

---

### `app.monitoring_events`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | varchar(36) | no | `` |
| `target_id` | varchar(36) | no | `` |
| `interface_id` | varchar(36) | no | `` |
| `kind` | varchar(60) | no | `` |
| `title` | varchar(255) | no | `` |
| `severity` | varchar(20) | no | `` |
| `opened_at` | timestamptz | no | `` |
| `closed_at` | timestamptz | yes | `` |

- **Primary key:** `id`
- **Foreign keys:**
  - `target_id` → `app.monitoring_targets` (`id`)
- **Indexes:**
  - `ix_monitoring_events_target_time`: (target_id, opened_at)

---

### `app.monitoring_interfaces`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | varchar(36) | no | `` |
| `target_id` | varchar(36) | no | `` |
| `name` | varchar(255) | no | `` |
| `snmp_index` | integer | no | `` |
| `settings` | json | no | `` |
| `current` | json | no | `` |

- **Primary key:** `id`
- **Foreign keys:**
  - `target_id` → `app.monitoring_targets` (`id`)
- **Indexes:**
  - `ix_app_monitoring_interfaces_target_id`: (target_id)
  - `uq_monitoring_interface_name` UNIQUE: (target_id, name)

---

### `app.monitoring_profiles`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | varchar(36) | no | `` |
| `name` | varchar(120) | no | `` |
| `community_enc` | text | no | `` |
| `updated_at` | timestamptz | no | `` |

- **Primary key:** `id`

---

### `app.monitoring_samples`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | varchar(36) | no | `` |
| `target_id` | varchar(36) | no | `` |
| `interface_id` | varchar(36) | no | `` |
| `observed_at` | timestamptz | no | `` |
| `values` | json | no | `` |

- **Primary key:** `id`
- **Foreign keys:**
  - `target_id` → `app.monitoring_targets` (`id`)
- **Indexes:**
  - `ix_monitoring_samples_retention`: (observed_at)
  - `uq_monitoring_sample` UNIQUE: (target_id, interface_id, observed_at)

---

### `app.monitoring_targets`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | varchar(36) | no | `` |
| `network_device_id` | integer | yes | `` |
| `name` | varchar(160) | no | `` |
| `address` | varchar(45) | no | `` |
| `port` | integer | no | `` |
| `profile_id` | varchar(36) | no | `` |
| `enabled` | boolean | no | `` |
| `settings` | json | no | `` |
| `current` | json | no | `` |
| `updated_at` | timestamptz | no | `` |
| `object_ref` | varchar(128) | yes | `` |

- **Primary key:** `id`
- **Foreign keys:**
  - `profile_id` → `app.monitoring_profiles` (`id`)
- **Indexes:**
  - `ix_monitoring_targets_object_ref`: (object_ref)
  - `monitoring_targets_network_device_id_key` UNIQUE: (network_device_id)

---

### `app.monitoring_worker_state`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | integer | no | `nextval('app.monitoring_worker_state_id_seq'::regclass)` |
| `heartbeat_at` | timestamptz | yes | `` |
| `cycle_seconds` | double precision | yes | `` |

- **Primary key:** `id`

---

### `app.my_file_audit`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | integer | no | `nextval('app.my_file_audit_id_seq'::regclass)` |
| `file_id` | varchar(64) | yes | `` |
| `action` | varchar(40) | no | `` |
| `actor_user_id` | integer | no | `0` |
| `actor_username` | varchar(50) | no | `''::character varying` |
| `ip_address` | varchar(128) | no | `''::character varying` |
| `user_agent` | text | no | `''::text` |
| `created_at` | timestamptz | no | `` |
| `details` | text | no | `''::text` |

- **Primary key:** `id`
- **Indexes:**
  - `ix_app_my_file_audit_action_created`: (action, created_at)
  - `ix_app_my_file_audit_actor_created`: (actor_user_id, created_at)
  - `ix_app_my_file_audit_file_created`: (file_id, created_at)

---

### `app.my_file_blobs`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | varchar(64) | no | `` |
| `owner_user_id` | integer | no | `0` |
| `original_sha256` | varchar(64) | no | `''::character varying` |
| `storage_path` | text | no | `''::text` |
| `storage_mode` | varchar(32) | no | `'stored'::character varying` |
| `stored_sha256` | varchar(64) | no | `''::character varying` |
| `original_size_bytes` | bigint | no | `'0'::bigint` |
| `stored_size_bytes` | bigint | no | `'0'::bigint` |
| `output_mime_type` | varchar(255) | no | `'application/octet-stream'::character varying` |
| `output_extension` | varchar(32) | no | `''::character varying` |
| `ref_count` | integer | no | `0` |
| `created_at` | timestamptz | no | `` |
| `updated_at` | timestamptz | no | `` |
| `last_used_at` | timestamptz | no | `` |

- **Primary key:** `id`
- **Indexes:**
  - `ix_app_my_file_blobs_original_sha256`: (original_sha256)
  - `ix_app_my_file_blobs_owner_user_id`: (owner_user_id)
  - `ix_app_my_file_blobs_ref_count`: (ref_count)
  - `uq_app_my_file_blobs_owner_original_sha` UNIQUE: (owner_user_id, original_sha256)

---

### `app.my_file_blobs_v1`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | varchar(64) | no | `` |
| `storage_path` | text | no | `''::text` |
| `storage_mode` | varchar(32) | no | `'stored'::character varying` |
| `stored_sha256` | varchar(64) | no | `''::character varying` |
| `original_size_bytes` | bigint | no | `'0'::bigint` |
| `stored_size_bytes` | bigint | no | `'0'::bigint` |
| `output_mime_type` | varchar(255) | no | `'application/octet-stream'::character varying` |
| `output_extension` | varchar(32) | no | `''::character varying` |
| `ref_count` | integer | no | `0` |
| `created_at` | timestamptz | no | `` |
| `updated_at` | timestamptz | no | `` |
| `last_used_at` | timestamptz | no | `` |

- **Primary key:** `id`
- **Indexes:**
  - `ix_app_my_file_blobs_v1_ref_count`: (ref_count)

---

### `app.my_file_collaborators`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `file_id` **PK** | varchar(64) | no | `` |
| `user_id` **PK** | integer | no | `` |
| `added_by_user_id` | integer | no | `0` |
| `created_at` | timestamptz | no | `now()` |
| `role` | varchar(16) | no | `'edit'::character varying` |
| `updated_at` | timestamptz | no | `` |

- **Primary key:** `file_id, user_id`
- **Indexes:**
  - `ix_app_my_file_collaborators_user`: (user_id)

---

### `app.my_file_download_grants`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `token_hash` **PK** | varchar(64) | no | `` |
| `file_id` | varchar(64) | yes | `` |
| `owner_user_id` | integer | no | `` |
| `expires_at` | timestamptz | no | `` |
| `used_at` | timestamptz | yes | `` |
| `created_at` | timestamptz | no | `` |
| `folder_id` | varchar(64) | yes | `` |

- **Primary key:** `token_hash`
- **Indexes:**
  - `ix_app_my_file_download_grants_expires_at`: (expires_at)
  - `ix_app_my_file_download_grants_file_id`: (file_id)
  - `ix_app_my_file_download_grants_folder_id`: (folder_id)
  - `ix_app_my_file_download_grants_owner_created`: (owner_user_id, created_at)

---

### `app.my_file_folder_collaborators`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `folder_id` **PK** | varchar(64) | no | `` |
| `user_id` **PK** | integer | no | `` |
| `added_by_user_id` | integer | no | `0` |
| `role` | varchar(16) | no | `'edit'::character varying` |
| `created_at` | timestamptz | no | `now()` |
| `updated_at` | timestamptz | no | `` |

- **Primary key:** `folder_id, user_id`
- **Indexes:**
  - `ix_app_my_file_folder_collaborators_user`: (user_id)

---

### `app.my_file_folders`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | varchar(64) | no | `` |
| `owner_user_id` | integer | no | `` |
| `parent_id` | varchar(64) | yes | `` |
| `name` | varchar(255) | no | `` |
| `created_at` | timestamptz | no | `` |
| `updated_at` | timestamptz | no | `` |
| `deleted_at` | timestamptz | yes | `` |
| `share_token` | varchar(128) | yes | `` |
| `share_token_enc` | text | yes | `` |
| `share_token_hash` | varchar(64) | yes | `` |
| `share_created_at` | timestamptz | yes | `` |
| `is_favorite` | boolean | no | `false` |

- **Primary key:** `id`
- **Foreign keys:**
  - `parent_id` → `app.my_file_folders` (`id`)
- **Indexes:**
  - `ix_app_my_file_folders_owner_deleted`: (owner_user_id, deleted_at)
  - `ix_app_my_file_folders_owner_parent`: (owner_user_id, parent_id)
  - `ix_app_my_file_folders_share_token_hash`: (share_token_hash)

---

### `app.my_file_libraries`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | varchar(64) | no | `` |
| `name` | varchar(255) | no | `` |
| `owner_user_id` | integer | no | `` |
| `quota_bytes` | bigint | no | `'0'::bigint` |
| `created_by_user_id` | integer | no | `0` |
| `created_at` | timestamptz | no | `now()` |
| `updated_at` | timestamptz | no | `now()` |
| `deleted_at` | timestamptz | yes | `` |

- **Primary key:** `id`
- **Indexes:**
  - `uq_app_my_file_libraries_owner` UNIQUE: (owner_user_id)

---

### `app.my_file_library_members`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `library_id` **PK** | varchar(64) | no | `` |
| `principal_type` **PK** | varchar(16) | no | `` |
| `principal_id` **PK** | varchar(64) | no | `` |
| `role` | varchar(16) | no | `'edit'::character varying` |
| `added_by_user_id` | integer | no | `0` |
| `created_at` | timestamptz | no | `now()` |
| `updated_at` | timestamptz | no | `` |

- **Primary key:** `library_id, principal_type, principal_id`
- **Indexes:**
  - `ix_app_my_file_library_members_principal`: (principal_type, principal_id)

---

### `app.my_file_previews`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `blob_id` **PK** | varchar(64) | no | `` |
| `status` | varchar(32) | no | `'queued'::character varying` |
| `preview_kind` | varchar(32) | no | `'unsupported'::character varying` |
| `source_kind` | varchar(32) | no | `''::character varying` |
| `source_filename` | varchar(512) | no | `''::character varying` |
| `content_type` | varchar(255) | no | `'application/octet-stream'::character varying` |
| `preview_path` | text | no | `''::text` |
| `preview_mime_type` | varchar(255) | no | `'application/octet-stream'::character varying` |
| `preview_filename` | varchar(512) | no | `''::character varying` |
| `page_count` | integer | no | `0` |
| `sheets_json` | text | no | `'[]'::text` |
| `error_text` | text | no | `''::text` |
| `created_at` | timestamptz | no | `` |
| `updated_at` | timestamptz | no | `` |
| `generated_at` | timestamptz | yes | `` |

- **Primary key:** `blob_id`
- **Indexes:**
  - `ix_app_my_file_previews_kind_status`: (preview_kind, status)
  - `ix_app_my_file_previews_status_updated`: (status, updated_at)

---

### `app.my_file_previews_v1`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `blob_id` **PK** | varchar(64) | no | `` |
| `status` | varchar(32) | no | `'queued'::character varying` |
| `preview_kind` | varchar(32) | no | `'unsupported'::character varying` |
| `source_kind` | varchar(32) | no | `''::character varying` |
| `source_filename` | varchar(512) | no | `''::character varying` |
| `content_type` | varchar(255) | no | `'application/octet-stream'::character varying` |
| `preview_path` | text | no | `''::text` |
| `preview_mime_type` | varchar(255) | no | `'application/octet-stream'::character varying` |
| `preview_filename` | varchar(512) | no | `''::character varying` |
| `page_count` | integer | no | `0` |
| `sheets_json` | text | no | `'[]'::text` |
| `error_text` | text | no | `''::text` |
| `created_at` | timestamptz | no | `` |
| `updated_at` | timestamptz | no | `` |
| `generated_at` | timestamptz | yes | `` |

- **Primary key:** `blob_id`
- **Indexes:**
  - `ix_app_my_file_previews_v1_kind_status`: (preview_kind, status)
  - `ix_app_my_file_previews_v1_status_updated`: (status, updated_at)

---

### `app.my_file_versions`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | varchar(64) | no | `` |
| `file_id` | varchar(64) | no | `` |
| `version_no` | integer | no | `` |
| `blob_id` | varchar(64) | no | `` |
| `original_sha256` | varchar(64) | no | `''::character varying` |
| `original_size_bytes` | bigint | no | `'0'::bigint` |
| `session_key` | varchar(64) | no | `''::character varying` |
| `created_by_user_id` | integer | no | `0` |
| `created_by_username` | varchar(50) | no | `''::character varying` |
| `created_at` | timestamptz | no | `now()` |
| `office_history_json` | text | no | `''::text` |
| `office_changes_blob_id` | varchar(64) | no | `''::character varying` |
| `office_changes_size_bytes` | bigint | no | `'0'::bigint` |
| `office_result_blob_id` | varchar(64) | no | `''::character varying` |

- **Primary key:** `id`
- **Indexes:**
  - `ix_app_my_file_versions_blob`: (blob_id)
  - `ix_app_my_file_versions_file`: (file_id, version_no)
  - `uq_app_my_file_versions_file_no` UNIQUE: (file_id, version_no)

---

### `app.my_files`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | varchar(64) | no | `` |
| `owner_user_id` | integer | no | `` |
| `owner_username` | varchar(50) | no | `''::character varying` |
| `original_file_name` | varchar(512) | no | `'file.bin'::character varying` |
| `download_file_name` | varchar(512) | no | `'file.bin'::character varying` |
| `mime_type` | varchar(255) | no | `'application/octet-stream'::character varying` |
| `download_mime_type` | varchar(255) | no | `'application/octet-stream'::character varying` |
| `original_size_bytes` | bigint | no | `'0'::bigint` |
| `stored_size_bytes` | bigint | no | `'0'::bigint` |
| `retention_days` | integer | no | `1` |
| `status` | varchar(32) | no | `'queued'::character varying` |
| `storage_mode` | varchar(32) | no | `''::character varying` |
| `original_sha256` | varchar(64) | yes | `` |
| `blob_id` | varchar(64) | yes | `` |
| `spool_path` | text | no | `''::text` |
| `error_text` | text | no | `''::text` |
| `share_token_hash` | varchar(64) | yes | `` |
| `share_created_at` | timestamptz | yes | `` |
| `created_at` | timestamptz | no | `` |
| `updated_at` | timestamptz | no | `` |
| `expires_at` | timestamptz | no | `` |
| `deleted_at` | timestamptz | yes | `` |
| `share_token` | varchar(128) | yes | `` |
| `security_scan_status` | varchar(32) | no | `'pending'::character varying` |
| `security_scan_engine` | varchar(64) | no | `''::character varying` |
| `security_scanned_at` | timestamptz | yes | `` |
| `share_token_enc` | text | yes | `` |
| `folder_id` | varchar(64) | yes | `` |
| `is_favorite` | boolean | no | `false` |
| `uploaded_by_user_id` | integer | yes | `` |
| `office_session_key` | varchar(64) | no | `''::character varying` |

- **Primary key:** `id`
- **Foreign keys:**
  - `folder_id` → `app.my_file_folders` (`id`)
- **Indexes:**
  - `ix_app_my_files_expires_at`: (expires_at)
  - `ix_app_my_files_expires_status`: (expires_at, status)
  - `ix_app_my_files_folder`: (folder_id)
  - `ix_app_my_files_original_sha256`: (original_sha256)
  - `ix_app_my_files_owner_live_folder`: (owner_user_id, deleted_at, folder_id, created_at)
  - `ix_app_my_files_owner_live_updated`: (owner_user_id, deleted_at, updated_at)
  - `ix_app_my_files_owner_quota_cover`: (owner_user_id, deleted_at, status, expires_at, original_size_bytes)
  - `ix_app_my_files_owner_status_created`: (owner_user_id, status, created_at)
  - `ix_app_my_files_owner_user_id`: (owner_user_id)
  - `ix_app_my_files_share_token_hash`: (share_token_hash)
  - `ix_app_my_files_status`: (status)
  - `ix_app_my_files_status_created`: (status, created_at)

---

### `app.native_push_tokens`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | integer | no | `nextval('app.native_push_tokens_id_seq'::regclass)` |
| `user_id` | integer | no | `` |
| `provider` | varchar(32) | no | `` |
| `platform` | varchar(32) | no | `` |
| `token_hash` | varchar(64) | no | `` |
| `token_text` | text | no | `` |
| `device_id` | varchar(128) | yes | `` |
| `device_label` | varchar(255) | yes | `` |
| `app_version` | varchar(64) | yes | `` |
| `is_active` | boolean | no | `` |
| `failure_count` | integer | no | `` |
| `created_at` | timestamptz | no | `` |
| `updated_at` | timestamptz | no | `` |
| `last_seen_at` | timestamptz | yes | `` |
| `revoked_at` | timestamptz | yes | `` |
| `last_push_at` | timestamptz | yes | `` |
| `last_error_at` | timestamptz | yes | `` |
| `last_error_text` | text | yes | `` |

- **Primary key:** `id`
- **Indexes:**
  - `ix_app_native_push_tokens_device_id`: (device_id)
  - `ix_app_native_push_tokens_user_active`: (user_id, is_active)
  - `ix_native_push_tokens_is_active`: (is_active)
  - `ix_native_push_tokens_platform`: (platform)
  - `ix_native_push_tokens_provider`: (provider)
  - `ix_native_push_tokens_user_id`: (user_id)
  - `uq_app_native_push_tokens_token_hash` UNIQUE: (token_hash)

---

### `app.network_audit_log`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | integer | no | `nextval('app.network_audit_log_id_seq'::regclass)` |
| `branch_id` | integer | yes | `` |
| `entity_type` | text | no | `` |
| `entity_id` | text | yes | `` |
| `action` | text | no | `` |
| `diff_json` | text | yes | `` |
| `actor_user_id` | integer | yes | `` |
| `actor_role` | text | yes | `` |
| `created_at` | text | no | `` |

- **Primary key:** `id`
- **Foreign keys:**
  - `branch_id` → `app.network_branches` (`id`)
- **Indexes:**
  - `idx_network_audit_branch`: (branch_id)

---

### `app.network_branch_db_map`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | integer | no | `nextval('app.network_branch_db_map_id_seq'::regclass)` |
| `branch_id` | integer | no | `` |
| `db_id` | text | no | `` |
| `updated_at` | text | no | `` |
| `updated_by` | text | yes | `` |

- **Primary key:** `id`
- **Foreign keys:**
  - `branch_id` → `app.network_branches` (`id`)
- **Indexes:**
  - `uq_network_branch_db_map_branch_id` UNIQUE: (branch_id)

---

### `app.network_branches`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | integer | no | `nextval('app.network_branches_id_seq'::regclass)` |
| `city_code` | text | no | `` |
| `branch_code` | text | no | `` |
| `name` | text | no | `` |
| `is_active` | integer | no | `1` |
| `created_at` | text | no | `` |
| `updated_at` | text | no | `` |
| `default_site_code` | text | yes | `` |

- **Primary key:** `id`
- **Indexes:**
  - `idx_network_branches_city`: (city_code)
  - `uq_network_branches_city_branch` UNIQUE: (city_code, branch_code)

---

### `app.network_devices`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | integer | no | `nextval('app.network_devices_id_seq'::regclass)` |
| `branch_id` | integer | no | `` |
| `site_id` | integer | yes | `` |
| `device_code` | text | no | `` |
| `device_type` | text | no | `'switch'::text` |
| `vendor` | text | yes | `` |
| `model` | text | yes | `` |
| `sheet_name` | text | yes | `` |
| `mgmt_ip` | text | yes | `` |
| `notes` | text | yes | `` |
| `created_at` | text | no | `` |
| `updated_at` | text | no | `` |
| `monitoring_only` | integer | no | `0` |

- **Primary key:** `id`
- **Foreign keys:**
  - `branch_id` → `app.network_branches` (`id`)
  - `site_id` → `app.network_sites` (`id`)
- **Indexes:**
  - `idx_network_devices_branch`: (branch_id)
  - `uq_network_devices_branch_device_code` UNIQUE: (branch_id, device_code)

---

### `app.network_import_jobs`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | integer | no | `nextval('app.network_import_jobs_id_seq'::regclass)` |
| `city_code` | text | no | `` |
| `branch_id` | integer | yes | `` |
| `status` | text | no | `` |
| `started_at` | text | no | `` |
| `finished_at` | text | yes | `` |
| `summary_json` | text | yes | `` |
| `error_text` | text | yes | `` |

- **Primary key:** `id`
- **Foreign keys:**
  - `branch_id` → `app.network_branches` (`id`)

---

### `app.network_map_points`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | integer | no | `nextval('app.network_map_points_id_seq'::regclass)` |
| `branch_id` | integer | no | `` |
| `map_id` | integer | no | `` |
| `site_id` | integer | yes | `` |
| `device_id` | integer | yes | `` |
| `port_id` | integer | yes | `` |
| `socket_id` | integer | yes | `` |
| `x_ratio` | double precision | no | `` |
| `y_ratio` | double precision | no | `` |
| `label` | text | yes | `` |
| `note` | text | yes | `` |
| `color` | text | yes | `` |
| `created_at` | text | no | `` |
| `updated_at` | text | no | `` |

- **Primary key:** `id`
- **Foreign keys:**
  - `branch_id` → `app.network_branches` (`id`)
  - `device_id` → `app.network_devices` (`id`)
  - `map_id` → `app.network_maps` (`id`)
  - `port_id` → `app.network_ports` (`id`)
  - `site_id` → `app.network_sites` (`id`)
  - `socket_id` → `app.network_sockets` (`id`)
- **Indexes:**
  - `idx_network_map_points_branch`: (branch_id)
  - `idx_network_map_points_device`: (device_id)
  - `idx_network_map_points_map`: (map_id)
  - `idx_network_map_points_socket`: (socket_id)

---

### `app.network_maps`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | integer | no | `nextval('app.network_maps_id_seq'::regclass)` |
| `branch_id` | integer | no | `` |
| `site_id` | integer | yes | `` |
| `title` | text | yes | `` |
| `floor_label` | text | yes | `` |
| `file_name` | text | no | `` |
| `mime_type` | text | no | `` |
| `file_blob` | bytea | no | `` |
| `file_size` | integer | no | `0` |
| `checksum_sha256` | text | no | `` |
| `source_path` | text | yes | `` |
| `created_at` | text | no | `` |
| `updated_at` | text | no | `` |

- **Primary key:** `id`
- **Foreign keys:**
  - `branch_id` → `app.network_branches` (`id`)
  - `site_id` → `app.network_sites` (`id`)
- **Indexes:**
  - `idx_network_maps_branch`: (branch_id)
  - `uq_network_maps_branch_file_name` UNIQUE: (branch_id, file_name)

---

### `app.network_panels`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | integer | no | `nextval('app.network_panels_id_seq'::regclass)` |
| `branch_id` | integer | no | `` |
| `panel_index` | integer | no | `` |
| `port_count` | integer | no | `` |
| `sort_order` | integer | no | `0` |
| `created_at` | text | no | `` |
| `updated_at` | text | no | `` |

- **Primary key:** `id`
- **Foreign keys:**
  - `branch_id` → `app.network_branches` (`id`)
- **Indexes:**
  - `idx_network_panels_branch`: (branch_id)
  - `uq_network_panels_branch_panel_index` UNIQUE: (branch_id, panel_index)

---

### `app.network_ports`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | integer | no | `nextval('app.network_ports_id_seq'::regclass)` |
| `device_id` | integer | no | `` |
| `port_name` | text | no | `` |
| `patch_panel_port` | text | yes | `` |
| `location_code` | text | yes | `` |
| `vlan_raw` | text | yes | `` |
| `vlan_normalized_json` | text | yes | `` |
| `endpoint_name_raw` | text | yes | `` |
| `endpoint_ip_raw` | text | yes | `` |
| `endpoint_mac_raw` | text | yes | `` |
| `endpoint_count` | integer | no | `0` |
| `is_occupied` | integer | no | `0` |
| `row_source_hash` | text | yes | `` |
| `created_at` | text | no | `` |
| `updated_at` | text | no | `` |

- **Primary key:** `id`
- **Foreign keys:**
  - `device_id` → `app.network_devices` (`id`)
- **Indexes:**
  - `idx_network_ports_device`: (device_id)
  - `uq_network_ports_device_port_name` UNIQUE: (device_id, port_name)

---

### `app.network_sites`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | integer | no | `nextval('app.network_sites_id_seq'::regclass)` |
| `branch_id` | integer | no | `` |
| `site_code` | text | no | `` |
| `name` | text | no | `` |
| `sort_order` | integer | no | `0` |
| `created_at` | text | no | `` |
| `updated_at` | text | no | `` |

- **Primary key:** `id`
- **Foreign keys:**
  - `branch_id` → `app.network_branches` (`id`)
- **Indexes:**
  - `uq_network_sites_branch_site_code` UNIQUE: (branch_id, site_code)

---

### `app.network_socket_profiles`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | integer | no | `nextval('app.network_socket_profiles_id_seq'::regclass)` |
| `branch_id` | integer | no | `` |
| `panel_count` | integer | no | `` |
| `ports_per_panel` | integer | no | `` |
| `is_uniform` | integer | no | `1` |
| `created_at` | text | no | `` |
| `updated_at` | text | no | `` |

- **Primary key:** `id`
- **Foreign keys:**
  - `branch_id` → `app.network_branches` (`id`)
- **Indexes:**
  - `uq_network_socket_profiles_branch_id` UNIQUE: (branch_id)

---

### `app.network_sockets`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | integer | no | `nextval('app.network_sockets_id_seq'::regclass)` |
| `branch_id` | integer | no | `` |
| `site_id` | integer | yes | `` |
| `socket_code` | text | no | `` |
| `panel_no` | integer | yes | `` |
| `port_no` | integer | yes | `` |
| `port_id` | integer | yes | `` |
| `device_id` | integer | yes | `` |
| `mac_address` | text | yes | `` |
| `fio` | text | yes | `` |
| `fio_source_db` | text | yes | `` |
| `fio_resolved_at` | text | yes | `` |
| `created_at` | text | no | `` |
| `updated_at` | text | no | `` |

- **Primary key:** `id`
- **Foreign keys:**
  - `branch_id` → `app.network_branches` (`id`)
  - `device_id` → `app.network_devices` (`id`)
  - `port_id` → `app.network_ports` (`id`)
  - `site_id` → `app.network_sites` (`id`)
- **Indexes:**
  - `idx_network_sockets_branch_code`: (branch_id, socket_code)
  - `idx_network_sockets_port`: (port_id)
  - `uq_network_sockets_branch_socket_code` UNIQUE: (branch_id, socket_code)

---

### `app.one_c_catalog_entries`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | integer | no | `nextval('app.one_c_catalog_entries_id_seq'::regclass)` |
| `source_base` | varchar(64) | no | `` |
| `generation` | integer | no | `` |
| `catalog_type` | varchar(16) | no | `` |
| `ref` | varchar(64) | no | `` |
| `code` | varchar(200) | no | `''::character varying` |
| `name` | text | no | `''::text` |
| `code_normalized` | varchar(200) | no | `''::character varying` |
| `name_normalized` | text | no | `''::text` |
| `created_at` | timestamptz | no | `CURRENT_TIMESTAMP` |

- **Primary key:** `id`
- **Indexes:**
  - `ix_app_one_c_catalog_entries_code`: (source_base, generation, catalog_type, code_normalized)
  - `ix_app_one_c_catalog_entries_name`: (source_base, generation, catalog_type, name_normalized)
  - `ix_app_one_c_catalog_entries_ref`: (source_base, generation, catalog_type, ref)
  - `uq_app_one_c_catalog_entries_generation_ref` UNIQUE: (source_base, generation, catalog_type, ref)

---

### `app.one_c_catalog_search_documents`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | bigint | no | `nextval('app.one_c_catalog_search_documents_id_seq'::regclass)` |
| `source_base` | varchar(64) | no | `` |
| `generation` | integer | no | `` |
| `catalog_type` | varchar(16) | no | `` |
| `entry_ref` | varchar(64) | no | `` |
| `code_normalized` | varchar(200) | no | `''::character varying` |
| `name_normalized` | text | no | `''::text` |
| `search_text` | text | no | `''::text` |
| `search_tsv` | tsvector | no | `''::tsvector` |
| `created_at` | timestamptz | no | `CURRENT_TIMESTAMP` |
| `updated_at` | timestamptz | no | `CURRENT_TIMESTAMP` |
| `index_version` | integer | no | `1` |

- **Primary key:** `id`
- **Indexes:**
  - `ix_app_one_c_catalog_search_documents_code`: (source_base, catalog_type, index_version, code_normalized)
  - `ix_app_one_c_catalog_search_documents_name_prefix`: (source_base, catalog_type, index_version)
  - `ix_app_one_c_catalog_search_documents_trgm`: (search_text)
  - `ix_app_one_c_catalog_search_documents_tsv`: (search_tsv)
  - `uq_app_one_c_catalog_search_documents_ref` UNIQUE: (source_base, catalog_type, index_version, entry_ref)

---

### `app.one_c_catalog_search_index_state`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `source_base` **PK** | varchar(64) | no | `` |
| `catalog_type` **PK** | varchar(16) | no | `` |
| `generation` | integer | no | `0` |
| `status` | varchar(16) | no | `'building'::character varying` |
| `expected_count` | integer | no | `0` |
| `indexed_count` | integer | no | `0` |
| `build_version` | integer | no | `0` |
| `checksum` | varchar(64) | no | `''::character varying` |
| `last_error` | text | no | `''::text` |
| `started_at` | timestamptz | yes | `` |
| `finished_at` | timestamptz | yes | `` |
| `updated_at` | timestamptz | no | `CURRENT_TIMESTAMP` |
| `checkpoint_ref` | varchar(64) | no | `''::character varying` |
| `checkpoint_offset` | integer | no | `0` |
| `active_index_version` | integer | no | `0` |
| `building_index_version` | integer | no | `0` |
| `previous_index_version` | integer | no | `0` |
| `source_fingerprint` | varchar(64) | no | `''::character varying` |
| `previous_cleanup_after` | timestamptz | yes | `` |

- **Primary key:** `source_base, catalog_type`

---

### `app.one_c_catalog_search_token_stats`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | integer | no | `nextval('app.one_c_catalog_search_token_stats_id_seq'::regclass)` |
| `source_base` | varchar(64) | no | `` |
| `generation` | integer | no | `` |
| `catalog_type` | varchar(16) | no | `` |
| `token` | varchar(200) | no | `` |
| `frequency` | integer | no | `0` |
| `updated_at` | timestamptz | no | `CURRENT_TIMESTAMP` |
| `index_version` | integer | no | `1` |

- **Primary key:** `id`
- **Indexes:**
  - `ix_app_one_c_catalog_search_token_stats_prefix`: (source_base, catalog_type, index_version, token)
  - `ix_app_one_c_catalog_search_token_stats_trgm`: (token)
  - `uq_app_one_c_catalog_search_token_stats` UNIQUE: (source_base, catalog_type, index_version, token)

---

### `app.one_c_catalog_snapshots`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `source_base` **PK** | varchar(64) | no | `` |
| `active_generation` | integer | no | `0` |
| `nomenclature_count` | integer | no | `0` |
| `warehouses_count` | integer | no | `0` |
| `nomenclature_truncated` | boolean | no | `false` |
| `warehouses_truncated` | boolean | no | `false` |
| `updated_at` | timestamptz | yes | `` |
| `last_attempt_at` | timestamptz | yes | `` |
| `last_error` | text | no | `''::text` |
| `created_at` | timestamptz | no | `CURRENT_TIMESTAMP` |
| `nomenclature_fingerprint` | varchar(64) | no | `''::character varying` |
| `warehouses_fingerprint` | varchar(64) | no | `''::character varying` |

- **Primary key:** `source_base`

---

### `app.one_c_catalog_tokens`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | integer | no | `nextval('app.one_c_catalog_tokens_id_seq'::regclass)` |
| `source_base` | varchar(64) | no | `` |
| `generation` | integer | no | `` |
| `catalog_type` | varchar(16) | no | `` |
| `entry_ref` | varchar(64) | no | `` |
| `token` | varchar(200) | no | `` |

- **Primary key:** `id`
- **Indexes:**
  - `ix_app_one_c_catalog_tokens_lookup`: (source_base, generation, catalog_type, token, entry_ref)
  - `ix_app_one_c_catalog_tokens_token_trgm`: (token)
  - `uq_app_one_c_catalog_tokens_entry_token` UNIQUE: (source_base, generation, catalog_type, entry_ref, token)

---

### `app.one_c_employee_owner_links`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | integer | no | `nextval('app.one_c_employee_owner_links_id_seq'::regclass)` |
| `source_base` | varchar(64) | no | `'zar31'::character varying` |
| `employee_code` | varchar(128) | no | `` |
| `hub_db_id` | varchar(128) | no | `` |
| `owner_no` | integer | no | `` |
| `status` | varchar(16) | no | `'active'::character varying` |
| `version` | integer | no | `1` |
| `created_by` | varchar(128) | no | `''::character varying` |
| `verified_by` | varchar(128) | yes | `` |
| `verified_at` | timestamptz | yes | `` |
| `created_at` | timestamptz | no | `CURRENT_TIMESTAMP` |
| `updated_at` | timestamptz | no | `CURRENT_TIMESTAMP` |

- **Primary key:** `id`
- **Indexes:**
  - `ix_app_one_c_employee_owner_links_employee`: (source_base, employee_code)
  - `ix_app_one_c_employee_owner_links_owner`: (hub_db_id, owner_no)
  - `uq_app_one_c_employee_owner_links` UNIQUE: (source_base, employee_code, hub_db_id, owner_no)

---

### `app.one_c_item_links`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | integer | no | `nextval('app.one_c_item_links_id_seq'::regclass)` |
| `hub_db_id` | varchar(128) | no | `` |
| `hub_item_id` | varchar(64) | no | `` |
| `source_base` | varchar(64) | no | `'buh20'::character varying` |
| `nomenclature_ref` | varchar(64) | yes | `` |
| `nomenclature_code_snapshot` | varchar(200) | yes | `` |
| `status` | varchar(16) | no | `'pending'::character varying` |
| `reason` | text | yes | `` |
| `version` | integer | no | `1` |
| `created_by` | varchar(128) | no | `''::character varying` |
| `verified_by` | varchar(128) | yes | `` |
| `verified_at` | timestamptz | yes | `` |
| `created_at` | timestamptz | no | `CURRENT_TIMESTAMP` |
| `updated_at` | timestamptz | no | `CURRENT_TIMESTAMP` |

- **Primary key:** `id`
- **Indexes:**
  - `ix_app_one_c_item_links_nomenclature`: (source_base, nomenclature_ref)
  - `ix_app_one_c_item_links_status`: (hub_db_id, status)
  - `uq_app_one_c_item_links_hub_item_source` UNIQUE: (hub_db_id, hub_item_id, source_base)

---

### `app.one_c_reconcile_events`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | varchar(64) | no | `` |
| `event_type` | varchar(64) | no | `` |
| `correlation_id` | varchar(64) | no | `` |
| `hub_db_id` | varchar(128) | yes | `` |
| `hub_item_id` | varchar(64) | yes | `` |
| `actor` | varchar(128) | no | `''::character varying` |
| `reason` | text | yes | `` |
| `before_json` | text | no | `'{}'::text` |
| `after_json` | text | no | `'{}'::text` |
| `created_at` | timestamptz | no | `CURRENT_TIMESTAMP` |

- **Primary key:** `id`
- **Indexes:**
  - `ix_app_one_c_reconcile_events_correlation`: (correlation_id)
  - `ix_app_one_c_reconcile_events_hub_item`: (hub_db_id, hub_item_id, created_at)

---

### `app.one_c_warehouse_owner_links`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | integer | no | `nextval('app.one_c_warehouse_owner_links_id_seq'::regclass)` |
| `source_base` | varchar(64) | no | `'buh20'::character varying` |
| `warehouse_ref` | varchar(64) | no | `` |
| `hub_db_id` | varchar(128) | no | `` |
| `owner_no` | integer | no | `` |
| `status` | varchar(16) | no | `'active'::character varying` |
| `reason` | text | yes | `` |
| `version` | integer | no | `1` |
| `created_by` | varchar(128) | no | `''::character varying` |
| `verified_by` | varchar(128) | yes | `` |
| `verified_at` | timestamptz | yes | `` |
| `created_at` | timestamptz | no | `CURRENT_TIMESTAMP` |
| `updated_at` | timestamptz | no | `CURRENT_TIMESTAMP` |

- **Primary key:** `id`
- **Indexes:**
  - `ix_app_one_c_warehouse_owner_links_owner`: (hub_db_id, owner_no)
  - `ix_app_one_c_warehouse_owner_links_warehouse`: (source_base, warehouse_ref)
  - `uq_app_one_c_warehouse_owner_links` UNIQUE: (source_base, warehouse_ref, hub_db_id, owner_no)
  - `uq_app_one_c_warehouse_owner_links_active_warehouse` UNIQUE: (source_base, warehouse_ref, hub_db_id)

---

### `app.org_structure_department_links`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | integer | no | `nextval('app.org_structure_department_links_id_seq'::regclass)` |
| `node_id` | varchar(64) | no | `` |
| `department_code` | varchar(64) | no | `` |
| `created_at` | timestamptz | no | `` |

- **Primary key:** `id`
- **Indexes:**
  - `ix_app_org_structure_dept_links_code`: (department_code)
  - `ix_app_org_structure_dept_links_node`: (node_id)
  - `uq_app_org_structure_department_code` UNIQUE: (department_code)
  - `uq_app_org_structure_department_link` UNIQUE: (node_id, department_code)

---

### `app.org_structure_nodes`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | varchar(64) | no | `` |
| `parent_id` | varchar(64) | yes | `` |
| `node_type` | varchar(32) | no | `'other'::character varying` |
| `title` | varchar(255) | no | `''::character varying` |
| `person_name` | varchar(255) | no | `''::character varying` |
| `person_position` | varchar(255) | no | `''::character varying` |
| `sort_order` | integer | no | `0` |
| `is_active` | boolean | no | `true` |
| `created_at` | timestamptz | no | `` |
| `updated_at` | timestamptz | no | `` |
| `layout_x` | double precision | yes | `` |
| `layout_y` | double precision | yes | `` |
| `person_employee_code` | varchar(128) | yes | `` |
| `person_photo_updated_at` | timestamptz | yes | `` |

- **Primary key:** `id`
- **Indexes:**
  - `ix_app_org_structure_nodes_active`: (is_active)
  - `ix_app_org_structure_nodes_parent`: (parent_id, sort_order)

---

### `app.password_vault_audit`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | integer | no | `nextval('app.password_vault_audit_id_seq'::regclass)` |
| `entry_id` | varchar(64) | yes | `` |
| `action` | varchar(40) | no | `` |
| `actor_user_id` | integer | no | `0` |
| `actor_username` | varchar(50) | no | `''::character varying` |
| `entry_group` | varchar(120) | no | `''::character varying` |
| `entry_login` | varchar(255) | no | `''::character varying` |
| `ip_address` | varchar(128) | no | `''::character varying` |
| `user_agent` | text | no | `''::text` |
| `created_at` | timestamptz | no | `` |

- **Primary key:** `id`
- **Indexes:**
  - `ix_app_password_vault_audit_action_created`: (action, created_at)
  - `ix_app_password_vault_audit_actor_created`: (actor_user_id, created_at)
  - `ix_app_password_vault_audit_entry_created`: (entry_id, created_at)

---

### `app.password_vault_entries`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | varchar(64) | no | `` |
| `group_name` | varchar(120) | no | `''::character varying` |
| `tags_json` | text | no | `'[]'::text` |
| `login` | varchar(255) | no | `''::character varying` |
| `description` | text | no | `''::text` |
| `password_enc` | text | no | `''::text` |
| `is_archived` | boolean | no | `false` |
| `created_by_user_id` | integer | no | `0` |
| `created_by_username` | varchar(50) | no | `''::character varying` |
| `updated_by_user_id` | integer | no | `0` |
| `updated_by_username` | varchar(50) | no | `''::character varying` |
| `created_at` | timestamptz | no | `` |
| `updated_at` | timestamptz | no | `` |

- **Primary key:** `id`
- **Indexes:**
  - `ix_app_password_vault_entries_group_archived`: (group_name, is_archived)
  - `ix_app_password_vault_entries_login_archived`: (login, is_archived)

---

### `app.password_vault_groups`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | varchar(64) | no | `` |
| `name` | varchar(120) | no | `''::character varying` |
| `is_active` | boolean | no | `true` |
| `sort_order` | integer | no | `0` |
| `created_by_user_id` | integer | no | `0` |
| `created_by_username` | varchar(50) | no | `''::character varying` |
| `updated_by_user_id` | integer | no | `0` |
| `updated_by_username` | varchar(50) | no | `''::character varying` |
| `created_at` | timestamptz | no | `` |
| `updated_at` | timestamptz | no | `` |

- **Primary key:** `id`
- **Indexes:**
  - `ix_app_password_vault_groups_active_sort`: (is_active, sort_order, name)
  - `uq_app_password_vault_groups_name` UNIQUE: (name)

---

### `app.push_outbox`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | integer | no | `nextval('app.push_outbox_id_seq'::regclass)` |
| `dedupe_key` | varchar(64) | no | `` |
| `recipient_user_id` | integer | no | `` |
| `channel` | varchar(32) | no | `'system'::character varying` |
| `title` | varchar(255) | no | `` |
| `body` | text | no | `` |
| `route` | varchar(1024) | no | `'/'::character varying` |
| `tag` | varchar(255) | no | `''::character varying` |
| `icon` | varchar(255) | no | `'/pwa-192.png'::character varying` |
| `badge` | varchar(255) | no | `'/hubit-badge.svg'::character varying` |
| `data_json` | text | no | `'{}'::text` |
| `ttl_seconds` | integer | no | `86400` |
| `app_badge_count` | integer | yes | `` |
| `status` | varchar(32) | no | `'queued'::character varying` |
| `attempt_count` | integer | no | `0` |
| `next_attempt_at` | timestamptz | no | `CURRENT_TIMESTAMP` |
| `expires_at` | timestamptz | no | `` |
| `last_error` | text | yes | `` |
| `created_at` | timestamptz | no | `CURRENT_TIMESTAMP` |
| `updated_at` | timestamptz | no | `CURRENT_TIMESTAMP` |
| `delivered_at` | timestamptz | yes | `` |

- **Primary key:** `id`
- **Indexes:**
  - `ix_app_push_outbox_channel`: (channel)
  - `ix_app_push_outbox_recipient_status`: (recipient_user_id, status)
  - `ix_app_push_outbox_recipient_user_id`: (recipient_user_id)
  - `ix_app_push_outbox_status`: (status)
  - `ix_app_push_outbox_status_next_attempt`: (status, next_attempt_at)
  - `ix_app_push_outbox_updated_at`: (updated_at)
  - `uq_app_push_outbox_dedupe_key` UNIQUE: (dedupe_key)

---

### `app.sessions`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `session_id` **PK** | varchar(64) | no | `` |
| `user_id` | integer | no | `` |
| `username` | varchar(50) | no | `` |
| `role` | varchar(20) | no | `` |
| `ip_address` | varchar(128) | no | `` |
| `user_agent` | text | no | `` |
| `created_at` | timestamptz | no | `` |
| `last_seen_at` | timestamptz | no | `` |
| `expires_at` | timestamptz | no | `` |
| `idle_expires_at` | timestamptz | yes | `` |
| `is_active` | boolean | no | `` |
| `status` | varchar(32) | no | `` |
| `closed_at` | timestamptz | yes | `` |
| `closed_reason` | varchar(32) | yes | `` |
| `device_label` | varchar(255) | yes | `` |
| `trusted_device_id` | varchar(64) | yes | `` |
| `login_network_zone` | varchar(16) | yes | `` |
| `client_device_key_hash` | varchar(64) | yes | `` |

- **Primary key:** `session_id`
- **Indexes:**
  - `ix_app_sessions_client_device_key_hash`: (client_device_key_hash)
  - `ix_app_sessions_is_active`: (is_active)
  - `ix_app_sessions_status`: (status)
  - `ix_app_sessions_trusted_device_id`: (trusted_device_id)
  - `ix_app_sessions_user_id`: (user_id)
  - `ix_app_sessions_username`: (username)

---

### `app.task_delegate_user_links`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | integer | no | `nextval('app.task_delegate_user_links_id_seq'::regclass)` |
| `owner_user_id` | integer | no | `` |
| `delegate_user_id` | integer | no | `` |
| `role_type` | varchar(32) | no | `'assistant'::character varying` |
| `is_active` | boolean | no | `true` |
| `created_at` | timestamptz | no | `` |
| `updated_at` | timestamptz | no | `` |

- **Primary key:** `id`
- **Indexes:**
  - `ix_task_delegate_user_links_delegate_user_id`: (delegate_user_id)
  - `ix_task_delegate_user_links_is_active`: (is_active)
  - `ix_task_delegate_user_links_owner_user_id`: (owner_user_id)
  - `uq_app_task_delegate_owner_delegate` UNIQUE: (owner_user_id, delegate_user_id)

---

### `app.telegram_probe_chats`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | varchar(255) | no | `` |
| `computer_name` | varchar(255) | no | `` |
| `windows_user` | varchar(255) | no | `''::character varying` |
| `chat_id` | varchar(128) | no | `` |
| `chat_name` | varchar(512) | no | `` |
| `messages_json` | text | no | `'[]'::text` |
| `updated_at` | timestamptz | no | `` |

- **Primary key:** `id`
- **Indexes:**
  - `ix_app_telegram_probe_chats_computer`: (computer_name)
  - `ix_app_telegram_probe_chats_updated_at`: (updated_at)
  - `uq_app_telegram_probe_chats_host_chat` UNIQUE: (computer_name, chat_id)

---

### `app.telegram_probe_media`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | varchar(512) | no | `` |
| `computer_name` | varchar(255) | no | `` |
| `file_name` | varchar(512) | no | `` |
| `content` | bytea | yes | `` |
| `content_type` | varchar(128) | no | `'application/octet-stream'::character varying` |
| `created_at` | timestamptz | no | `` |
| `storage_path` | varchar(1024) | yes | `` |

- **Primary key:** `id`
- **Indexes:**
  - `ix_app_telegram_probe_media_computer`: (computer_name)
  - `ix_app_telegram_probe_media_created_at`: (created_at)
  - `uq_app_telegram_probe_media_host_file` UNIQUE: (computer_name, file_name)

---

### `app.telegram_probe_reports`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `computer_name` **PK** | varchar(255) | no | `` |
| `windows_user` | varchar(255) | no | `''::character varying` |
| `html` | text | no | `''::text` |
| `updated_at` | timestamptz | no | `` |

- **Primary key:** `computer_name`

---

### `app.ticket_attachments`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | varchar(64) | no | `` |
| `request_id` | integer | no | `` |
| `file_name` | varchar(255) | no | `` |
| `file_type` | varchar(30) | no | `` |
| `file_size` | integer | no | `` |
| `storage_path` | text | no | `` |
| `uploaded_by_id` | integer | no | `` |
| `created_at` | timestamptz | no | `` |

- **Primary key:** `id`
- **Foreign keys:**
  - `request_id` → `app.ticket_requests` (`id`)
  - `uploaded_by_id` → `app.users` (`id`)
- **Indexes:**
  - `ix_ticket_attachments_request_id`: (request_id)

---

### `app.ticket_change_history`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | integer | no | `nextval('app.ticket_change_history_id_seq'::regclass)` |
| `request_id` | integer | no | `` |
| `field_name` | varchar(50) | no | `` |
| `old_value` | varchar(1000) | yes | `` |
| `new_value` | varchar(1000) | yes | `` |
| `changed_by_id` | integer | yes | `` |
| `source` | varchar(20) | no | `'manual'::character varying` |
| `comment` | varchar(500) | yes | `` |
| `created_at` | timestamptz | no | `` |

- **Primary key:** `id`
- **Foreign keys:**
  - `changed_by_id` → `app.users` (`id`)
  - `request_id` → `app.ticket_requests` (`id`)
- **Indexes:**
  - `ix_ticket_change_history_request_id`: (request_id)
  - `ix_ticket_change_history_request_id_created_at`: (request_id, created_at)

---

### `app.ticket_comments`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | integer | no | `nextval('app.ticket_comments_id_seq'::regclass)` |
| `request_id` | integer | no | `` |
| `author_id` | integer | yes | `` |
| `text` | text | no | `` |
| `comment_type` | varchar(20) | no | `'normal'::character varying` |
| `created_at` | timestamptz | no | `` |

- **Primary key:** `id`
- **Foreign keys:**
  - `author_id` → `app.users` (`id`)
  - `request_id` → `app.ticket_requests` (`id`)
- **Indexes:**
  - `ix_ticket_comments_request_id`: (request_id)
  - `ix_ticket_comments_request_id_created_at`: (request_id, created_at)

---

### `app.ticket_employee_documents`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | integer | no | `nextval('app.ticket_employee_documents_id_seq'::regclass)` |
| `employee_id` | integer | no | `` |
| `passport_series_number_enc` | text | no | `''::text` |
| `issued_by_enc` | text | no | `''::text` |
| `issue_date` | timestamptz | yes | `` |
| `registration_address_enc` | text | no | `''::text` |
| `is_current` | boolean | no | `true` |
| `created_at` | timestamptz | no | `` |
| `updated_at` | timestamptz | no | `` |
| `passport_series_enc` | text | no | `''::text` |
| `passport_number_enc` | text | no | `''::text` |
| `issuer_code_enc` | text | no | `''::text` |
| `birth_place_enc` | text | no | `''::text` |

- **Primary key:** `id`
- **Foreign keys:**
  - `employee_id` → `app.ticket_employees` (`id`)
- **Indexes:**
  - `ix_ticket_employee_documents_employee_id`: (employee_id)
  - `ix_ticket_employee_documents_is_current`: (is_current)

---

### `app.ticket_employees`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | integer | no | `nextval('app.ticket_employees_id_seq'::regclass)` |
| `full_name` | varchar(150) | no | `` |
| `date_of_birth_enc` | text | no | `''::text` |
| `phone` | varchar(30) | yes | `` |
| `email` | varchar(255) | yes | `` |
| `status` | varchar(20) | no | `'active'::character varying` |
| `app_user_id` | integer | yes | `` |
| `created_at` | timestamptz | no | `` |
| `updated_at` | timestamptz | no | `` |
| `department` | varchar(200) | yes | `` |
| `position` | varchar(150) | yes | `` |
| `zup_employee_code` | varchar(64) | yes | `` |

- **Primary key:** `id`
- **Foreign keys:**
  - `app_user_id` → `app.users` (`id`)
- **Indexes:**
  - `ix_ticket_employees_app_user_id`: (app_user_id)
  - `ix_ticket_employees_full_name`: (full_name)
  - `ix_ticket_employees_status`: (status)
  - `ix_ticket_employees_zup_employee_code` UNIQUE: (zup_employee_code)

---

### `app.ticket_financial_ops`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | integer | no | `nextval('app.ticket_financial_ops_id_seq'::regclass)` |
| `request_id` | integer | yes | `` |
| `employee_id` | integer | yes | `` |
| `object_id` | integer | yes | `` |
| `op_type` | varchar(20) | no | `` |
| `amount` | numeric | no | `0.00` |
| `reason` | varchar(500) | yes | `` |
| `refund_status` | varchar(30) | yes | `` |
| `op_date` | timestamptz | yes | `` |
| `is_deleted` | boolean | no | `false` |
| `created_at` | timestamptz | no | `` |
| `updated_at` | timestamptz | no | `` |

- **Primary key:** `id`
- **Foreign keys:**
  - `employee_id` → `app.ticket_employees` (`id`)
  - `object_id` → `app.ticket_objects` (`id`)
  - `request_id` → `app.ticket_requests` (`id`)
- **Indexes:**
  - `ix_ticket_financial_ops_is_deleted`: (is_deleted)
  - `ix_ticket_financial_ops_op_type_date`: (op_type, op_date)
  - `ix_ticket_financial_ops_request_id`: (request_id)

---

### `app.ticket_import_jobs`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | varchar(64) | no | `` |
| `file_name` | varchar(255) | no | `` |
| `file_path` | text | no | `` |
| `status` | varchar(20) | no | `'uploaded'::character varying` |
| `user_id` | integer | no | `` |
| `preview_json` | text | no | `'{}'::text` |
| `result_json` | text | no | `'{}'::text` |
| `created_at` | timestamptz | no | `` |
| `updated_at` | timestamptz | no | `` |

- **Primary key:** `id`

---

### `app.ticket_import_raw_traces`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | integer | no | `nextval('app.ticket_import_raw_traces_id_seq'::regclass)` |
| `job_id` | varchar(64) | no | `` |
| `request_id` | integer | yes | `` |
| `source_file` | varchar(255) | no | `` |
| `sheet_name` | varchar(100) | no | `` |
| `row_number` | integer | no | `` |
| `raw_cells_json` | text | no | `'{}'::text` |
| `cell_colors_json` | text | no | `'{}'::text` |
| `cell_formulas_json` | text | no | `'{}'::text` |
| `cell_comments_json` | text | no | `'{}'::text` |
| `cell_hyperlinks_json` | text | no | `'{}'::text` |
| `cell_addresses_json` | text | no | `'{}'::text` |
| `sheet_visibility` | varchar(20) | no | `'visible'::character varying` |
| `created_at` | timestamptz | no | `` |

- **Primary key:** `id`
- **Foreign keys:**
  - `job_id` → `app.ticket_import_jobs` (`id`)
  - `request_id` → `app.ticket_requests` (`id`)
- **Indexes:**
  - `ix_ticket_import_raw_traces_job_id`: (job_id)
  - `ix_ticket_import_raw_traces_request_id`: (request_id)

---

### `app.ticket_items`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | integer | no | `nextval('app.ticket_items_id_seq'::regclass)` |
| `request_id` | integer | no | `` |
| `transport_type` | varchar(20) | no | `` |
| `route` | varchar(500) | yes | `` |
| `departure_date` | timestamptz | yes | `` |
| `cost` | numeric | no | `0.00` |
| `status` | varchar(20) | no | `'pending'::character varying` |
| `created_at` | timestamptz | no | `` |
| `updated_at` | timestamptz | no | `` |

- **Primary key:** `id`
- **Foreign keys:**
  - `request_id` → `app.ticket_requests` (`id`)
- **Indexes:**
  - `ix_ticket_items_request_id`: (request_id)

---

### `app.ticket_notification_rules`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | integer | no | `nextval('app.ticket_notification_rules_id_seq'::regclass)` |
| `rule_type` | varchar(50) | no | `` |
| `is_enabled` | boolean | no | `true` |
| `threshold_days` | integer | yes | `` |
| `notify_roles` | varchar(200) | no | `'admin,operator'::character varying` |
| `created_at` | timestamptz | no | `` |
| `updated_at` | timestamptz | no | `` |

- **Primary key:** `id`
- **Indexes:**
  - `ticket_notification_rules_rule_type_key` UNIQUE: (rule_type)

---

### `app.ticket_objects`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | integer | no | `nextval('app.ticket_objects_id_seq'::regclass)` |
| `code` | varchar(10) | no | `` |
| `name` | varchar(150) | no | `` |
| `short_name` | varchar(50) | yes | `` |
| `region` | varchar(100) | no | `` |
| `default_assignee_id` | integer | yes | `` |
| `is_active` | boolean | no | `true` |
| `created_at` | timestamptz | no | `` |
| `updated_at` | timestamptz | no | `` |

- **Primary key:** `id`
- **Foreign keys:**
  - `default_assignee_id` → `app.users` (`id`)
- **Indexes:**
  - `ix_ticket_objects_code`: (code)
  - `ix_ticket_objects_is_active`: (is_active)
  - `uq_ticket_objects_code` UNIQUE: (code)

---

### `app.ticket_requests`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | integer | no | `nextval('app.ticket_requests_id_seq'::regclass)` |
| `employee_id` | integer | no | `` |
| `object_id` | integer | no | `` |
| `status` | varchar(30) | no | `'not_started'::character varying` |
| `assignee_id` | integer | yes | `` |
| `submitted_at` | timestamptz | yes | `` |
| `departure_date` | timestamptz | yes | `` |
| `arrival_date` | timestamptz | yes | `` |
| `route` | varchar(500) | yes | `` |
| `total_cost` | numeric | no | `0.00` |
| `is_urgent` | boolean | no | `false` |
| `needs_review` | boolean | no | `false` |
| `source` | varchar(20) | no | `'manual'::character varying` |
| `version` | integer | no | `1` |
| `created_at` | timestamptz | no | `` |
| `updated_at` | timestamptz | no | `` |
| `note` | text | yes | `` |
| `refund_loss` | numeric | no | `0.00` |

- **Primary key:** `id`
- **Foreign keys:**
  - `assignee_id` → `app.users` (`id`)
  - `employee_id` → `app.ticket_employees` (`id`)
  - `object_id` → `app.ticket_objects` (`id`)
- **Indexes:**
  - `ix_ticket_requests_assignee_id`: (assignee_id)
  - `ix_ticket_requests_created_at`: (created_at)
  - `ix_ticket_requests_employee_id`: (employee_id)
  - `ix_ticket_requests_object_id`: (object_id)
  - `ix_ticket_requests_status`: (status)

---

### `app.transfer_act_jobs`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | varchar(64) | no | `` |
| `operation` | varchar(32) | no | `` |
| `status` | varchar(24) | no | `` |
| `status_text` | text | no | `` |
| `db_id` | varchar(128) | yes | `` |
| `user_id` | integer | yes | `` |
| `username` | varchar(50) | no | `` |
| `request_count` | integer | no | `` |
| `payload_json` | text | no | `` |
| `result_json` | text | no | `` |
| `error_text` | text | yes | `` |
| `started_at` | timestamptz | yes | `` |
| `completed_at` | timestamptz | yes | `` |
| `created_at` | timestamptz | no | `` |
| `updated_at` | timestamptz | no | `` |

- **Primary key:** `id`
- **Indexes:**
  - `ix_app_transfer_act_jobs_db_id`: (db_id)
  - `ix_app_transfer_act_jobs_operation`: (operation)
  - `ix_app_transfer_act_jobs_status`: (status)
  - `ix_app_transfer_act_jobs_status_created_at`: (status, created_at)
  - `ix_app_transfer_act_jobs_user_created_at`: (user_id, created_at)
  - `ix_app_transfer_act_jobs_user_id`: (user_id)

---

### `app.trusted_devices`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | varchar(64) | no | `` |
| `user_id` | integer | no | `` |
| `label` | varchar(255) | no | `` |
| `credential_id` | text | no | `` |
| `public_key_b64` | text | no | `` |
| `sign_count` | integer | no | `` |
| `transports_json` | text | no | `` |
| `aaguid` | varchar(128) | yes | `` |
| `rp_id` | varchar(255) | no | `` |
| `origin` | varchar(255) | no | `` |
| `last_used_at` | timestamptz | yes | `` |
| `created_at` | timestamptz | no | `` |
| `revoked_at` | timestamptz | yes | `` |
| `is_active` | boolean | no | `` |
| `is_discoverable` | boolean | no | `` |
| `expires_at` | timestamptz | yes | `` |

- **Primary key:** `id`
- **Indexes:**
  - `ix_app_trusted_devices_expires_at`: (expires_at)
  - `ix_app_trusted_devices_is_active`: (is_active)
  - `ix_app_trusted_devices_user_id`: (user_id)
  - `uq_app_trusted_devices_credential_id` UNIQUE: (credential_id)

---

### `app.user_2fa_backup_codes`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | integer | no | `nextval('app.user_2fa_backup_codes_id_seq'::regclass)` |
| `user_id` | integer | no | `` |
| `code_hash` | text | no | `` |
| `code_suffix` | varchar(16) | no | `` |
| `used_at` | timestamptz | yes | `` |
| `created_at` | timestamptz | no | `` |

- **Primary key:** `id`
- **Indexes:**
  - `ix_app_user_2fa_backup_codes_user_id`: (user_id)

---

### `app.user_db_selection`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `telegram_id` **PK** | integer | no | `nextval('app.user_db_selection_telegram_id_seq'::regclass)` |
| `database_id` | varchar(128) | no | `` |
| `updated_at` | timestamptz | no | `` |

- **Primary key:** `telegram_id`

---

### `app.user_mailboxes`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | varchar(64) | no | `` |
| `user_id` | integer | no | `` |
| `label` | varchar(255) | no | `''::character varying` |
| `mailbox_email` | varchar(255) | no | `` |
| `mailbox_login` | varchar(255) | yes | `` |
| `mailbox_password_enc` | text | no | `''::text` |
| `auth_mode` | varchar(32) | no | `'stored_credentials'::character varying` |
| `is_primary` | boolean | no | `true` |
| `is_active` | boolean | no | `true` |
| `sort_order` | integer | no | `0` |
| `last_selected_at` | timestamptz | yes | `` |
| `created_at` | timestamptz | no | `` |
| `updated_at` | timestamptz | no | `` |

- **Primary key:** `id`
- **Indexes:**
  - `ix_app_user_mailboxes_user_id`: (user_id)
  - `ix_app_user_mailboxes_user_id_is_active`: (user_id, is_active)
  - `ix_app_user_mailboxes_user_id_is_primary`: (user_id, is_primary)
  - `uq_app_user_mailboxes_primary_per_user` UNIQUE: (user_id)
  - `uq_app_user_mailboxes_user_email` UNIQUE: (user_id, mailbox_email)

---

### `app.user_settings`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `user_id` **PK** | integer | no | `nextval('app.user_settings_user_id_seq'::regclass)` |
| `pinned_database` | varchar(128) | yes | `` |
| `theme_mode` | varchar(16) | no | `` |
| `font_family` | varchar(32) | no | `` |
| `font_scale` | double precision | no | `` |
| `updated_at` | timestamptz | no | `` |
| `dashboard_mobile_sections` | text | yes | `` |
| `mobile_bottom_nav_items` | text | yes | `` |
| `database_branch_filters` | text | yes | `` |
| `ai_personal_memory_enabled` | boolean | no | `true` |

- **Primary key:** `user_id`

---

### `app.users`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | integer | no | `nextval('app.users_id_seq'::regclass)` |
| `username` | varchar(50) | no | `` |
| `email` | varchar(255) | yes | `` |
| `full_name` | varchar(255) | yes | `` |
| `is_active` | boolean | no | `` |
| `role` | varchar(20) | no | `` |
| `use_custom_permissions` | boolean | no | `` |
| `custom_permissions_json` | text | no | `` |
| `auth_source` | varchar(20) | no | `` |
| `telegram_id` | integer | yes | `` |
| `assigned_database` | varchar(128) | yes | `` |
| `mailbox_email` | varchar(255) | yes | `` |
| `mailbox_login` | varchar(255) | yes | `` |
| `mailbox_password_enc` | text | no | `` |
| `mail_signature_html` | text | yes | `` |
| `mail_updated_at` | timestamptz | yes | `` |
| `password_hash` | text | no | `` |
| `password_salt` | text | no | `` |
| `created_at` | timestamptz | no | `` |
| `updated_at` | timestamptz | no | `` |
| `department` | varchar(255) | yes | `` |
| `job_title` | varchar(255) | yes | `` |
| `totp_secret_enc` | text | no | `` |
| `is_2fa_enabled` | boolean | no | `` |
| `twofa_enabled_at` | timestamptz | yes | `` |
| `about_onboarding_completed_at` | timestamptz | yes | `` |
| `my_files_quota_bytes` | bigint | yes | `` |

- **Primary key:** `id`
- **Indexes:**
  - `ix_app_users_is_2fa_enabled`: (is_2fa_enabled)
  - `ix_app_users_is_active`: (is_active)
  - `ix_app_users_telegram_id`: (telegram_id)
  - `ix_app_users_username`: (username)
  - `uq_app_users_username` UNIQUE: (username)

---

### `app.vcs_computers`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | varchar(64) | no | `` |
| `name` | varchar(100) | no | `` |
| `ip_address` | varchar(50) | no | `` |
| `location` | varchar(255) | yes | `` |
| `created_at` | timestamptz | no | `` |
| `updated_at` | timestamptz | no | `` |

- **Primary key:** `id`
- **Indexes:**
  - `ix_vcs_computers_ip_address`: (ip_address)
  - `ix_vcs_computers_name`: (name)

---

## Schema `chat` (33 tables)

### `chat.chat_attachment_previews`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `attachment_id` **PK** | varchar(36) | no | `` |
| `status` | varchar(20) | no | `'queued'::character varying` |
| `attempt_count` | integer | no | `0` |
| `next_attempt_at` | timestamptz | no | `` |
| `lease_owner` | varchar(64) | yes | `` |
| `lease_expires_at` | timestamptz | yes | `` |
| `artifact_rel_path` | text | no | `''::text` |
| `pdf_filename` | varchar(255) | no | `''::character varying` |
| `source_kind` | varchar(32) | no | `''::character varying` |
| `page_count` | integer | no | `0` |
| `sheets_json` | text | no | `'[]'::text` |
| `last_error` | text | no | `''::text` |
| `created_at` | timestamptz | no | `` |
| `updated_at` | timestamptz | no | `` |
| `ready_at` | timestamptz | yes | `` |

- **Primary key:** `attachment_id`
- **Foreign keys:**
  - `attachment_id` → `chat.chat_message_attachments` (`id`)
- **Indexes:**
  - `ix_chat_attachment_previews_lease_expires`: (lease_expires_at)
  - `ix_chat_attachment_previews_status_next_attempt`: (status, next_attempt_at)

---

### `chat.chat_call_participants`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | integer | no | `nextval('chat.chat_call_participants_id_seq'::regclass)` |
| `call_id` | varchar(36) | no | `` |
| `user_id` | integer | no | `` |
| `state` | varchar(16) | no | `'invited'::character varying` |
| `joined_at` | timestamptz | yes | `` |
| `left_at` | timestamptz | yes | `` |

- **Primary key:** `id`
- **Foreign keys:**
  - `call_id` → `chat.chat_calls` (`id`)
- **Indexes:**
  - `ix_chat_call_participants_call_id`: (call_id)
  - `ix_chat_call_participants_user_state`: (user_id, state)
  - `uq_chat_call_participants_call_user` UNIQUE: (call_id, user_id)

---

### `chat.chat_calls`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | varchar(36) | no | `` |
| `conversation_id` | varchar(36) | no | `` |
| `conversation_kind` | varchar(20) | no | `'direct'::character varying` |
| `media` | varchar(8) | no | `'audio'::character varying` |
| `status` | varchar(16) | no | `'ringing'::character varying` |
| `initiator_user_id` | integer | no | `` |
| `started_at` | timestamptz | no | `now()` |
| `answered_at` | timestamptz | yes | `` |
| `ended_at` | timestamptz | yes | `` |
| `end_reason` | varchar(16) | yes | `` |
| `updated_at` | timestamptz | no | `now()` |

- **Primary key:** `id`
- **Foreign keys:**
  - `conversation_id` → `chat.chat_conversations` (`id`)
- **Indexes:**
  - `ix_chat_calls_conversation_id`: (conversation_id)
  - `ix_chat_calls_status_started_at`: (status, started_at)
  - `uq_chat_calls_one_open_per_conversation` UNIQUE: (conversation_id)

---

### `chat.chat_conversation_user_state`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | integer | no | `nextval('chat.chat_conversation_user_state_id_seq'::regclass)` |
| `conversation_id` | varchar(36) | no | `` |
| `user_id` | integer | no | `` |
| `last_read_message_id` | varchar(36) | yes | `` |
| `last_read_at` | timestamptz | yes | `` |
| `is_pinned` | boolean | no | `` |
| `is_muted` | boolean | no | `` |
| `is_archived` | boolean | no | `` |
| `opened_at` | timestamptz | yes | `` |
| `updated_at` | timestamptz | no | `` |
| `last_read_seq` | bigint | no | `` |
| `unread_count` | integer | no | `` |
| `muted_until` | timestamptz | yes | `` |
| `unread_mention_count` | integer | no | `0` |

- **Primary key:** `id`
- **Foreign keys:**
  - `conversation_id` → `chat.chat_conversations` (`id`)
- **Indexes:**
  - `idx_chat_conversation_user_state_is_archived`: (is_archived)
  - `idx_chat_conversation_user_state_last_read_seq`: (last_read_seq)
  - `idx_chat_conversation_user_state_unread_count`: (unread_count)
  - `ix_chat_conversation_user_state_conversation_id`: (conversation_id)
  - `ix_chat_conversation_user_state_user_id`: (user_id)
  - `uq_chat_conversation_user_state_conversation_user` UNIQUE: (conversation_id, user_id)

---

### `chat.chat_conversations`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | varchar(36) | no | `` |
| `kind` | varchar(20) | no | `` |
| `direct_key` | varchar(64) | yes | `` |
| `title` | varchar(255) | yes | `` |
| `created_by_user_id` | integer | no | `` |
| `created_at` | timestamptz | no | `` |
| `updated_at` | timestamptz | no | `` |
| `last_message_id` | varchar(36) | yes | `` |
| `last_message_at` | timestamptz | yes | `` |
| `is_archived` | boolean | no | `` |
| `last_message_seq` | bigint | no | `` |
| `avatar_url` | varchar(512) | yes | `` |
| `task_id` | varchar(64) | yes | `` |
| `pinned_message_id` | varchar(36) | yes | `` |
| `pinned_at` | timestamptz | yes | `` |
| `pinned_by_user_id` | integer | yes | `` |

- **Primary key:** `id`
- **Indexes:**
  - `idx_chat_conversations_last_message_seq`: (last_message_seq)
  - `ix_chat_conversations_direct_key` UNIQUE: (direct_key)
  - `ix_chat_conversations_kind`: (kind)
  - `ix_chat_conversations_kind_task_id`: (kind, task_id)
  - `ix_chat_conversations_last_message_at`: (last_message_at)
  - `ix_chat_conversations_last_message_id`: (last_message_id)
  - `ix_chat_conversations_pinned_message_id`: (pinned_message_id)
  - `uq_chat_conversations_task_id` UNIQUE: (task_id)

---

### `chat.chat_event_outbox`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | integer | no | `nextval('chat.chat_event_outbox_id_seq'::regclass)` |
| `event_type` | varchar(64) | no | `` |
| `target_scope` | varchar(16) | no | `` |
| `target_user_id` | integer | no | `` |
| `conversation_id` | varchar(36) | yes | `` |
| `message_id` | varchar(36) | yes | `` |
| `payload_json` | text | no | `` |
| `dedupe_key` | varchar(255) | yes | `` |
| `status` | varchar(32) | no | `` |
| `attempt_count` | integer | no | `` |
| `next_attempt_at` | timestamptz | no | `` |
| `last_error` | text | yes | `` |
| `created_at` | timestamptz | no | `` |
| `updated_at` | timestamptz | no | `` |

- **Primary key:** `id`
- **Indexes:**
  - `ix_chat_event_outbox_conversation_id`: (conversation_id)
  - `ix_chat_event_outbox_event_type`: (event_type)
  - `ix_chat_event_outbox_message_id`: (message_id)
  - `ix_chat_event_outbox_status`: (status)
  - `ix_chat_event_outbox_status_next_attempt_at`: (status, next_attempt_at)
  - `ix_chat_event_outbox_target_user_id`: (target_user_id)
  - `ix_chat_event_outbox_target_user_id_status`: (target_user_id, status)
  - `ix_chat_event_outbox_updated_at`: (updated_at)
  - `uq_chat_event_outbox_dedupe_key` UNIQUE: (dedupe_key)

---

### `chat.chat_folder_conversations`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | integer | no | `nextval('chat.chat_folder_conversations_id_seq'::regclass)` |
| `folder_id` | varchar(36) | no | `` |
| `conversation_id` | varchar(36) | no | `` |
| `user_id` | integer | no | `` |
| `added_at` | timestamptz | no | `CURRENT_TIMESTAMP` |

- **Primary key:** `id`
- **Foreign keys:**
  - `conversation_id` → `chat.chat_conversations` (`id`)
  - `folder_id` → `chat.chat_folders` (`id`)
- **Indexes:**
  - `ix_chat_folder_conversations_conversation_id`: (conversation_id)
  - `ix_chat_folder_conversations_folder_id`: (folder_id)
  - `ix_chat_folder_conversations_user_id`: (user_id)
  - `ix_chat_folder_conversations_user_id_folder_id`: (user_id, folder_id)
  - `uq_chat_folder_conversations_folder_conversation` UNIQUE: (folder_id, conversation_id)

---

### `chat.chat_folders`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | varchar(36) | no | `` |
| `user_id` | integer | no | `` |
| `name` | varchar(64) | no | `` |
| `sort_order` | integer | no | `0` |
| `created_at` | timestamptz | no | `CURRENT_TIMESTAMP` |
| `updated_at` | timestamptz | no | `CURRENT_TIMESTAMP` |

- **Primary key:** `id`
- **Indexes:**
  - `ix_chat_folders_user_id`: (user_id)
  - `ix_chat_folders_user_id_sort_order`: (user_id, sort_order)

---

### `chat.chat_group_admin_audit`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | varchar(36) | no | `` |
| `conversation_id` | varchar(36) | no | `` |
| `actor_user_id` | integer | no | `` |
| `action` | varchar(32) | no | `` |
| `target_user_id` | integer | yes | `` |
| `details` | text | yes | `` |
| `created_at` | timestamptz | no | `now()` |

- **Primary key:** `id`
- **Indexes:**
  - `ix_chat_group_admin_audit_conversation_id_created_at`: (conversation_id, created_at)

---

### `chat.chat_group_invites`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | varchar(36) | no | `` |
| `conversation_id` | varchar(36) | no | `` |
| `token_hash` | varchar(64) | no | `` |
| `created_by_user_id` | integer | no | `` |
| `created_at` | timestamptz | no | `now()` |
| `expires_at` | timestamptz | no | `` |
| `revoked_at` | timestamptz | yes | `` |
| `use_count` | integer | no | `0` |

- **Primary key:** `id`
- **Foreign keys:**
  - `conversation_id` → `chat.chat_conversations` (`id`)
- **Indexes:**
  - `ix_chat_group_invites_conversation_id_revoked_at`: (conversation_id, revoked_at)
  - `uq_chat_group_invites_token_hash` UNIQUE: (token_hash)

---

### `chat.chat_group_join_requests`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | varchar(36) | no | `` |
| `conversation_id` | varchar(36) | no | `` |
| `user_id` | integer | no | `` |
| `status` | varchar(16) | no | `'pending'::character varying` |
| `created_at` | timestamptz | no | `now()` |
| `resolved_by_user_id` | integer | yes | `` |
| `resolved_at` | timestamptz | yes | `` |

- **Primary key:** `id`
- **Foreign keys:**
  - `conversation_id` → `chat.chat_conversations` (`id`)
- **Indexes:**
  - `ix_chat_group_join_requests_conversation_id_status`: (conversation_id, status)
  - `uq_chat_group_join_requests_conversation_user` UNIQUE: (conversation_id, user_id)

---

### `chat.chat_group_join_settings`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `conversation_id` **PK** | varchar(36) | no | `` |
| `approval_required` | boolean | no | `false` |
| `updated_by_user_id` | integer | yes | `` |
| `updated_at` | timestamptz | no | `now()` |

- **Primary key:** `conversation_id`
- **Foreign keys:**
  - `conversation_id` → `chat.chat_conversations` (`id`)

---

### `chat.chat_group_limits`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `conversation_id` **PK** | varchar(36) | no | `` |
| `slow_mode_seconds` | integer | no | `0` |
| `updated_by_user_id` | integer | yes | `` |
| `updated_at` | timestamptz | no | `now()` |

- **Primary key:** `conversation_id`
- **Foreign keys:**
  - `conversation_id` → `chat.chat_conversations` (`id`)

---

### `chat.chat_group_permissions`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `conversation_id` **PK** | varchar(36) | no | `` |
| `members_send_files` | boolean | no | `true` |
| `updated_by_user_id` | integer | yes | `` |
| `updated_at` | timestamptz | no | `now()` |

- **Primary key:** `conversation_id`
- **Foreign keys:**
  - `conversation_id` → `chat.chat_conversations` (`id`)

---

### `chat.chat_group_restrictions`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `conversation_id` **PK** | varchar(36) | no | `` |
| `user_id` **PK** | integer | no | `` |
| `restricted_until` | timestamptz | yes | `` |
| `restricted_by_user_id` | integer | yes | `` |
| `created_at` | timestamptz | no | `now()` |

- **Primary key:** `conversation_id, user_id`
- **Foreign keys:**
  - `conversation_id` → `chat.chat_conversations` (`id`)
- **Indexes:**
  - `ix_chat_group_restrictions_user_id`: (user_id)

---

### `chat.chat_group_settings`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `conversation_id` **PK** | varchar(36) | no | `` |
| `description` | text | yes | `` |
| `posting_policy` | varchar(16) | no | `'all'::character varying` |
| `updated_by_user_id` | integer | yes | `` |
| `updated_at` | timestamptz | no | `now()` |

- **Primary key:** `conversation_id`
- **Foreign keys:**
  - `conversation_id` → `chat.chat_conversations` (`id`)

---

### `chat.chat_members`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | integer | no | `nextval('chat.chat_members_id_seq'::regclass)` |
| `conversation_id` | varchar(36) | no | `` |
| `user_id` | integer | no | `` |
| `member_role` | varchar(20) | no | `` |
| `joined_at` | timestamptz | no | `` |
| `left_at` | timestamptz | yes | `` |

- **Primary key:** `id`
- **Foreign keys:**
  - `conversation_id` → `chat.chat_conversations` (`id`)
- **Indexes:**
  - `ix_chat_members_conversation_id`: (conversation_id)
  - `ix_chat_members_conversation_id_left_at_user_id`: (conversation_id, left_at, user_id)
  - `ix_chat_members_user_id`: (user_id)
  - `ix_chat_members_user_id_left_at_conversation_id`: (user_id, left_at, conversation_id)
  - `uq_chat_members_conversation_user` UNIQUE: (conversation_id, user_id)

---

### `chat.chat_message_attachments`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | varchar(36) | no | `` |
| `message_id` | varchar(36) | no | `` |
| `conversation_id` | varchar(36) | no | `` |
| `storage_name` | varchar(255) | no | `` |
| `file_name` | varchar(255) | no | `` |
| `mime_type` | varchar(255) | yes | `` |
| `file_size` | integer | no | `` |
| `uploaded_by_user_id` | integer | no | `` |
| `created_at` | timestamptz | no | `` |
| `width` | integer | yes | `` |
| `height` | integer | yes | `` |
| `media_kind` | varchar(20) | yes | `` |
| `duration_seconds` | integer | yes | `` |

- **Primary key:** `id`
- **Foreign keys:**
  - `conversation_id` → `chat.chat_conversations` (`id`)
  - `message_id` → `chat.chat_messages` (`id`)
- **Indexes:**
  - `ix_chat_message_attachments_conversation_created_id`: (conversation_id, created_at, id)
  - `ix_chat_message_attachments_conversation_id`: (conversation_id)
  - `ix_chat_message_attachments_created_at`: (created_at)
  - `ix_chat_message_attachments_message_id`: (message_id)
  - `ix_chat_message_attachments_uploaded_by_user_id`: (uploaded_by_user_id)

---

### `chat.chat_message_mentions`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | integer | no | `nextval('chat.chat_message_mentions_id_seq'::regclass)` |
| `message_id` | varchar(36) | no | `` |
| `conversation_id` | varchar(36) | no | `` |
| `user_id` | integer | no | `` |
| `created_at` | timestamptz | no | `now()` |

- **Primary key:** `id`
- **Foreign keys:**
  - `conversation_id` → `chat.chat_conversations` (`id`)
  - `message_id` → `chat.chat_messages` (`id`)
- **Indexes:**
  - `ix_chat_message_mentions_conversation_user`: (conversation_id, user_id)
  - `ix_chat_message_mentions_message_id`: (message_id)
  - `uq_chat_message_mentions_message_user` UNIQUE: (message_id, user_id)

---

### `chat.chat_message_pins`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `conversation_id` **PK** | varchar(36) | no | `` |
| `message_id` **PK** | varchar(36) | no | `` |
| `pinned_by_user_id` | integer | yes | `` |
| `pinned_at` | timestamptz | no | `now()` |

- **Primary key:** `conversation_id, message_id`
- **Foreign keys:**
  - `conversation_id` → `chat.chat_conversations` (`id`)
  - `message_id` → `chat.chat_messages` (`id`)
- **Indexes:**
  - `ix_chat_message_pins_conversation_id_pinned_at`: (conversation_id, pinned_at)

---

### `chat.chat_message_reactions`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | integer | no | `nextval('chat.chat_message_reactions_id_seq'::regclass)` |
| `message_id` | varchar(36) | no | `` |
| `conversation_id` | varchar(36) | no | `` |
| `user_id` | integer | no | `` |
| `emoji` | varchar(32) | no | `` |
| `created_at` | timestamptz | no | `` |

- **Primary key:** `id`
- **Foreign keys:**
  - `conversation_id` → `chat.chat_conversations` (`id`)
  - `message_id` → `chat.chat_messages` (`id`)
- **Indexes:**
  - `ix_chat_message_reactions_conversation_id`: (conversation_id)
  - `ix_chat_message_reactions_message_id`: (message_id)
  - `ix_chat_message_reactions_user_id`: (user_id)
  - `uq_chat_message_reactions_message_user_emoji` UNIQUE: (message_id, user_id, emoji)

---

### `chat.chat_message_reads`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | integer | no | `nextval('chat.chat_message_reads_id_seq'::regclass)` |
| `conversation_id` | varchar(36) | no | `` |
| `user_id` | integer | no | `` |
| `message_id` | varchar(36) | no | `` |
| `read_at` | timestamptz | no | `` |

- **Primary key:** `id`
- **Foreign keys:**
  - `conversation_id` → `chat.chat_conversations` (`id`)
  - `message_id` → `chat.chat_messages` (`id`)
- **Indexes:**
  - `ix_chat_message_reads_conversation_id`: (conversation_id)
  - `ix_chat_message_reads_message_id`: (message_id)
  - `ix_chat_message_reads_user_id`: (user_id)
  - `uq_chat_message_reads_conversation_user_message` UNIQUE: (conversation_id, user_id, message_id)

---

### `chat.chat_message_reports`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | varchar(36) | no | `` |
| `conversation_id` | varchar(36) | no | `` |
| `message_id` | varchar(36) | no | `` |
| `reporter_user_id` | integer | no | `` |
| `reason` | varchar(16) | no | `` |
| `comment` | varchar(500) | yes | `` |
| `status` | varchar(16) | no | `'open'::character varying` |
| `created_at` | timestamptz | no | `now()` |
| `resolved_by_user_id` | integer | yes | `` |
| `resolved_at` | timestamptz | yes | `` |

- **Primary key:** `id`
- **Foreign keys:**
  - `conversation_id` → `chat.chat_conversations` (`id`)
  - `message_id` → `chat.chat_messages` (`id`)
- **Indexes:**
  - `ix_chat_message_reports_conversation_id_status`: (conversation_id, status)
  - `uq_chat_message_reports_message_reporter` UNIQUE: (message_id, reporter_user_id)

---

### `chat.chat_messages`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | varchar(36) | no | `` |
| `conversation_id` | varchar(36) | no | `` |
| `sender_user_id` | integer | no | `` |
| `kind` | varchar(20) | no | `` |
| `body` | text | no | `` |
| `reply_to_message_id` | varchar(36) | yes | `` |
| `task_id` | varchar(64) | yes | `` |
| `task_preview_json` | text | yes | `` |
| `created_at` | timestamptz | no | `` |
| `edited_at` | timestamptz | yes | `` |
| `forward_from_message_id` | varchar(36) | yes | `` |
| `client_message_id` | varchar(128) | yes | `` |
| `conversation_seq` | bigint | no | `` |
| `is_deleted` | boolean | no | `false` |
| `deleted_at` | timestamptz | yes | `` |
| `deleted_by_user_id` | integer | yes | `` |
| `deleted_reason` | varchar(64) | yes | `` |
| `body_format` | varchar(16) | no | `'plain'::character varying` |

- **Primary key:** `id`
- **Foreign keys:**
  - `conversation_id` → `chat.chat_conversations` (`id`)
- **Indexes:**
  - `idx_chat_messages_body_trgm`: ((expression))
  - `idx_chat_messages_client_message_id`: (client_message_id)
  - `idx_chat_messages_conversation_id_conversation_seq`: (conversation_id, conversation_seq)
  - `ix_chat_messages_body_format`: (body_format)
  - `ix_chat_messages_conversation_id`: (conversation_id)
  - `ix_chat_messages_conversation_id_created_at_id`: (conversation_id, created_at, id)
  - `ix_chat_messages_created_at`: (created_at)
  - `ix_chat_messages_deleted_by_user_id`: (deleted_by_user_id)
  - `ix_chat_messages_forward_from_message_id`: (forward_from_message_id)
  - `ix_chat_messages_is_deleted`: (is_deleted)
  - `ix_chat_messages_kind`: (kind)
  - `ix_chat_messages_reply_to_message_id`: (reply_to_message_id)
  - `ix_chat_messages_sender_user_id`: (sender_user_id)
  - `ix_chat_messages_task_id`: (task_id)
  - `uq_chat_messages_conversation_sender_client_message` UNIQUE: (conversation_id, sender_user_id, client_message_id)
  - `uq_chat_messages_conversation_seq` UNIQUE: (conversation_id, conversation_seq)

---

### `chat.chat_poll_votes`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | varchar(36) | no | `` |
| `message_id` | varchar(36) | no | `` |
| `conversation_id` | varchar(36) | no | `` |
| `user_id` | integer | no | `` |
| `option_index` | integer | no | `` |
| `created_at` | timestamptz | no | `` |

- **Primary key:** `id`
- **Foreign keys:**
  - `conversation_id` → `chat.chat_conversations` (`id`)
  - `message_id` → `chat.chat_messages` (`id`)
- **Indexes:**
  - `ix_chat_poll_votes_conversation`: (conversation_id, message_id)
  - `ix_chat_poll_votes_created_at`: (created_at)
  - `ix_chat_poll_votes_message_id`: (message_id)
  - `ix_chat_poll_votes_user_id`: (user_id)
  - `uq_chat_poll_votes_message_user` UNIQUE: (message_id, user_id)

---

### `chat.chat_push_outbox`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | integer | no | `nextval('chat.chat_push_outbox_id_seq'::regclass)` |
| `message_id` | varchar(36) | no | `` |
| `conversation_id` | varchar(36) | no | `` |
| `recipient_user_id` | integer | no | `` |
| `channel` | varchar(32) | no | `` |
| `title` | varchar(255) | no | `` |
| `body` | text | no | `` |
| `status` | varchar(32) | no | `` |
| `attempt_count` | integer | no | `` |
| `next_attempt_at` | timestamptz | no | `` |
| `last_error` | text | yes | `` |
| `created_at` | timestamptz | no | `` |
| `updated_at` | timestamptz | no | `` |
| `is_mention` | boolean | no | `` |

- **Primary key:** `id`
- **Indexes:**
  - `ix_chat_push_outbox_conversation_id`: (conversation_id)
  - `ix_chat_push_outbox_message_id`: (message_id)
  - `ix_chat_push_outbox_recipient_user_id`: (recipient_user_id)
  - `ix_chat_push_outbox_recipient_user_id_status`: (recipient_user_id, status)
  - `ix_chat_push_outbox_status`: (status)
  - `ix_chat_push_outbox_status_next_attempt_at`: (status, next_attempt_at)
  - `ix_chat_push_outbox_updated_at`: (updated_at)
  - `uq_chat_push_outbox_message_recipient_channel` UNIQUE: (message_id, recipient_user_id, channel)

---

### `chat.chat_push_subscriptions`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | integer | no | `nextval('chat.chat_push_subscriptions_id_seq'::regclass)` |
| `user_id` | integer | no | `` |
| `endpoint` | varchar(2048) | no | `` |
| `p256dh_key` | varchar(512) | no | `` |
| `auth_key` | varchar(512) | no | `` |
| `expiration_time` | integer | yes | `` |
| `user_agent` | varchar(512) | yes | `` |
| `platform` | varchar(128) | yes | `` |
| `browser_family` | varchar(64) | yes | `` |
| `install_mode` | varchar(64) | yes | `` |
| `is_active` | boolean | no | `` |
| `failure_count` | integer | no | `` |
| `created_at` | timestamptz | no | `` |
| `updated_at` | timestamptz | no | `` |
| `last_seen_at` | timestamptz | yes | `` |
| `last_push_at` | timestamptz | yes | `` |
| `last_error_at` | timestamptz | yes | `` |
| `last_error_text` | text | yes | `` |

- **Primary key:** `id`
- **Indexes:**
  - `ix_chat_push_subscriptions_is_active`: (is_active)
  - `ix_chat_push_subscriptions_user_id`: (user_id)
  - `uq_chat_push_subscriptions_endpoint` UNIQUE: (endpoint)

---

### `chat.chat_realtime_events`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | bigint | no | `nextval('chat.chat_realtime_events_id_seq'::regclass)` |
| `origin_node_id` | varchar(128) | no | `` |
| `payload_json` | text | no | `` |
| `created_at` | timestamptz | no | `now()` |
| `expires_at` | timestamptz | no | `` |

- **Primary key:** `id`
- **Indexes:**
  - `ix_chat_realtime_events_expires_at`: (expires_at)

---

### `chat.chat_realtime_presence`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `node_id` **PK** | varchar(128) | no | `` |
| `connection_id` **PK** | varchar(64) | no | `` |
| `user_id` | integer | no | `` |
| `touched_at` | timestamptz | no | `now()` |
| `expires_at` | timestamptz | no | `` |

- **Primary key:** `node_id, connection_id`
- **Indexes:**
  - `ix_chat_realtime_presence_user_expires`: (user_id, expires_at)

---

### `chat.chat_scheduled_messages`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | varchar(36) | no | `` |
| `conversation_id` | varchar(36) | no | `` |
| `sender_user_id` | integer | no | `` |
| `body` | text | no | `` |
| `body_format` | varchar(16) | no | `'plain'::character varying` |
| `reply_to_message_id` | varchar(36) | yes | `` |
| `scheduled_for` | timestamptz | no | `` |
| `status` | varchar(16) | no | `'scheduled'::character varying` |
| `attempt_count` | integer | no | `0` |
| `sent_message_id` | varchar(36) | yes | `` |
| `error_text` | varchar(300) | yes | `` |
| `created_at` | timestamptz | no | `now()` |
| `updated_at` | timestamptz | no | `now()` |

- **Primary key:** `id`
- **Foreign keys:**
  - `conversation_id` → `chat.chat_conversations` (`id`)
- **Indexes:**
  - `ix_chat_scheduled_messages_conversation_sender_status`: (conversation_id, sender_user_id, status)
  - `ix_chat_scheduled_messages_sender_user_id`: (sender_user_id)
  - `ix_chat_scheduled_messages_status_scheduled_for`: (status, scheduled_for)

---

### `chat.chat_sticker_packs`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | varchar(36) | no | `` |
| `short_name` | varchar(128) | no | `` |
| `title` | varchar(255) | no | `` |
| `sticker_type` | varchar(32) | no | `'regular'::character varying` |
| `created_at` | timestamptz | no | `` |
| `updated_at` | timestamptz | no | `` |

- **Primary key:** `id`
- **Indexes:**
  - `chat_sticker_packs_short_name_key` UNIQUE: (short_name)
  - `ix_chat_sticker_packs_short_name` UNIQUE: (short_name)

---

### `chat.chat_stickers`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | varchar(36) | no | `` |
| `pack_id` | varchar(36) | no | `` |
| `telegram_file_id` | text | no | `` |
| `telegram_file_unique_id` | varchar(128) | no | `` |
| `emoji` | varchar(64) | no | `''::character varying` |
| `format` | varchar(20) | no | `` |
| `mime_type` | varchar(64) | no | `` |
| `storage_name` | varchar(255) | no | `` |
| `file_size` | integer | no | `0` |
| `width` | integer | yes | `` |
| `height` | integer | yes | `` |
| `sort_order` | integer | no | `0` |
| `created_at` | timestamptz | no | `` |

- **Primary key:** `id`
- **Foreign keys:**
  - `pack_id` → `chat.chat_sticker_packs` (`id`)
- **Indexes:**
  - `ix_chat_stickers_pack_id`: (pack_id)
  - `ix_chat_stickers_pack_sort`: (pack_id, sort_order)
  - `uq_chat_stickers_pack_file_unique` UNIQUE: (pack_id, telegram_file_unique_id)

---

### `chat.chat_user_sticker_packs`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | integer | no | `nextval('chat.chat_user_sticker_packs_id_seq'::regclass)` |
| `user_id` | integer | no | `` |
| `pack_id` | varchar(36) | no | `` |
| `added_at` | timestamptz | no | `` |

- **Primary key:** `id`
- **Foreign keys:**
  - `pack_id` → `chat.chat_sticker_packs` (`id`)
- **Indexes:**
  - `ix_chat_user_sticker_packs_pack_id`: (pack_id)
  - `ix_chat_user_sticker_packs_user_added`: (user_id, added_at)
  - `ix_chat_user_sticker_packs_user_id`: (user_id)
  - `uq_chat_user_sticker_packs_user_pack` UNIQUE: (user_id, pack_id)

---

## Schema `system` (8 tables)

### `system.alembic_version`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `version_num` **PK** | varchar(32) | no | `` |

- **Primary key:** `version_num`

---

### `system.auth_runtime_items`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `namespace` **PK** | varchar(64) | no | `` |
| `item_key` **PK** | varchar(512) | no | `` |
| `value_text` | text | no | `` |
| `expires_at` | timestamptz | yes | `` |
| `created_at` | timestamptz | no | `` |
| `updated_at` | timestamptz | no | `` |

- **Primary key:** `namespace, item_key`
- **Indexes:**
  - `ix_system_auth_runtime_items_expires_at`: (expires_at)
  - `ix_system_auth_runtime_items_namespace`: (namespace)

---

### `system.env_settings_audit`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | integer | no | `nextval('system.env_settings_audit_id_seq'::regclass)` |
| `key` | text | no | `` |
| `old_value_masked` | text | no | `''::text` |
| `new_value_masked` | text | no | `''::text` |
| `actor_user_id` | integer | no | `0` |
| `actor_username` | text | no | `''::text` |
| `changed_at` | text | no | `` |
| `apply_targets` | text | no | `''::text` |
| `requires_frontend_build` | integer | no | `0` |

- **Primary key:** `id`
- **Indexes:**
  - `idx_env_settings_audit_key_changed_at`: (key, changed_at)

---

### `system.mfu_page_baseline`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `device_key` **PK** | text | no | `` |
| `baseline_date` | text | no | `` |
| `created_at` | text | no | `` |
| `updated_at` | text | no | `` |

- **Primary key:** `device_key`
- **Indexes:**
  - `idx_mfu_page_baseline_baseline_date`: (baseline_date)

---

### `system.mfu_page_snapshots`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `device_key` **PK** | text | no | `` |
| `snapshot_date` **PK** | text | no | `` |
| `page_total` | integer | no | `` |
| `page_oid` | text | yes | `` |
| `snmp_checked_at` | text | yes | `` |
| `created_at` | text | no | `` |
| `updated_at` | text | no | `` |

- **Primary key:** `device_key, snapshot_date`
- **Indexes:**
  - `idx_mfu_page_snapshots_device_date`: (device_key, snapshot_date)
  - `idx_mfu_page_snapshots_snapshot_date`: (snapshot_date)

---

### `system.mfu_runtime_state`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `device_key` **PK** | text | no | `` |
| `ip_address` | text | yes | `` |
| `timeout_total` | integer | no | `0` |
| `timeout_streak` | integer | no | `0` |
| `next_retry_at` | text | yes | `` |
| `runtime_json` | text | yes | `` |
| `updated_at` | text | no | `` |

- **Primary key:** `device_key`
- **Indexes:**
  - `idx_mfu_runtime_state_updated_at`: (updated_at)

---

### `system.migration_checkpoints`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `key` **PK** | varchar(128) | no | `` |
| `value_json` | text | no | `` |
| `updated_at` | timestamptz | no | `` |

- **Primary key:** `key`

---

### `system.session_auth_context`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `session_id` **PK** | varchar(64) | no | `` |
| `user_id` | integer | no | `` |
| `auth_source` | varchar(20) | no | `'local'::character varying` |
| `exchange_login` | varchar(255) | no | `` |
| `password_enc` | text | no | `''::text` |
| `expires_at` | timestamptz | no | `` |
| `created_at` | timestamptz | no | `` |
| `updated_at` | timestamptz | no | `` |

- **Primary key:** `session_id`
- **Indexes:**
  - `idx_session_auth_context_expires_at`: (expires_at)
  - `idx_session_auth_context_user_id`: (user_id)

---
