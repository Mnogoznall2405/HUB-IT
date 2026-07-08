# PostgreSQL — DDL snapshot (live introspection)

_Сгенерировано: 2026-07-08 06:45 UTC_  
_Источник: `APP_DATABASE_URL` → `postgresql+psycopg://hubit_chat_app:***@127.0.0.1:5432/hubit_chat` (`127.0.0.1:5432/hubit_chat`)_

Автообновляется после `alembic upgrade` и dev-инициализации PostgreSQL. Обзор: [POSTGRES_APP_SCHEMA.md](./POSTGRES_APP_SCHEMA.md).

---

## Schema `app` (86 tables)

### `app.ad_user_branch_overrides`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `login` **PK** | varchar(255) | no | `` |
| `branch_no` | integer | no | `` |
| `updated_at` | timestamptz | no | `` |

- **Primary key:** `login`

---

### `app.ai_bot_conversations`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | integer | no | `nextval('app.ai_bot_conversations_id_seq'::regclass)` |
| `bot_id` | varchar(64) | no | `` |
| `user_id` | integer | no | `` |
| `conversation_id` | varchar(36) | no | `` |
| `created_at` | timestamptz | no | `` |
| `updated_at` | timestamptz | no | `` |

- **Primary key:** `id`
- **Indexes:**
  - `ix_app_ai_bot_conversations_bot_id`: (bot_id)
  - `ix_app_ai_bot_conversations_conversation_id`: (conversation_id)
  - `ix_app_ai_bot_conversations_user_id`: (user_id)
  - `uq_app_ai_bot_conversations_bot_user` UNIQUE: (bot_id, user_id)
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
| `error_text` | text | yes | `` |
| `request_json` | text | no | `` |
| `result_json` | text | no | `` |
| `usage_json` | text | no | `` |
| `started_at` | timestamptz | yes | `` |
| `completed_at` | timestamptz | yes | `` |
| `created_at` | timestamptz | no | `` |
| `updated_at` | timestamptz | no | `` |
| `stage` | varchar(64) | yes | `` |
| `status_text` | text | yes | `` |

- **Primary key:** `id`
- **Indexes:**
  - `ix_app_ai_bot_runs_bot_conversation_created_at`: (bot_id, conversation_id, created_at)
  - `ix_app_ai_bot_runs_bot_id`: (bot_id)
  - `ix_app_ai_bot_runs_conversation_id`: (conversation_id)
  - `ix_app_ai_bot_runs_status`: (status)
  - `ix_app_ai_bot_runs_status_created_at`: (status, created_at)
  - `ix_app_ai_bot_runs_trigger_message_id`: (trigger_message_id)
  - `ix_app_ai_bot_runs_user_id`: (user_id)

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
| `allow_file_input` | boolean | no | `` |
| `allow_generated_artifacts` | boolean | no | `` |
| `is_enabled` | boolean | no | `` |
| `bot_user_id` | integer | yes | `` |
| `created_at` | timestamptz | no | `` |
| `updated_at` | timestamptz | no | `` |
| `allow_kb_document_delivery` | boolean | no | `false` |
| `enabled_tools_json` | text | no | `'[]'::text` |
| `tool_settings_json` | text | no | `'{}'::text` |

- **Primary key:** `id`
- **Indexes:**
  - `ix_app_ai_bots_bot_user_id`: (bot_user_id)
  - `ix_app_ai_bots_is_enabled`: (is_enabled)
  - `ix_app_ai_bots_slug`: (slug)
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

### `app.app_settings`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `key` **PK** | varchar(128) | no | `` |
| `value_json` | text | no | `` |
| `updated_at` | timestamptz | no | `` |

- **Primary key:** `key`

---

