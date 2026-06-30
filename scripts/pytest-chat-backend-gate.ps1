# Chat backend regression gate (see docs/adr/0003-chat-backend-module-layout.md)
$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

Write-Host "Running chat backend pytest gate..."
python -m pytest -q `
  tests/test_chat_assets_summary_service.py `
  tests/test_chat_async_api.py `
  tests/test_chat_event_outbox_service.py `
  tests/test_chat_files_and_notifications_service.py `
  tests/test_chat_health_runtime.py `
  tests/test_chat_notification_dispatcher.py `
  tests/test_chat_notification_planner.py `
  tests/test_chat_upload_session_completion.py `
  tests/test_chat_upload_session_transfer.py `
  tests/test_chat_upload_sessions_store.py `
  tests/test_chat_presence_and_receipts_service.py `
  tests/test_chat_push_outbox_service.py `
  tests/test_chat_push_service.py `
  tests/test_chat_realtime_inbox_notifications.py `
  tests/test_chat_search_reply_and_settings_service.py `
  tests/test_chat_task_share_service.py `
  tests/test_chat_websocket_rate_limiter.py `
  tests/test_chat_message_edit_delete_service.py `
  tests/test_chat_folders.py `
  tests/test_chat_notes_conversation_service.py `
  tests/test_chat_address_book_resolve.py `
  tests/test_chat_upload_streaming.py `
  WEB-itinvent/backend/tests/test_chat_conversation_read_store.py `
  WEB-itinvent/backend/tests/test_chat_thread_read_store.py `
  WEB-itinvent/backend/tests/test_chat_serialization.py `
  WEB-itinvent/backend/tests/test_chat_service_contract.py `
  WEB-itinvent/backend/tests/test_chat_request_metrics.py `
  WEB-itinvent/backend/tests/test_chat_read_cache_redis.py

if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Host "chat backend gate: OK"
