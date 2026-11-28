# Состояние HUB-IT

Снимок на **2026-11-26 04:54 UTC**, до открытия PR этого регламента. Источники: GitHub REST (Issues, PR, checks, Actions, branch rules), свежий `git fetch`, Git-граф и сравнение деревьев. Совпадение SHA и статические проверки подтверждены лично; результаты прежних прогонов обозначены как исторические.

| Контур | Что подтверждено |
|---|---|
| `main` | `4d4dba1ffa5a3f8e8d7345bbcb2929a7d12e7e9b`; merge [#75](https://github.com/Mnogoznall2405/HUB-IT/pull/75) от 2026-11-25 11:51 UTC, второй родитель `d008cf60`, дерево совпадает с ним. |
| Версии в исходниках | Web `1.0.0`, Desktop `0.1.51`, Mobile `1.1.84`. Это версии пакетов на указанном SHA, не установленная версия. Git-тегов на момент сверки нет. |
| Кандидат / staging / production | Единственный рекомендуемый исходный SHA для пилота — `4d4dba1f`, пока не принято решение о дельте #73. Артефакт и RC не назначены; текущий SHA staging и production не подтверждён. Подробности — в [реестре релиза](RELEASE_REGISTRY.md). |
| CI и схема | Для пяти PR ниже на head нет checks/statuses; GitHub сообщил `main protected=false` и не вернул активных правил. Три исторических Actions runs относятся к отдельному mobile follow-up, не к main. App/chat, scan и voice имеют по одному статическому head; это не `current` БД. |
| Работа агентов | Открытых GitHub Issues на момент сверки — 0. Существуют локальные worktree и новые коммиты, но активный исполнитель не подтверждён ни для одного исторического PR. Не назначать пересекающиеся правки без сверки с автором и координатором. |

## Очередь открытых PR до этого изменения

| Task ID | Head / ветка | Состояние и действие |
|---|---|---|
| [PR-73](https://github.com/Mnogoznall2405/HUB-IT/pull/73) | `5eac1772` / `integration/frontend-remediation` | `REVIEW` — текущая дельта после #75: 14 коммитов, 94 файла, без изменений файлов миграций. В первую очередь независимо проверить «Мои файлы», сохранность auth/sticker-фиксов, paste и warm-dock; сравнить текущую голову с `5e6ac871` из последнего отчёта. Не принимать всю дельту по старому `GO`. |
| [PR-74](https://github.com/Mnogoznall2405/HUB-IT/pull/74) | `638ada47` / `feat/a11-ai-intelligence` | `REVIEW`, пока вне ближайшего RC. `main...head`: 142/41, 54 файла и около 188 тыс. добавленных строк (прежде всего результаты прогонов). Требуются проверка merge-result и разделение кода/обезличенных артефактов, независимый holdout с проверкой ACL, качества и стоимости; не включать флаги на production. |
| [PR-10](https://github.com/Mnogoznall2405/HUB-IT/pull/10) | `1d93d28b` / `fix/fe-0064-task-editor-safe-paste` | `BLOCKED` решением по пересечению. Изменение редактора и тесты перенесены в #73 как `472c5826`, в текущем `main` не подтверждены. При принятии этого участка #73 не вливать #10 повторно. |
| [PR-15](https://github.com/Mnogoznall2405/HUB-IT/pull/15) | `77518c4e` / `docs/ai-architecture-audit` | `BACKLOG` на актуализацию документов. Сопоставить с уже влитыми отчётами A1–A10; сохранить только актуальные уникальные материалы. |
| [PR-9](https://github.com/Mnogoznall2405/HUB-IT/pull/9) | `bbc9ed1e` / `audit/frontend-2026-11-22` | `BACKLOG` на разбор подтверждённых остатков. Не вливать старый снимок аудита целиком поверх уже интегрированных исправлений. |

Статусы в таблице — диспозиция координатора, не назначение и не изменение статуса на GitHub. Для нового baseline не путать `base.sha` в API GitHub с `git merge-base` актуальных веток.

## Что уже в `main`

- [#75](https://github.com/Mnogoznall2405/HUB-IT/pull/75): объединение основной frontend-remediation и Sticker V2 [#69](https://github.com/Mnogoznall2405/HUB-IT/pull/69); в ancestry есть обе исходные линии и два родителя финального merge. Auth refresh между вкладками, trusted-device UX и исправления цепочки миграций сохранены. Статус закрытого PR или ancestry не гарантирует итоговое поведение в конфликтном файле; конкретный случай — в [аудите](PROCESS_AUDIT.md).
- «Мои файлы» V2/V2.2 [#24](https://github.com/Mnogoznall2405/HUB-IT/pull/24) и V3–V3.2 [#68](https://github.com/Mnogoznall2405/HUB-IT/pull/68), merge V3 `a59bedbc`. Отдельный раунд скорости сейчас не нужен.
- ИИ A1 [#16](https://github.com/Mnogoznall2405/HUB-IT/pull/16), A3/A4 [#20](https://github.com/Mnogoznall2405/HUB-IT/pull/20)/[#19](https://github.com/Mnogoznall2405/HUB-IT/pull/19), A5/A5.1 [#21](https://github.com/Mnogoznall2405/HUB-IT/pull/21)/[#22](https://github.com/Mnogoznall2405/HUB-IT/pull/22) и A8/A9/A10 [#26](https://github.com/Mnogoznall2405/HUB-IT/pull/26)/[#70](https://github.com/Mnogoznall2405/HUB-IT/pull/70)/[#71](https://github.com/Mnogoznall2405/HUB-IT/pull/71); интеграционные фиксы [#72](https://github.com/Mnogoznall2405/HUB-IT/pull/72), `af485f22`. Включённость флагов и реальный эффект в production не проверялись.

## Ветки и решения

- Из 72 удалённых веток, кроме `main`, 64 являются его предками; остальные — пять PR из таблицы, две `backup/*` и `remediation/program` (`7decf498`, 64 уникальных коммита; источник исторических материалов). Число веток не равно числу активных задач.
- `integration/hub-it-release-candidate` (`d008cf60`) и `integration/frontend-remediation-final` (`cfc5e012`) уже предки `main`; повторно не вливать. `integration/frontend-remediation` (`5eac1772`) уже содержит `4d4dba1f` и является веткой единственной проверяемой дельты. Не заводить третью консолидацию.
- Координатору: организовать независимую проверку #73; до неё не выбирать состав следующего RC. Владельцу: после ревью принять scope релиза и разрешения на staging/merge отдельно; настройки доступа/required checks менять только после пилота.