### `app.department_memberships`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | integer | no | `nextval('app.department_memberships_id_seq'::regclass)` |
| `department_id` | varchar(64) | no | `` |
| `user_id` | integer | no | `` |
| `role` | varchar(32) | no | `` |
| `source` | varchar(32) | no | `` |
| `is_active` | boolean | no | `` |
| `created_at` | timestamptz | no | `` |
| `updated_at` | timestamptz | no | `` |

- **Primary key:** `id`
- **Indexes:**
  - `ix_app_department_memberships_department_active`: (department_id, is_active)
  - `ix_app_department_memberships_is_active`: (is_active)
  - `ix_app_department_memberships_user_active`: (user_id, is_active)
  - `uq_app_department_membership_role` UNIQUE: (department_id, user_id, role)

---

### `app.departments`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | varchar(64) | no | `` |
| `name` | varchar(255) | no | `` |
| `source` | varchar(32) | no | `` |
| `is_active` | boolean | no | `` |
| `created_at` | timestamptz | no | `` |
| `updated_at` | timestamptz | no | `` |

- **Primary key:** `id`
- **Indexes:**
  - `ix_app_departments_is_active`: (is_active)
  - `ix_app_departments_name`: (name)

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
| `old_employee_name` | text | no | `''::text` |
| `inv_nos_json` | text | no | `'[]'::text` |
| `equipment_count` | integer | no | `0` |
| `matched_doc_no` | integer | yes | `` |
| `matched_doc_number` | text | yes | `` |
| `completed_at` | text | yes | `` |

- **Primary key:** `id`
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
| `new_employee_name` | text | no | `''::text` |
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

### `app.hub_announcement_attachments`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | text | no | `` |
| `announcement_id` | text | no | `` |
| `file_name` | text | no | `` |
| `file_path` | text | no | `` |
| `file_mime` | text | yes | `` |
| `file_size` | integer | no | `0` |
| `uploaded_by_user_id` | integer | no | `` |
| `uploaded_by_username` | text | no | `''::text` |
| `uploaded_at` | text | no | `` |

- **Primary key:** `id`
- **Indexes:**
  - `idx_hub_announcement_attachments_announcement`: (announcement_id, uploaded_at)

---

### `app.hub_announcement_reads`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `announcement_id` **PK** | text | no | `` |
| `user_id` **PK** | integer | no | `` |
| `username` | text | no | `''::text` |
| `full_name` | text | no | `''::text` |
| `read_at` | text | no | `` |
| `seen_version` | integer | no | `0` |
| `acknowledged_version` | integer | no | `0` |
| `acknowledged_at` | text | yes | `` |

- **Primary key:** `announcement_id, user_id`

---

### `app.hub_announcements`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | text | no | `` |
| `title` | text | no | `` |
| `preview` | text | no | `''::text` |
| `body` | text | no | `''::text` |
| `priority` | text | no | `'normal'::text` |
| `is_active` | integer | no | `1` |
| `author_user_id` | integer | no | `0` |
| `author_username` | text | no | `''::text` |
| `author_full_name` | text | no | `''::text` |
| `published_at` | text | no | `` |
| `updated_at` | text | no | `` |
| `version` | integer | no | `1` |
| `audience_scope` | text | no | `'all'::text` |
| `audience_roles` | text | no | `'[]'::text` |
| `audience_user_ids` | text | no | `'[]'::text` |
| `requires_ack` | integer | no | `0` |
| `is_pinned` | integer | no | `0` |
| `pinned_until` | text | yes | `` |
| `published_from` | text | yes | `` |
| `expires_at` | text | yes | `` |

- **Primary key:** `id`
- **Indexes:**
  - `idx_hub_announcements_published`: (is_active, published_at)

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
| `body` | text | no | `''::text` |
| `entity_type` | text | no | `''::text` |
| `entity_id` | text | no | `''::text` |
| `created_at` | text | no | `` |

- **Primary key:** `id`
- **Indexes:**
  - `idx_hub_notifications_recipient`: (recipient_user_id, created_at)

---

