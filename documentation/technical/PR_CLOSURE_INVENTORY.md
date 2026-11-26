# PR_CLOSURE_INVENTORY.md — инвентаризация PR для закрытия после merge #75

Дата: 2026-11-25. Метод проверки: `git merge-base --is-ancestor <pr-head-oid> HEAD` против финального SHA релизной ветки + контентный анализ не-ancestor случаев. **Ничего не закрывать до подтверждённого merge #75 владельцем.**

## 1. PR, чьи head-коммиты являются ancestors HEAD #75 (44) — закрываемы после merge

Их коммиты физически входят в релизную ветку; содержимое сохранено по построению.

| PR | Ветка | Head OID | Содержимое |
|---|---|---|---|
| #23 | fix/auth-2fa-flow | bcb41ca0 | auth 2FA flow |
| #27 | fix/account-delegate-integrity | 4a10b583 | delegate integrity (FE-0232) |
| #28 | fix/account-department-race | 2f80488b | department race (FE-0239) |
| #29 | fix/auth-refresh-coordination | faa065f1 | refresh CAS-протокол (пережил merge-конфликт — см. ниже) |
| #30 | fix/construction-beforeunload | 5ff5c620 | construction guards (FE-0259) |
| #31–#37 | networks/mobile/warehouse/a11y/csv/correctness/sites/map | — | networks/account серия |
| #38–#41 | account-guards/seq-guards/draft-loss/aibots-lazy | — | account серия |
| #42–#43 | database-misc/races | — | database серия |
| #44 | fix/voice-batch | 00a00bd3 | voice 18 записей |
| #45 | fix/chat-batch | ea9ca06b | chat 15 записей |
| #46 | fix/tasks-batch | 46add41e | tasks 13 записей |
| #47 | fix/mail-batch | 5b3651fe | mail batch |
| #48 | fix/auth-misc-batch | 8c20ce0c | auth-misc |
| #49 | fix/myfiles-batch | e82dfd29 | my-files batch (все 7 улучшений подтверждены дословно в финальном MyFiles.jsx — merge-анализ) |
| #50–#67 | scancenter/itobjects/layout/networks/feed/stats/shared/dash/computers/swr/constr/company/pwa/mon-docflow/kb-dlp/misc/final-polish/evidence | — | batch серия |
| #69 | feat/chat-sticker-system-v2 | 1debbc23 | Sticker V2 — согласованная версия |

### Точечная верификация фактического сохранения (не только ancestry)

- **#29 (refresh coordination)**: при merge-конфликте http.js сознательно оставлена RC-версия CAS-протокола (строго сильнее main-варианта). Проверено: `client.test.js` 265/265, `http.refreshCoordination.test.js` PASS на финальном SHA.
- **#49 (myfiles-batch)**: все 7 улучшений RC (bulkProgress, folder-gone deep-link, tab.opener=null, libraryId deps, edit-deeplink через openOfficeEditor, последовательный bulk download, LinearProgress) присутствуют дословно в финальном MyFiles.jsx — проверено grep'ом при merge-разборе; suite 65/65 PASS.
- **#69 (Sticker V2)**: favorites/recents/op-journal/position — покрыто PG-гейтом и sticker E2E/units на финальной цепочке.

## 2. Не-ancestor PR — индивидуальные решения

### #73 integration/frontend-remediation — закрываем после merge #75, с оговоркой о salvage

Причина не-ancestry: ветка получила 5 коммитов **после** среза в RC (параллельная сессия 2026-11-25 12:54–14:54):

```
a26797c2 fix(migration): renumber sticker chain 0180-0182 post main-merge
7d975299 Merge origin/main into integration/frontend-remediation
385c1014 docs(gate): final release gate report + integration registry
5a7cb5e1 test(gate): release e2e module sweep
609572ac test(gate): release perf A/B
```

Анализ содержимого:
- Контент ветки **по состоянию на срез** полностью вошёл в #75 (merge `82bff0c7` построен из `1a2a7a0b`).
- `7d975299`+`a26797c2` — **независимое дублирование** того же merge main и той же перенумерации sticker-цепочки, что выполнены в #75 (`c4c63572`/`957fac69`). Параллельное схождение к идентичному решению — дополнительная валидация, но контентно избыточно.
- **Уникальный контент, отсутствующий в HEAD**: расширенный `tests/test_chat_sticker_favorites.py` (632 vs 559 строк) — включая тесты entitlement `test_user_uploaded_stickerlike_filename_does_not_grant_entitlement` и `test_user_upload_cannot_set_sticker_media_kind`, напрямую покрывающие security-фикс `df0b70c9`; `test_pg_sticker_gate.py` расширен (371 строка diff); gate-доки `rc-inventory.md`/`_migration_safety.py` — уже присутствуют в HEAD через исходный merge.
- **Рекомендация**: перед закрытием — salvage тестов entitlement/sticker в релизную ветку (tests-only, усиливает покрытие security-фикса) либо сознательно зафиксировать отказ. Решение владельца; независимые изменения, требующие повторного merge, в ветке отсутствуют.

### #15 docs/ai-architecture-audit — НЕ закрывать автоматически

Docs-only PR: AI_GAP/ROADMAP/OPEN_SOURCE_EVALUATION + kb_search_quality experiment (+725 строк). Контент не вошёл в #75 и не относится к программе ремедиации — это документация аудита AI-архитектуры. Решение владельца: merge отдельно или закрыть как документально покрытый.

### #10 fix/fe-0064-task-editor-safe-paste — НЕ закрывать (отдельный backlog-фикс)

FE-0064 safe-paste в task editor (+200 строк, 4 файла с тестами). Сознательно не входил в программу ремедиации — вынесен в POST_RELEASE_BACKLOG. Кандидат на отдельный merge после релиза.

### #9 audit/frontend-2026-11-22 — сохранить открытым

Исторический аудит — по решению владельца остаётся как референс. Не закрывать.

### #74 feat/a11-ai-intelligence — отдельное направление разработки

Не ремедиация; пост-релизное направление (AI intelligence routing). Не закрывать, не merge'ить в этот релиз.

## 3. Итоговая таблица судьбы

| PR | Действие после merge #75 |
|---|---|
| #23, #27–#67, #69 (44 PR) | Закрыть — контент в релизе, ancestry+spotcheck подтверждены |
| #73 | Закрыть после решения о salvage расширенных sticker-тестов |
| #15 | Решение владельца (docs AI-аудита, вне ремедиации) |
| #10 | Оставить — отдельный merge после релиза (FE-0064, backlog) |
| #9 | Оставить открытым — исторический аудит |
| #74 | Оставить — отдельное направление |
