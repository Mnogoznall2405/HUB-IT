# A11 Cycle 3 — независимый security-аудит HEAD 710a3efe

Источник: независимый read-only субагент, статический анализ diff af485f22..710a3efe
с противопоставлением baseline-дереву C:\Project\HUB-IT-a11-base.

## Verdict

Новых release-blocking уязвимостей в трёх заявленных исправлениях НЕ найдено.
Основные механизмы реализованы fail-closed:

- confirm-time revalidation выполняется до любого executor и до SQL/JSON-мутации
  (action_cards.py:2391-2467); canonical scope берётся из row.database_id, не payload;
- loop-guard pseudo-result — фиксированная серверная строка, без user/model-controlled
  текста, завёрнута в untrusted; forced final pass не допускает новых tool calls
  (service.py:9730-10027);
- exact-duplicate blocking и read-after-write после успешной мутации работают
  (tests/test_ai_loop_guard.py:199-317).

Diff можно считать безопасным относительно baseline, но НЕ security-complete.

## Findings (новые, связанные с diff)

### MEDIUM F-D1 — dedup key mismatch raw vs prepared args
Cross-round dedup проверяет raw args (service.py:9631-9634), а записывает подпись
по prepared_args (service.py:8030, 9667-9674). draft_policy.prepare может менять
tool_id и args (draft_policy.py:151-235) — exact same raw call в следующем раунде
не совпадёт с записанной подписью. Dedup нельзя считать universal double-create/
double-send protection. Рекомендация: canonical signature считать один раз на
границе раунда из prepared form и использовать её для check/trace/record/reuse.

### MEDIUM F-D2 — нет семантической канонизации args
json.dumps(sort_keys=True) не решает Unicode NFC/NFKC, 1 vs "1", whitespace/case,
порядок semantically-unordered списков (to/cc/inv_nos). Модель может обойти dedup
тривиальными эквивалентными вариациями. Смягчение: для mail есть CAS + idempotency
key ai-action:{row.id} (action_cards.py:2187-2188). Dedup — НЕ security boundary.

### MEDIUM F-C1 — status/location draft actions вне canonical scope-модели
itinvent.action.status_change_draft / location_change_draft создают
AppAiPendingAction напрямую (tools/itinvent.py:2062-2169), без row-level database_id,
вне DB_SCOPED_ACTION_TYPES и без executor branch — confirm завершается controlled
unsupported-action failure. Сейчас fail-closed из-за отсутствия executor, но это
broken UX + latent scope-bypass при будущем подключении executor. До release:
удалить/выключить или довести до конца (create_pending_action + database_id +
preview + executor + DB_SCOPED_ACTION_TYPES + fail-closed tests).

### LOW F-D3 — failed mutation не инвалидирует read signatures
service.py:9667-9684: не-ok результат исключается до классификации эффекта; если
mutation частично изменила внешнее состояние, но вернула ok=False, read signatures
не удаляются — stale read.

### LOW F-C2 — admin fallback не восстанавливает explicit run database
confirm-time resolve_effective_database_id(explicit=None) (action_cards.py:2336-2339)
игнорирует explicit DB из run.request_json (service.py:7889-7901) — false negative,
направление fail-closed.

### LOW F-C3 — revalidate/execute TOCTOU-окно
bot config / user assignment могут измениться между revalidation и executor write.

## Pre-existing (не введены diff, но значимы для release)

### HIGH/conditional — чувствительные args в result_json для AI-manager
tool_traces содержат полные args: mail body до 12000 chars, recipients/cc/bcc,
chat text до 4000, file rows до 50000 (service.py:8030/8153/8188, traces в
result_json service.py:7722-7735, _serialize_run отдаёт всё service.py:10727-10744).
Endpoint /api/v1/ai/bots/{id}/runs доступен settings.ai.manage (ai_bots.py:117-124).
HIGH если manage делегируется не full admin. Рекомендация: redact_tool_args,
allowlisted scalar metadata, count/hash вместо recipients, retention.

### MEDIUM — disabled bot не отменяет pending actions
is_enabled=false не cancel pending (service.py:4972-4975), require_conversation_access
возвращает доступ владельцу (access.py:68-75) — emergency disable не останавливает
уже созданные подтверждаемые действия.

## Security corpus gaps (sec_01..sec_10 недостаточны для sign-off)

- нет indirect prompt injection (письма/вложения/KB/tool result/validation reflection);
- нет database-scope adversarial real-LLM сценариев (foreign/junk/dangling db,
  confirm-time revalidation);
- нет action confirmation abuse (draft без запроса, payload_overrides подмена,
  double-click, cancel/confirm race, confirm после revoke/disable, hidden BCC);
- нет dedup/loop adversarial (Unicode-equivalent, unordered recipients);
- нет telemetry leakage сценариев;
- sec_01 проверяет scope_downgraded только если модель сама вызвала scope=all.

## Ограничения аудита

Статический анализ без pytest-прогонов и live adversarial; production-распределение
settings.ai.manage не проверялось; frontend confirm payload overrides — отдельная зона.

## Действия cycle 3 по findings

- [ ] F-D1: canonical prepared signature для dedup (запланировано)
- [ ] F-C1/F-D2/F-D3/F-C2/F-C3: triage в follow-up, не блокируют diff-relative release
- [ ] telemetry redaction: отдельная задача, зависит от фактической роли settings.ai.manage
- [ ] corpus gaps: расширение sec-сценариев — cycle 4 candidate