### `app.hub_task_attachments`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | text | no | `` |
| `task_id` | text | no | `` |
| `scope` | text | no | `'task'::text` |
| `file_name` | text | no | `` |
| `file_path` | text | no | `` |
| `file_mime` | text | yes | `` |
| `file_size` | integer | no | `0` |
| `uploaded_by_user_id` | integer | no | `` |
| `uploaded_by_username` | text | no | `''::text` |
| `uploaded_at` | text | no | `` |

- **Primary key:** `id`
- **Indexes:**
  - `idx_hub_task_attachments_task`: (task_id, uploaded_at)

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
| `username` | text | no | `''::text` |
| `full_name` | text | no | `''::text` |
| `body` | text | no | `''::text` |
| `created_at` | text | no | `` |

- **Primary key:** `id`
- **Indexes:**
  - `idx_hub_task_comments_task`: (task_id, created_at)

---

### `app.hub_task_email_outbox`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | text | no | `` |
| `dedupe_key` | text | no | `` |
| `task_id` | text | yes | `` |
| `recipient_user_id` | integer | no | `` |
| `recipient_email` | text | no | `` |
| `event_type` | text | no | `` |
| `subject` | text | no | `` |
| `body_text` | text | no | `` |
| `status` | text | no | `'pending'::text` |
| `attempt_count` | integer | no | `0` |
| `available_at` | text | no | `` |
| `created_at` | text | no | `` |
| `updated_at` | text | no | `` |
| `sent_at` | text | yes | `` |
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
| `comment` | text | no | `''::text` |
| `file_name` | text | yes | `` |
| `file_path` | text | yes | `` |
| `file_mime` | text | yes | `` |
| `file_size` | integer | yes | `` |
| `uploaded_by_user_id` | integer | no | `` |
| `uploaded_by_username` | text | no | `''::text` |
| `uploaded_at` | text | no | `` |

- **Primary key:** `id`

---

### `app.hub_task_status_log`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | text | no | `` |
| `task_id` | text | no | `` |
| `old_status` | text | no | `''::text` |
| `new_status` | text | no | `''::text` |
| `changed_by_user_id` | integer | no | `` |
| `changed_by_username` | text | no | `''::text` |
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
| `description` | text | no | `''::text` |
| `status` | text | no | `'new'::text` |
| `due_at` | text | yes | `` |
| `assignee_user_id` | integer | no | `` |
| `assignee_username` | text | no | `''::text` |
| `assignee_full_name` | text | no | `''::text` |
| `controller_user_id` | integer | no | `0` |
| `controller_username` | text | no | `''::text` |
| `controller_full_name` | text | no | `''::text` |
| `created_by_user_id` | integer | no | `` |
| `created_by_username` | text | no | `''::text` |
| `created_by_full_name` | text | no | `''::text` |
| `created_at` | text | no | `` |
| `updated_at` | text | no | `` |
| `submitted_at` | text | yes | `` |
| `reviewed_at` | text | yes | `` |
| `reviewer_user_id` | integer | yes | `` |
| `reviewer_username` | text | yes | `` |
| `review_comment` | text | yes | `` |
| `priority` | text | no | `'normal'::text` |
| `reviewer_full_name` | text | no | `''::text` |
| `project_id` | text | yes | `` |
| `object_id` | text | yes | `` |
| `protocol_date` | text | yes | `` |
| `completed_at` | text | yes | `` |
| `completed_at_source` | text | yes | `` |
| `department_id` | text | yes | `` |
| `visibility_scope` | text | no | `'private'::text` |
| `checklist_items` | text | no | `'[]'::text` |
| `email_deadline_remind_hours` | integer | yes | `` |
| `observer_user_ids` | text | no | `'[]'::text` |

