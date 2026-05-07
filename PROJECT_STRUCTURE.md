# 📊 Image_scan — Полный архитектурный анализ проекта

**Дата анализа:** 2026-05-06  
**Репозиторий:** C:\Project\Image_scan  
**Платформа:** Python (FastAPI) + React (Vite) + SQLite/PostgreSQL

---

## 1. 📁 Корневая структура

```
Image_scan/
├── agent.py                     # Основной агент мониторинга
├── agent.spec                   # PyInstaller spec для агента
├── agent_installer.py           # Установщик агента
├── agent_msi_helper.py          # MSI helper (Windows installer)
├── agent_version.py             # Версионирование агента
├── start_server.py              # Запуск основного сервера
├── local_store.py               # Локальное SQLite хранилище
├── get_ad_info.py              # Интеграция Active Directory
├── find_user_by_pc.py          # Поиск пользователя по имени ПК
├── inspect_excel.py            # Инспектор Excel-файлов
├── patch.py / patch_backend.py / patch_tasks.py  # Hotfix-патчи
├── setup.py                    # Python package setup
├── requirements.txt            # Python зависимости
├── constraints.txt             # Ограничения версий
├── .env / .env.example         # Переменные окружения
├── README.md / CHANGELOG.md    # Документация
├── TECH_DEBT_AUDIT.md          # Существующий аудит tech debt
├── LLM_PROJECT_CONTEXT.md      # LLM контекст проекта
├── pm2.cmd / pm2.ps1           # PM2 process manager скрипты
├── pytest.ini / pytest.bot.ini # Конфигурации тестов
├── bot.log*                    # Логи бота
├── clean_local_store.py        # Очистка локального хранилища
├── clean_network_branches.py   # Очистка сетевых филиалов
├── fix_env.py                  # Fix переменных окружения
│
├── WEB-itinvent/               # 🎯 Основное приложение (IT Invent)
├── scan_agent/                 # Агент сетевого сканирования
├── scan_server/                # Сервер сканирования
├── agent/                      # Агент-код
├── inventory_server/           # Инвентарный сервер
├── bot/                        # Бот-модуль
├── scripts/                    # Python скрипты
├── templates/                  # Шаблоны
├── exports/                    # Экспортируемые данные
├── documentation/              # Документация
├── data/                       # Данные
├── zbx/                        # Zabbix шаблоны мониторинга
├── tests/                      # Тесты
├── build/ / dist/             # Сборка
└── .opencode/skills/          # 60+ доступных навыков анализа
```

---

## 2. 🔧 WEB-itinvent/backend/ — Backend (FastAPI)

### 2.1 Точка входа и конфигурация
```
backend/
├── main.py                     # FastAPI приложение (точка входа)
├── config.py                   # Pydantic Settings конфигурация
├── db_schema.py               # SQLAlchemy схема БД
├── db_migrations.py           # Утилиты миграций
├── rate_limit.py              # Rate limiting middleware
├── requirements.txt           # Backend зависимости
├── constraints.txt            # Ограничения версий
└── alembic.ini                # Alembic конфиг
```

### 2.2 API Layer (`api/v1/`)
```
api/v1/
├── __init__.py
├── deps.py                    # FastAPI Dependencies (DB, auth)
├── auth.py                    # Auth endpoints (login, logout, sessions)
├── chat.py                    # Chat endpoints (messages, groups, uploads)
├── database.py                # Database/equipment endpoints
├── equipment.py               # Equipment CRUD endpoints
├── mail.py                    # Mail endpoints (compose, folders, read)
├── networks.py                # Network branches/endpoints
├── hub.py                     # Hub/tasks endpoints
├── kb.py                      # Knowledge base endpoints
├── settings.py                # App settings endpoints
├── ad_users.py                # AD users endpoints
├── ai_bots.py                 # AI bot configuration endpoints
├── departments.py             # Departments endpoints
├── discovery.py               # Network discovery endpoints
├── inventory.py               # Inventory endpoints
├── json_operations.py         # JSON DB operations
└── mfu.py                     # MFU/printer endpoints
```

