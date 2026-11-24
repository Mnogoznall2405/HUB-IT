# PostgreSQL — DDL snapshot (live introspection)

_Сгенерировано: 2026-11-24 10:24 UTC_  
_Источник: `APP_DATABASE_URL` → `postgresql+psycopg://a8test@127.0.0.1:55432/a8stk_556a55_rb` (`127.0.0.1:55432/a8stk_556a55_rb`)_

Автообновляется после `alembic upgrade` и dev-инициализации PostgreSQL. Обзор: [POSTGRES_APP_SCHEMA.md](./POSTGRES_APP_SCHEMA.md).

---

## Schema `app` (7 tables)

### `app.app_settings`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `key` **PK** | varchar(128) | no | `` |
| `value_json` | text | no | `` |
| `updated_at` | timestamptz | no | `` |

- **Primary key:** `key`

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

- **Primary key:** `session_id`
- **Indexes:**
  - `ix_app_sessions_is_active`: (is_active)
  - `ix_app_sessions_status`: (status)
  - `ix_app_sessions_user_id`: (user_id)
  - `ix_app_sessions_username`: (username)

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

- **Primary key:** `id`
- **Indexes:**
  - `ix_app_users_is_2fa_enabled`: (is_2fa_enabled)
  - `ix_app_users_is_active`: (is_active)
  - `ix_app_users_telegram_id`: (telegram_id)
  - `ix_app_users_username`: (username)
  - `uq_app_users_username` UNIQUE: (username)

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

## Schema `system` (3 tables)

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

### `system.migration_checkpoints`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `key` **PK** | varchar(128) | no | `` |
| `value_json` | text | no | `` |
| `updated_at` | timestamptz | no | `` |

- **Primary key:** `key`

---