- **Primary key:** `id`
- **Indexes:**
  - `idx_hub_tasks_assignee`: (assignee_user_id, status, updated_at)
  - `idx_hub_tasks_completed_at`: (completed_at)
  - `idx_hub_tasks_controller`: (controller_user_id, status, updated_at)
  - `idx_hub_tasks_created_by`: (created_by_user_id, status, updated_at)
  - `idx_hub_tasks_department`: (department_id, updated_at)
  - `idx_hub_tasks_due_at`: (due_at)
  - `idx_hub_tasks_object`: (object_id, updated_at)
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
| `report_type` | varchar(32) | no | `` |
| `change_types_json` | text | no | `` |
| `diff_json` | text | no | `` |
| `before_json` | text | no | `` |
| `after_json` | text | no | `` |
| `created_at` | timestamptz | no | `` |

- **Primary key:** `event_id`
- **Indexes:**
  - `ix_app_inventory_change_events_detected_at`: (detected_at)
  - `ix_app_inventory_change_events_hostname`: (hostname)
  - `ix_app_inventory_change_events_mac_address`: (mac_address)

---

### `app.inventory_host_sql_contexts`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | integer | no | `nextval('app.inventory_host_sql_contexts_id_seq'::regclass)` |
| `mac_address` | varchar(64) | no | `` |
| `hostname` | varchar(255) | no | `` |
| `db_id` | varchar(128) | no | `` |
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
| `report_type` | varchar(32) | no | `` |
| `last_seen_at` | integer | yes | `` |
| `last_full_snapshot_at` | integer | yes | `` |
| `payload_json` | text | no | `` |
| `updated_at` | timestamptz | no | `` |

- **Primary key:** `mac_address`
- **Indexes:**
  - `ix_app_inventory_hosts_hostname`: (hostname)
  - `ix_app_inventory_hosts_ip_primary`: (ip_primary)
  - `ix_app_inventory_hosts_last_seen_at`: (last_seen_at)
  - `ix_app_inventory_hosts_user_full_name`: (user_full_name)
  - `ix_app_inventory_hosts_user_login`: (user_login)

---

### `app.inventory_outlook_files`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | integer | no | `nextval('app.inventory_outlook_files_id_seq'::regclass)` |
| `mac_address` | varchar(64) | no | `` |
| `kind` | varchar(32) | no | `` |
| `file_path` | text | yes | `` |
| `file_type` | varchar(32) | yes | `` |
| `size_bytes` | bigint | no | `` |
| `last_modified_at` | integer | yes | `` |
| `updated_at` | timestamptz | no | `` |

- **Primary key:** `id`
- **Indexes:**
  - `ix_app_inventory_outlook_files_file_path`: (file_path)
  - `ix_app_inventory_outlook_files_file_type`: (file_type)
  - `ix_app_inventory_outlook_files_kind`: (kind)
  - `ix_app_inventory_outlook_files_mac_address`: (mac_address)
  - `ix_app_inventory_outlook_files_size_bytes`: (size_bytes)

---

### `app.inventory_user_profiles`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | integer | no | `nextval('app.inventory_user_profiles_id_seq'::regclass)` |
| `mac_address` | varchar(64) | no | `` |
| `user_name` | varchar(255) | yes | `` |
| `profile_path` | text | yes | `` |
| `total_size_bytes` | bigint | no | `` |
| `files_count` | integer | no | `` |
| `dirs_count` | integer | no | `` |
| `errors_count` | integer | no | `` |
| `partial` | boolean | no | `` |
| `updated_at` | timestamptz | no | `` |

- **Primary key:** `id`
- **Indexes:**
  - `ix_app_inventory_user_profiles_mac_address`: (mac_address)
  - `ix_app_inventory_user_profiles_profile_path`: (profile_path)
  - `ix_app_inventory_user_profiles_user_name`: (user_name)

---

### `app.json_documents`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `file_name` **PK** | varchar(255) | no | `` |
| `kind` | varchar(16) | no | `` |
| `payload_json` | text | no | `` |
| `updated_at` | timestamptz | no | `` |