### 2.3 Services Layer (`services/`)
```
services/
├── access_policy_service.py
├── act_upload_service.py
├── ad_app_user_import_service.py
├── ad_sync_service.py
├── ad_users_service.py
├── app_push_service.py
├── app_settings_service.py
├── auth_runtime_store_service.py
├── auth_security_service.py
├── authorization_service.py
├── department_service.py
├── env_settings_service.py
├── equipment_transfer_execution_service.py
├── excel_export_service.py
├── hub_service.py
├── kb_service.py
├── mail_account_profile_resolver.py
├── mail_compose_orchestration.py
├── mail_conversation_finder.py
├── mail_conversation_payloads.py
├── mail_draft_lifecycle.py
├── mail_exchange_transport.py
├── mail_folder_mutations.py
├── mail_folder_tree.py
├── mail_mailbox_model.py
├── mail_mailbox_store.py
├── mail_message_actions.py
├── mail_message_content.py
├── mail_message_listing.py
├── mail_message_serializer.py
├── mail_metadata_store.py
├── mail_notification_service.py
├── mail_outgoing_html.py
├── mail_profile_model.py
├── mail_reference_codec.py
├── mail_runtime_cache.py
├── mail_service.py
├── mail_template_model.py
├── mail_template_store.py
├── markdown_transform_service.py
├── mfu_monitor_service.py
├── network_service.py
├── notification_preferences_service.py
├── request_auth_context_service.py
├── secret_crypto_service.py
├── security_email_service.py
├── session_auth_context_service.py
├── session_service.py
├── settings_service.py
├── task_analytics_export_service.py
├── transfer_act_job_service.py
├── transfer_act_reminder_service.py
├── transfer_service.py
├── trusted_device_service.py
├── twofa_service.py
├── user_db_selection_service.py
└── user_service.py
```

### 2.4 Database Layer (`database/`)
```
database/
├── __init__.py
├── connection.py              # DB connection manager
├── queries.py                 # Legacy SQL queries
├── queries.py                 # SQL queries and database functions
├── equipment_act_history_reads.py
├── equipment_consumable_reads.py
├── equipment_context_reads.py
├── equipment_db.py            # Equipment DB interface
├── equipment_directory_reads.py
├── equipment_item_detail_reads.py
├── equipment_reference_reads.py
└── equipment_search_reads.py
```

### 2.5 Models (`models/`)
```
models/
├── __init__.py
├── auth.py                    # Auth/User models
├── equipment.py               # Equipment models
├── kb.py                      # Knowledge base models
└── json_operations.py         # JSON operation models
```

### 2.6 Chat System (`chat/`)
```
chat/
├── __init__.py
├── service.py                 # Core chat service
├── realtime.py                # WebSocket realtime
├── realtime_side_effects.py   # WS side effects
├── models.py                  # Chat ORM models
├── schemas.py                 # Chat Pydantic schemas
├── db.py                      # Chat DB operations
├── push_service.py            # Push notifications
├── push_outbox_service.py     # Push outbox pattern
├── event_outbox_service.py    # Event outbox pattern
├── notification_dispatcher.py # Notification dispatch
├── notification_planner.py    # Notification planning
├── message_persistence.py     # Message persistence
├── upload_sessions.py         # File upload sessions
├── upload_session_completion.py
├── upload_session_transfer.py
└── attachment_media.py        # Attachment media handling
```

### 2.7 AI Chat (`ai_chat/`)
```
ai_chat/
├── __init__.py
├── service.py                 # AI chat orchestration
├── openrouter_client.py       # OpenRouter API client
├── retrieval.py               # RAG retrieval
├── retrieval_interface.py     # Retrieval interface
├── artifact_generator.py      # Artifact generation
├── document_extractors.py     # Document text extraction
├── action_cards.py            # AI action cards
├── schemas.py                 # AI schemas
└── tools/
    ├── __init__.py
    ├── base.py                # Base tool class
    ├── context.py             # Tool context
    ├── registry.py            # Tool registry
    ├── itinvent.py            # IT Invent tools
    ├── office.py              # Office suite tools
    └── files.py               # File operation tools
```

