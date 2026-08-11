# План перехода на global sequence (без внедрения)

Статус: **черновик**. Внедрять только если после изоляции Chat API
экстремальный сценарий (50 писателей в один чат) остаётся обязательным SLA,
а реалистичные сценарии B/C не укладываются в цели.

## Когда нужен

- Per-chat `UPDATE last_message_seq ... RETURNING` остаётся главным bottleneck
  после split Main/Chat.
- Корпоративная нагрузка (десятки одновременных писателей в один чат) — реальный
  production-профиль, а не только loadtest.

## Когда НЕ нужен

- Высокая задержка только в hot-chat 50 VU в одну комнату.
- В 10 чатах / корпоративном профиле ACK p95 уже приемлемый (<300–400 ms).

## Безопасный переход

1. Добавить `global_seq BIGINT NULL` + `CREATE SEQUENCE chat_message_global_seq`.
2. Backfill существующих сообщений в порядке `(conversation_id, conversation_seq, created_at)`.
3. Двойная запись: `conversation_seq` (как сейчас) + `global_seq = nextval(...)`.
4. Перевести чтение/сортировку истории на `global_seq`.
5. Вынести обновление `last_message_*` в идемпотентный outbox:
   `WHERE last_message_global_seq IS NULL OR last_message_global_seq < :global_seq`.
6. Нагрузочный прогон production-like.
7. Только затем убрать `UPDATE last_message_seq` из критического пути.
8. `conversation_seq` не удалять в первом патче.

## Ограничения

- Не считать unread как `global_seq - last_read_seq`.
- Не использовать `MAX(seq)+1`, advisory lock, per-conversation SEQUENCE.
- Пропуски `global_seq` внутри чата допустимы.

## Откат

- Feature-flag `CHAT_USE_GLOBAL_SEQ=0` возвращает сортировку на `conversation_seq`.
- Колонка `global_seq` остаётся nullable до полной стабилизации.