- **Primary key:** `file_name`

---

### `app.json_records`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | integer | no | `nextval('app.json_records_id_seq'::regclass)` |
| `file_name` | varchar(255) | no | `` |
| `sort_order` | integer | no | `` |
| `payload_json` | text | no | `` |
| `created_at` | timestamptz | no | `` |
| `updated_at` | timestamptz | no | `` |

- **Primary key:** `id`
- **Indexes:**
  - `ix_app_json_records_file_name`: (file_name)
  - `ix_app_json_records_sort_order`: (sort_order)

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
  - `mail_it_templates_code_key` UNIQUE: (code)

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

### `app.mail_user_preferences`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `user_id` **PK** | integer | no | `` |
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
| `email` | varchar(320) | no | `` |
| `display_name` | varchar(512) | no | `` |
| `upn` | varchar(320) | no | `` |
| `mailbox_type` | varchar(64) | no | `` |
| `used_bytes` | bigint | yes | `` |
| `quota_bytes` | bigint | yes | `` |
| `free_bytes` | bigint | yes | `` |
| `used_percent` | double precision | yes | `` |
| `database_name` | varchar(255) | no | `` |

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
| `source_host` | varchar(255) | no | `` |
| `exchange_server` | varchar(255) | no | `` |
| `payload_sha256` | varchar(64) | no | `` |
| `row_count` | integer | no | `` |

- **Primary key:** `id`
- **Indexes:**
  - `ix_app_mailbox_quota_snapshots_imported_at`: (imported_at)
  - `ix_app_mailbox_quota_snapshots_payload_sha256`: (payload_sha256)

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
  - `ix_app_my_file_blobs_ref_count`: (ref_count)

---

### `app.my_file_download_grants`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `token_hash` **PK** | varchar(64) | no | `` |
| `file_id` | varchar(64) | no | `` |
| `owner_user_id` | integer | no | `` |
| `expires_at` | timestamptz | no | `` |
| `used_at` | timestamptz | yes | `` |
| `created_at` | timestamptz | no | `` |

- **Primary key:** `token_hash`
- **Indexes:**
  - `ix_app_my_file_download_grants_expires_at`: (expires_at)
  - `ix_app_my_file_download_grants_file_id`: (file_id)
  - `ix_app_my_file_download_grants_owner_created`: (owner_user_id, created_at)

---

### `app.my_file_previews`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `blob_id` **PK** | varchar(64) | no | `` |
| `status` | varchar(32) | no | `'queued'::character varying` |
| `preview_kind` | varchar(32) | no | `'unsupported'::character varying` |
| `page_count` | integer | no | `0` |
| `error_text` | text | no | `''::text` |
| `created_at` | timestamptz | no | `` |
| `updated_at` | timestamptz | no | `` |
| `source_kind` | varchar(32) | no | `''::character varying` |
| `source_filename` | varchar(512) | no | `''::character varying` |
| `content_type` | varchar(255) | no | `'application/octet-stream'::character varying` |
| `preview_path` | text | no | `''::text` |
| `preview_mime_type` | varchar(255) | no | `'application/octet-stream'::character varying` |
| `preview_filename` | varchar(512) | no | `''::character varying` |
| `sheets_json` | text | no | `'[]'::text` |
| `generated_at` | timestamptz | yes | `` |

- **Primary key:** `blob_id`
- **Indexes:**
  - `ix_app_my_file_previews_kind_status`: (preview_kind, status)
  - `ix_app_my_file_previews_status_updated`: (status, updated_at)

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

- **Primary key:** `id`
- **Indexes:**
  - `ix_app_my_files_expires_at`: (expires_at)
  - `ix_app_my_files_expires_status`: (expires_at, status)
  - `ix_app_my_files_original_sha256`: (original_sha256)
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
| `id` **PK** | integer | no | `` |
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
| `id` **PK** | integer | no | `` |
| `branch_id` | integer | no | `` |
| `db_id` | text | no | `` |
| `updated_at` | text | no | `` |
| `updated_by` | text | yes | `` |