### 2.8 App DB (`appdb/`)
```
appdb/
├── __init__.py
├── db.py                      # App DB connection
├── models.py                  # App ORM models
├── inventory_store.py         # Inventory data store
├── json_store.py              # JSON data store
└── sql_compat.py              # SQL compatibility layer
```

### 2.9 JSON DB (`json_db/`)
```
json_db/
├── __init__.py
├── manager.py                 # JSON DB manager
├── cartridges.py              # Cartridge data
├── transfers.py               # Transfer records
├── unfound.py                 # Unfound items
└── works.py                   # Work records
```

### 2.10 Utils (`utils/`)
```
utils/
├── __init__.py
├── request_network.py         # Network request utils
└── security.py                # Security utilities
```

### 2.11 Alembic Migrations (`alembic/versions/`)
**30+ миграций:**
- `20260327_0001_internal_app_chat_init.py`
- `20260327_0002_hub_init.py`
- `20260327_0003_network_init.py`
- `20260327_0004_reminders_env_audit_init.py`
- `20260327_0005_mail_mfu_init.py`
- `20260327_0006_vcs_ad_init.py`
- `20260327_0007_inventory_json_init.py`
- `20260328_0007_user_profile_fields.py`
- `20260328_0008_task_projects_analytics_init.py`
- `20260328_0009_default_general_task_project.py`
- `20260328_0010_merge_app_heads.py`
- `20260328_0011_task_completed_tracking.py`
- `20260330_0012_session_auth_context.py`
- `20260330_0013_auth_security_stack.py`
- `20260402_0014_dashboard_mobile_sections.py`
- `20260406_0015_chat_perf_indexes.py`
- `20260407_0016_user_mailboxes.py`
- `20260408_0017_passkey_first_trusted_devices.py`
- `20260409_0018_chat_attachment_dimensions.py`
- `20260417_0019_chat_forward_messages.py`
- `20260418_0020_chat_push_outbox_and_client_message_id.py`
- `20260418_0021_chat_message_seq_and_unread_counters.py`
- `20260424_0022_auth_runtime_store.py`
- `20260427_0023_ai_kb_fts_index.py`
- `20260428_0024_inventory_search_indexes.py`
- `20260430_0025_inventory_sql_context_model.py`
- `20260501_0026_departments_access_scope.py`
- `20260501_0027_chat_group_moderation.py`
- `20260502_0028_chat_event_outbox_schema.py`
- `20260502_0029_chat_message_body_format.py`
- `20260506_0030_session_trusted_device_context.py`

---

## 3. 🎨 WEB-itinvent/frontend/ — Frontend (React + Vite)

### 3.1 Entry & Config
```
frontend/
├── vite.config.js             # Vite configuration
├── package.json               # NPM dependencies
├── package-lock.json          # Lock file
├── src/
│   ├── main.jsx               # React entry point
│   ├── App.jsx                # Root component
│   ├── index.css              # Global styles
│   └── ...
├── public/                    # Static assets
│   ├── favicon.png
│   ├── apple-touch-icon.png
│   ├── pwa-192.png / pwa-512.png
│   ├── manifest.webmanifest   # PWA manifest
│   ├── sw.js                  # Service Worker
│   ├── sounds/                # Notification sounds
│   └── hubit-*.svg            # Brand assets
└── test_output.txt            # Test output log
```

