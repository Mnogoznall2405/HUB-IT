# ADR-0001: Удаление контура Unfound equipment

## Status

Accepted (2026-05-26)

## Context

Ранее при ненаходе серийника в ITINVENT бот и web могли записать оборудование в `data/unfound_equipment.json`. Контур дублировал учёт вне SQL Server и усложнял сопровождение.

## Decision

- Убрать **Unfound equipment** из продукта и доменного словаря (`CONTEXT.md`).
- При ненаходе в ITINVENT показывать только сообщение «в учётной базе не найдено».
- Удалить API `/api/v1/json/unfound`, обработчики бота, экспорт «ненайденного» и код `json_db/unfound.py`.

## Consequences

- Канонический учёт — только **Equipment record** (SQL) и **Inventory host** (агент).
- Исторические файлы `unfound_equipment.json` на серверах можно архивировать вручную; репозиторий их больше не описывает.
- Миграционные скрипты JSON больше не включают этот файл.