- **Primary key:** `id`
- **Foreign keys:**
  - `branch_id` → `app.network_branches` (`id`)
- **Indexes:**
  - `network_branch_db_map_branch_id_key` UNIQUE: (branch_id)

---

### `app.network_branches`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | integer | no | `` |
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
  - `network_branches_city_code_branch_code_key` UNIQUE: (city_code, branch_code)

---

### `app.network_devices`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | integer | no | `` |
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

- **Primary key:** `id`
- **Foreign keys:**
  - `branch_id` → `app.network_branches` (`id`)
  - `site_id` → `app.network_sites` (`id`)
- **Indexes:**
  - `idx_network_devices_branch`: (branch_id)
  - `network_devices_branch_id_device_code_key` UNIQUE: (branch_id, device_code)

---

### `app.network_import_jobs`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | integer | no | `` |
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
| `id` **PK** | integer | no | `` |
| `branch_id` | integer | no | `` |
| `map_id` | integer | no | `` |
| `site_id` | integer | yes | `` |
| `device_id` | integer | yes | `` |
| `port_id` | integer | yes | `` |
| `socket_id` | integer | yes | `` |
| `x_ratio` | real | no | `` |
| `y_ratio` | real | no | `` |
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
| `id` **PK** | integer | no | `` |
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
  - `network_maps_branch_id_file_name_key` UNIQUE: (branch_id, file_name)

---

### `app.network_panels`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | integer | no | `` |
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
  - `network_panels_branch_id_panel_index_key` UNIQUE: (branch_id, panel_index)

---

### `app.network_ports`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | integer | no | `` |
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
  - `network_ports_device_id_port_name_key` UNIQUE: (device_id, port_name)

---

### `app.network_sites`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | integer | no | `` |
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
  - `network_sites_branch_id_site_code_key` UNIQUE: (branch_id, site_code)

---

### `app.network_socket_profiles`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | integer | no | `` |
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
  - `network_socket_profiles_branch_id_key` UNIQUE: (branch_id)

---

### `app.network_sockets`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | integer | no | `` |
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
  - `network_sockets_branch_id_socket_code_key` UNIQUE: (branch_id, socket_code)

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
| `auth_method` | varchar(32) | no | `'legacy'::character varying` |
| `trusted_device_id` | varchar(64) | yes | `` |
| `client_browser_family` | varchar(32) | no | `'unknown'::character varying` |
| `client_os_family` | varchar(32) | no | `'unknown'::character varying` |
| `client_fingerprint_hash` | varchar(64) | no | `''::character varying` |

- **Primary key:** `session_id`
- **Indexes:**
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
| `role_type` | varchar(32) | no | `` |
| `is_active` | boolean | no | `` |
| `created_at` | timestamptz | no | `` |
| `updated_at` | timestamptz | no | `` |

- **Primary key:** `id`
- **Indexes:**
  - `ix_app_task_delegate_user_links_delegate_user_id`: (delegate_user_id)
  - `ix_app_task_delegate_user_links_is_active`: (is_active)
  - `ix_app_task_delegate_user_links_owner_user_id`: (owner_user_id)
  - `uq_app_task_delegate_owner_delegate` UNIQUE: (owner_user_id, delegate_user_id)

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

- **Primary key:** `id`
- **Foreign keys:**
  - `app_user_id` → `app.users` (`id`)
- **Indexes:**
  - `ix_ticket_employees_app_user_id`: (app_user_id)
  - `ix_ticket_employees_full_name`: (full_name)
  - `ix_ticket_employees_status`: (status)

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
| `is_discoverable` | boolean | no | `false` |
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
| `telegram_id` **PK** | bigint | no | `` |
| `database_id` | varchar(128) | no | `` |
| `updated_at` | timestamptz | no | `` |