### 3.2 API Layer (`src/api/`)
```
api/
├── client.js                  # Axios HTTP client
├── client.test.js             # Client tests
├── json_client.js             # JSON-specific client
│
├── authAccountSecurity.js
├── authPasskeyLogin.js
├── authPasswordLogin.js
├── authSessions.js
├── authTrustedDevices.js
├── authUserAdmin.js
│
├── chatAiActions.js
├── chatAttachments.js
├── chatConversationDetails.js
├── chatConversations.js
├── chatDirectory.js
├── chatFileUploads.js
├── chatGroups.js
├── chatMessageSending.js
├── chatNotifications.js
├── chatThreadMessages.js
├── chatUploadSessions.js
│
├── mailCompose.js
├── mailConfig.js
├── mailConversations.js
├── mailFolders.js
├── mailItRequests.js
├── mailMailboxes.js
├── mailMessageActions.js
├── mailMessageDetail.js
├── mailMessageFiles.js
├── mailMessageList.js
├── mailNotifications.js
├── mailPreferences.js
├── mailTemplates.js
│
├── equipmentComputers.js
├── equipmentConsumables.js
├── equipmentDirectories.js
├── equipmentRecords.js
├── equipmentSearch.js
├── equipmentTransferActs.js
│
├── hubAnnouncements.js
├── hubDashboard.js
├── hubMarkdown.js
├── hubNotifications.js
├── hubTaskActivity.js
├── hubTaskAnalytics.js
├── hubTaskFiles.js
├── hubTasks.js
├── hubTaskSupport.js
│
├── adUsers.js
├── database.js
├── departments.js
├── kb.js
├── mfu.js
├── networks.js
├── scanAgents.js
├── scanHosts.js
├── scanIncidents.js
├── scanOverview.js
├── scanTasks.js
├── settings.js
├── vcs.js
└── workspaceDiscovery.js
```

### 3.3 Components (`src/components/`)

#### Chat (`components/chat/`)
```
chat/
├── ChatBubble.jsx
├── ChatCommon.jsx / .test.jsx
├── ChatComposer.jsx
├── ChatContextPanel.jsx / .test.jsx
├── ChatDialogs.jsx / .test.jsx / .jsx.restored
├── ChatFileUploadDialog.jsx
├── ChatFileUploadPanel.jsx
├── chatHelpers.js / .test.js
├── ChatMediaPreviewDialog.jsx
├── ChatMessageList.jsx
├── ChatMessageReactions.jsx
├── ChatReactionPicker.jsx
├── ChatSelectionActionDock.jsx
├── ChatSidebar.jsx / .test.jsx
├── ChatThread.jsx / .test.jsx
├── chatUiTokens.js
├── chatUploadPrep.js / .test.js
├── useChatActiveThreadPolling.js / .test.jsx
├── useChatAiStatusPolling.js
├── useChatComposerSending.js / .test.jsx
├── useChatFileSending.js / .test.jsx
├── useChatForwardMessages.js / .test.jsx
├── useChatGroupDialog.js / .test.jsx
├── useChatMessageMenuActions.js / .test.jsx
├── useChatMessageSearch.js / .test.jsx
├── useChatSelectedMessageActions.js / .test.jsx
├── useChatSidebarSearch.js / .test.jsx
├── useChatSocketEvents.js / .test.jsx
├── useChatSocketLifecycle.js
├── useChatTaskShareDialog.js / .test.jsx
├── useChatTaskSharing.js / .test.jsx
├── useChatThreadViewport.js
└── useReadReceipts.js / .test.jsx
```

