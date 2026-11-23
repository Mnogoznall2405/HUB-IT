# CYCLE 19 — финальная верификация и контроль качества

- Дата: 2026-11-23
- База аудита: PR #9, `5a173ff6` (324 записи).
- Проверенный код: **`9879be04`**, чистый `git archive`; SQLite `.state-cycle19`, backend 18009, proxy 5229, preview worker. Production не затрагивался.
- Итоговые документы: `AUDIT_FINAL_REVIEW.md`, `REMEDIATION_BACKLOG.md`; evidence — `evidence/cycle19/`.

## 1. FE-0326 — false positive (главное)

Цикл 18 сообщил о повреждённом `preview.png`. Цикл 19 проверил три валидных PNG:

| Файл | Размер | Исходный SHA-256 | Preview | Браузер | Download (stored) |
|---|---|---|---|---|---|
| small 32x32 solid | 117 B | `aac8...` | image/webp 80 B, Pillow OK | 32x32, no error | public WebP 80 B, matches preview |
| medium 512x512 gradient | 4 485 B | `f440...` | image/png 4 485 B, SHA = original, Pillow OK | 512x512, no error | public PNG 4 485 B, SHA = original |
| large 1600x1200 noise | 5 769 402 B | `9561...` | image/webp 1 437 182 B, Pillow OK | 1600x1200, no error | public WebP 1 437 182 B, matches preview |

Private и public preview — 200, decode OK, visual errors нет. **Проблема не зависит от размера/формата/оптимизации.**

Download contract: приватный `GET /my-files/{id}/download` — **410 by design** (legacy path disabled); актуальный приватный контракт — `POST /download-grant` + `GET /download-grant/{token}`. Public download отдаёт **сохранённое представление**: WebP для `optimized_media` (small/large), исходный PNG для `stored` (medium). Поэтому `matchesOriginal=false` для small/large — ожидаемо; сравнивать с оригиналом нужно только при `storage_mode=stored`. Тест цикла 19 использовал legacy endpoint и original-SHA — методологическая ошибка, не дефект приложения. Подробности: `evidence/cycle19/fe0326-download-contract.md`.

Корень: тестовая фикстура cycle18 — 180-байтный PNG с валидным IHDR, но **IDAT CRC mismatch**, 6 лишних байт и zlib `incorrect data check`. Приложение сохранило невалидный исходник, оптимизация его пропустила, preview worker отдал тот же невалидный `preview.png`. Повреждение — в тестовой фикстуре, не в приложении.

Действия: фикстура заменена валидным 186-байтным PNG; MyFiles E2E — 11 mandatory + 1 observation, 0 failed. FE-0326 переведён в **Rejected** (false positive), исторические доказательства сохранены в `reverificationHistory`/`titleHistory`.

## 2. Negative controls — усилены

`negative-controls.cjs` теперь различает `EXPECTED_FAILURE`, `UNEXPECTED_FAILURE`, `INFRA_FAILURE`, `PASS` и требует:

- сценарий действительно стартовал (`started`);
- инъекция применена (`injectionApplied`, `scenario.controls`);
- конкретная failed check (для timeout — ожидаемый `waitForURL` timeout);
- отсутствие infra-error;
- browser launch failure — отдельный meta-case, классифицирован `INFRA_FAILURE`, `countedAsExpected=false`.

Результат: **10/10 EXPECTED_FAILURE**, positive feed PASS, meta browser launch error — INFRA_FAILURE (не засчитан). Случайный crash раннера больше не может выглядеть как успешный negative.

## 3. Повторный прогон строгих тестов на `9879be04`

- five E2E: **5/5**, **48 mandatory + 1 observation**, 0 failed.
- FE-0232: 11/11, links 1→0 при injected bulk; control 1→1.
- FE-0239: 8/8, PUT D2 `[14]`, D2 16→14.
- FE-0259: 11/11, plan persisted; daily и weekly drafts lost on F5 without beforeunload.
- Refresh matrix A-D: A 200/200, B 200/401 family revoked, C [200,200,401] winners dead, D old 401/new alive.

## 4. FE-0194 — mocked-browser reproduction

Mocked `/monitoring/overview` с target без `name` дал `TypeError: Cannot read properties of undefined (reading 'split')` и route error boundary. Реальный backend target без name не наблюдался → статус остаётся **Suspected**; добавлен `local-browser-mock` и evidence. Это подтверждает code path, не production-триггер.

## 5. Метаданные и реестр

- FE-0215: убрано устаревшее IMAP/SMTP-предположение; текущая причина — Exchange EWS, нет EWS test server; full E2E blocked.
- FE-0232/0239/0259: старые «blocked/no fixtures» причины заменены на live-reproduced; исторические записи сохранены.
- FE-0326: Rejected, false positive.
- FE-0230: остаётся Suspected; новых доказательств нет.
- `highBreakdown`: historical 12, active 11, fixed 1 (FE-0078), runtime-proven 10, unresolved 9, static-only FE-0215, runtime-not-reproduced FE-0230.
- `issueCounters`: 324; **268 Confirmed / 12 Suspected / 2 Fixed / 42 Rejected**; High 12, Medium 124, Low 173, Info 15.
- Валидатор — 0 ошибок; ISSUES.md/COVERAGE_MATRIX обновлены.

## 6. Итог

Финальный статус и полный разбор — `AUDIT_FINAL_REVIEW.md`; план исправлений — `REMEDIATION_BACKLOG.md`. Приложение не изменялось; merge/deploy не выполнялись.