- **Primary key:** `telegram_id`

---

### `app.user_mailboxes`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | varchar(64) | no | `` |
| `user_id` | integer | no | `` |
| `label` | varchar(255) | no | `` |
| `mailbox_email` | varchar(255) | no | `` |
| `mailbox_login` | varchar(255) | yes | `` |
| `mailbox_password_enc` | text | no | `` |
| `auth_mode` | varchar(32) | no | `` |
| `is_primary` | boolean | no | `` |
| `is_active` | boolean | no | `` |
| `sort_order` | integer | no | `` |
| `last_selected_at` | timestamptz | yes | `` |
| `created_at` | timestamptz | no | `` |
| `updated_at` | timestamptz | no | `` |

- **Primary key:** `id`
- **Indexes:**
  - `idx_user_mailboxes_user_active`: (user_id, is_active, sort_order)
  - `idx_user_mailboxes_user_email` UNIQUE: (user_id, mailbox_email)
  - `idx_user_mailboxes_user_primary`: (user_id, is_primary)
  - `ix_app_user_mailboxes_auth_mode`: (auth_mode)
  - `ix_app_user_mailboxes_is_active`: (is_active)
  - `ix_app_user_mailboxes_is_primary`: (is_primary)
  - `ix_app_user_mailboxes_user_id`: (user_id)
  - `ix_app_user_mailboxes_user_id_is_active`: (user_id, is_active)
  - `ix_app_user_mailboxes_user_id_is_primary`: (user_id, is_primary)
  - `uq_app_user_mailboxes_primary_per_user` UNIQUE: (user_id)
  - `uq_app_user_mailboxes_user_email` UNIQUE: (user_id, mailbox_email)

---

### `app.user_settings`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `user_id` **PK** | integer | no | `` |
| `pinned_database` | varchar(128) | yes | `` |
| `theme_mode` | varchar(16) | no | `` |
| `font_family` | varchar(32) | no | `` |
| `font_scale` | double precision | no | `` |
| `updated_at` | timestamptz | no | `` |
| `dashboard_mobile_sections` | text | yes | `` |
| `mobile_bottom_nav_items` | text | yes | `` |
| `database_branch_filters` | text | yes | `` |

- **Primary key:** `user_id`

---

### `app.users`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `id` **PK** | integer | no | `` |
| `username` | varchar(50) | no | `` |
| `email` | varchar(255) | yes | `` |
| `full_name` | varchar(255) | yes | `` |
| `is_active` | boolean | no | `` |
| `role` | varchar(20) | no | `` |
| `use_custom_permissions` | boolean | no | `` |
| `custom_permissions_json` | text | no | `` |
| `auth_source` | varchar(20) | no | `` |
| `telegram_id` | bigint | yes | `` |
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
| `totp_secret_enc` | text | no | `''::text` |
| `is_2fa_enabled` | boolean | no | `false` |
| `twofa_enabled_at` | timestamptz | yes | `` |
| `avatar_url` | varchar(512) | yes | `` |

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
  - `ix_app_vcs_computers_ip_address`: (ip_address)
  - `ix_app_vcs_computers_name`: (name)

---

## Schema `chat` (1 tables)

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
| `id` **PK** | integer | no | `` |
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
| `auth_source` | varchar(20) | no | `` |
| `exchange_login` | varchar(255) | no | `` |
| `password_enc` | text | no | `` |
| `expires_at` | timestamptz | no | `` |
| `created_at` | timestamptz | no | `` |
| `updated_at` | timestamptz | no | `` |

- **Primary key:** `session_id`
- **Indexes:**
  - `idx_session_auth_context_expires_at`: (expires_at)
  - `idx_session_auth_context_user_id`: (user_id)
  - `ix_system_session_auth_context_expires_at`: (expires_at)
  - `ix_system_session_auth_context_user_id`: (user_id)

---