#### Mail (`components/mail/`)
```
mail/
├── MailAdvancedSearchDialog.jsx
├── MailAttachmentCard.jsx / .test.jsx
├── MailAttachmentPreviewDialog.jsx
├── mailAttachmentVisuals.js / .test.js
├── MailBulkActionBar.jsx / .test.jsx
├── MailComposeDialog.jsx / .test.jsx
├── MailComposeHost.jsx / .test.jsx
├── mailComposeState.js / .test.js
├── mailComposeSubject.js / .test.js
├── MailConversationReader.jsx / .test.jsx
├── mailDetailModel.js / .test.js
├── mailErrorModel.js / .test.js
├── MailFolderRail.jsx / .test.jsx
├── MailHeadersDialog.jsx
├── mailHtmlContent.js / .test.js
├── MailInitialLoadingState.jsx
├── MailItRequestDialog.jsx
├── mailListModel.js / .test.js
├── mailMailboxModel.js / .test.js
├── mailMessageFileActions.js / .test.js
├── MailMessageList.jsx / .test.jsx
├── MailMessageReader.jsx / .test.jsx
├── mailMobileHistory.js / .test.js
├── mailOutgoingPreview.js / .test.js
├── mailPeople.js
├── MailPreviewHeader.jsx / .test.jsx
├── mailQuotedHistory.js / .test.js
├── mailReadStateModel.js / .test.js
├── MailRichTextEditor.jsx
├── MailShortcutHelpDialog.jsx
├── MailSignatureDialog.jsx
├── mailTemplateModel.js / .test.js
├── MailTemplatesDialog.jsx
├── MailToolbar.jsx / .test.jsx
├── MailToolsMenu.jsx / .test.jsx
├── mailUiTokens.js
├── MailViewSettingsDialog.jsx
├── mailViewStateModel.js / .test.js
├── useMailAdvancedSearch.js / .test.js
├── useMailAsyncTaskGate.js / .test.js
├── useMailAutoReadGuard.js / .test.js
├── useMailBulkActions.js / .test.js
├── useMailFolderMutations.js
├── useMailItRequest.js / .test.js
├── useMailListDataController.js / .test.js
├── useMailListItemActions.js / .test.js
├── useMailMailboxUnreadCounts.js / .test.js
├── useMailMessageFileActions.js / .test.js
├── useMailMessageRenderState.js / .test.js
├── useMailMobileShell.js
├── useMailQuickReply.js
├── useMailReadMutations.js / .test.js
├── useMailRecentSnapshots.js / .test.js
├── useMailRemoteImages.js / .test.js
├── useMailSelectedDetailLifecycle.js / .test.js
├── useMailSelectedDetailState.js / .test.js
├── useMailSelectedPreviewActions.js / .test.js
├── useMailSignatureSettings.js
└── useMailTemplateEditor.js
```

#### Database (`pages/database/`)
```
database/
├── ActionConsumableSelect.jsx / .test.jsx
├── ActionDialog.jsx / .test.jsx
├── actionExecution.js / .test.js
├── ActionHistoryPanel.jsx / .test.jsx
├── actionModel.js / .test.js
├── AddConsumableDialog.jsx / .test.jsx
├── AddEquipmentDialog.jsx / .test.jsx
├── consumableModel.js / .test.js
├── DatabaseDataSections.jsx
├── DatabaseDesktopToolbar.jsx / .test.jsx
├── databaseListModel.js / .test.js
├── DatabaseMobileActions.jsx / .test.jsx
├── DatabaseMobileHeader.jsx / .test.jsx
├── databaseOptionModel.js / .test.js
├── databaseRecordModel.js / .test.js
├── DatabaseSearchBar.jsx / .test.jsx
├── DatabaseSelectionBar.jsx / .test.jsx
├── DeleteEquipmentDialog.jsx / .test.jsx
├── detailModel.js / .test.js
├── DetailQrDialog.jsx / .test.jsx
├── EditConsumableQtyDialog.jsx / .test.jsx
├── EnhancedFabAction.jsx / .test.jsx
├── EquipmentActFieldsDialog.jsx / .test.jsx
├── EquipmentDetailActsPanel.jsx / .test.jsx
├── EquipmentDetailDialog.jsx / .test.jsx
├── EquipmentDetailHistoryPanel.jsx / .test.jsx
├── equipmentModel.js / .test.js
├── EquipmentTable.jsx / .test.jsx
├── LocationAutocompleteField.jsx / .test.js
├── MaintenanceActionContent.jsx / .test.jsx
├── ModernEquipmentCard.jsx / .test.jsx
├── qrModel.js / .test.js
├── QrScannerDialog.jsx / .test.jsx
├── TransferActionContent.jsx / .test.jsx
├── transferModel.js / .test.js
├── uploadAct.js / .test.js
├── UploadActCommitResultAlerts.jsx / .test.jsx
├── UploadActDetailsForm.jsx / .test.jsx
├── UploadActDialog.jsx / .test.jsx
├── UploadActEmailForm.jsx / .test.jsx
├── UploadActEmailStatusList.jsx / .test.jsx
├── UploadActEmailSummaryChips.jsx / .test.jsx
├── UploadActInvNoChips.jsx / .test.jsx
├── UploadActInvVerificationPanel.jsx / .test.jsx
├── UploadActPdfParsePanel.jsx / .test.jsx
├── UploadActPdfPreviewPanel.jsx / .test.jsx
├── UploadActReminderPanel.jsx / .test.jsx
├── UploadActResolvedItemsTable.jsx / .test.jsx
├── UploadActStepChips.jsx / .test.jsx
├── useDatabaseAddWorkflows.js / .test.jsx
├── useDatabaseConsumableQty.js / .test.jsx
├── useDatabaseDeleteEquipment.js / .test.jsx
├── useDatabaseDetailRuntime.js / .test.jsx
├── useDatabaseEquipmentData.js / .test.jsx
├── useDatabaseListNavigation.js / .test.jsx
├── useDatabaseLookups.js / .test.jsx
├── useDatabaseMaintenanceData.js / .test.jsx
├── useDatabaseQrScanner.js / .test.jsx
├── useDatabaseSearch.js / .test.jsx
├── useDatabaseSelection.js / .test.jsx
├── useDatabaseTransferAction.js / .test.jsx
├── useDatabaseUploadActWorkflow.js / .test.jsx
├── useDatabaseWorkspaceIdentity.js / .test.jsx
└── useMultiSelect.js / .test.js
```

#### Dashboard (`components/dashboard/`)
```
dashboard/
├── ActionStrip.jsx
├── AnnouncementCard.jsx
├── AnnouncementList.jsx
├── FilterBar.jsx
├── MobileAnnouncementsTab.jsx
├── MobileFilterDialog.jsx
├── MobileOverviewTab.jsx
├── MobileTasksTab.jsx
├── TaskCard.jsx
└── TaskQueue.jsx
```

#### Networks (`components/networks/`)
```
networks/
├── AuditTab.jsx
├── BranchDialogs.jsx
├── BranchList.jsx
├── DeviceDialog.jsx
├── EquipmentTab.jsx
├── ImportDialog.jsx
├── InteractiveMapCanvas.jsx
├── MapDialog.jsx
├── SocketsTab.jsx
└── useVirtualizedTableWindow.js
```

#### Hub (`components/hub/`)
```
hub/
├── MarkdownEditor.jsx
├── MarkdownRenderer.jsx
├── TaskUi.jsx / .test.jsx
```

#### Layout (`components/layout/`)
```
layout/
├── BrandedRouteLoader.jsx
├── MainLayout.jsx / .test.jsx
├── MainLayoutShellContext.js
├── PageShell.jsx
├── ToastHistoryList.jsx / .test.jsx
```

#### Common (`components/common/`)
```
common/
├── index.js
├── ActionMenu.jsx / .test.jsx
├── LoadingSpinner.jsx
├── OverflowMenu.jsx
└── StatusChip.jsx
```

#### Feedback (`components/feedback/`)
```
feedback/
├── toastActions.js
└── ToastViewport.jsx
```

### 3.4 Contexts (`src/contexts/`)
```
contexts/
├── AuthContext.jsx / .test.jsx
├── NotificationContext.jsx / .test.jsx
└── PreferencesContext.jsx / .test.jsx
```

### 3.5 Hooks (`src/hooks/`)
```
hooks/
├── useAnnouncementFilters.js
├── useDashboardData.js
├── useDebounce.js
├── useMobileSections.js
├── useScanIncidentInbox.js
└── useTaskQueues.js
```

### 3.6 Lib (`src/lib/`)
```
lib/
├── appBadge.js
├── appPushPermissions.js / .test.js
├── chatFeature.js
├── chatNotifications.js / .test.js
├── chatSocket.js / .test.js
├── hubTaskIntegrations.js / .test.js
├── mailRecentCache.js / .test.js
├── notificationUtils.js
├── pwaInstall.js
├── routeLoaders.js / .test.js
├── scanIncidentInbox.js
├── swrCache.js
├── webauthnCredentials.js
└── windowsNotifications.js / .test.js
```

### 3.7 Pages (`src/pages/`)
```
pages/
├── AdUsers.jsx / .test.jsx
├── Chat.jsx / .test.jsx / .performance.test.jsx
├── Computers.jsx / .test.jsx
├── Dashboard.jsx / .test.jsx / .jsx.backup
├── Database.jsx / .test.jsx / .jsx.backup / .jsx.bak
├── KnowledgeBase.jsx / .test.jsx
├── Login.jsx / .test.jsx
├── Mail.jsx / .test.jsx
├── Mfu.jsx
├── Networks.jsx
├── ScanCenter.jsx / .test.jsx
├── Search.jsx
├── Settings.jsx
├── SettingsAiBots.test.jsx
├── SettingsAppSettings.test.jsx
├── SettingsNotifications.test.jsx
├── Statistics.jsx
├── Tasks.jsx / .test.jsx
├── Transfer.jsx
├── Vcs.jsx
├── Work.jsx
└── database/              # → 80+ компонентов (см. выше)
```

### 3.8 Theme (`src/theme/`)
```
theme/
├── index.js
└── officeUiTokens.js
```

### 3.9 Test Setup (`src/test/`)
```
test/
└── setup.js
```

---

## 4. 🔌 Дополнительные модули

### 4.1 Zabbix (`zbx/`)
```
zbx/
├── zbx_export_templates (3).yaml
└── zbx_export_templates (4).yaml
```

### 4.2 Scripts (`WEB-itinvent/scripts/`)
```
scripts/
├── check_snmp_printer.py
└── migrate_mail_template_fields.py
```

### 4.3 Startup Scripts (`WEB-itinvent/`)
```
├── start_ai_chat_worker.py      # AI Chat worker
├── start_chat_push_worker.py    # Chat push worker
├── start_server.py              # Main server
└── update_action_handler.py     # Action handler updater
```

---

## 5. 📊 Статистика проекта

| Показатель | Backend | Frontend | Всего |
|---|---|---|---|
| **Python файлов** | ~120 | — | ~120 |
| **React/JSX файлов** | — | ~300 | ~300 |
| **JS/Utils файлов** | — | ~150 | ~150 |
| **Тестовых файлов** | — | ~120 | ~120 |
| **Alembic миграций** | 30+ | — | 30+ |
| **API endpoints** | 20+ маршрутов | — | 20+ |
| **Сервисов** | 40+ | — | 40+ |
| **Компонентов** | — | 150+ | 150+ |

---

## 6. 🏗️ Архитектурные паттерны

### Backend
- **FastAPI** с dependency injection
- **Layered architecture**: API → Services → Database
- **Repository pattern** для DB операций
- **Outbox pattern** для chat events/push
- **Service-oriented** — каждая фича имеет сервис
- **Alembic** для миграций
- **Pydantic** для валидации
- **SQLAlchemy** ORM

### Frontend
- **React 18+** с hooks
- **Feature-based** организация
- **Custom hooks** для бизнес-логики (~50+ hooks)
- **Context API** для глобального состояния
- **SWR/React Query** для кэширования (swrCache.js)
- **Material-UI** компоненты
- **PWA** (Service Worker, manifest)
- **WebSocket** для realtime chat
- **WebAuthn** для passkey аутентификации

---

*Файл создан автоматически. Для обновления запустите анализ повторно.*
