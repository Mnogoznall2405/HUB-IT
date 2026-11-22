# Прогресс аудита web-фронтенда

## Текущий этап: Цикл 4–5 (браузерное тестирование + производительность) — IN_PROGRESS

```text
Текущий этап: циклы 3–5: браузерные проверки страниц (read-only) + статические агенты A/C/D/E
Дата и время: 2026-11-22, ~18:00
Проверенные страницы (живая проверка, read-only, production https://hubit.zsgp.ru):
  /login (UI+валидация+ошибки+SSO-кнопки), / (redirect), /dashboard, /feed, /tasks,
  /tickets, /database, /networks, /computers, /scan-center, /mail, /my-files,
  /statistics, /address-book, /company-structure, /warehouse-1c, /it/objects,
  /construction, /docflow, /passwords, /groups-access(редирект по правам), /vcs, /mfu,
  /monitoring, /voice, /file-egress(редирект), /dlp(редирект), /settings, /admin,
  /profile, /help, /menu, /kb/manage(редирект), /it/requests, /chat,
  /shared-files/:invalid, /shared-folders/:invalid, /nonexistent(404-маршрут)
Непроверенные живьём (нет прав у тестовой учётки): /dlp, /file-egress, /groups-access,
  /kb/manage — BLOCKED; мутационные сценарии — BLOCKED (production)
Проверенные компоненты (глубоко): Login (уведомления/валидация/SSO), MainLayout
  (poller уведомлений, Drawer), Autocomplete-фильтры (несколько страниц), задачи
  (переключение 6 вкладок), поиск адресной книги (debounce)
Новые дефекты: ~45 (см. ISSUES.md)
Подтверждённые дефекты: High 3, Medium 21, Low 21 + Suspected (FE-0015/0016, D-4, D-5)
Неподтверждённые гипотезы: механизм FE-0004 (нужен incognito-тест), источник
  транзиентных 401 (FE-0016), UA-пиннинг сессии (FE-0015)
Сохранённые доказательства: evidence/screenshots (login-1920, dashboard-1920,
  scan-center-overflow), evidence/agent-{A,C,D}-report.md, network/console capture
  (в журнале сессии), замеры Performance API
Ограничения:
  - Production-сервер: только read-only; npm run build запрещён; мутации — BLOCKED.
  - Mobile-эмуляция (смена UA) сбросила сессию (FE-0015) — тестовая учётка должна
    войти повторно для дальнейших authenticated-проверок.
  - Просмотр изображений агентом недоступен: скриншоты сохраняются как evidence,
    визуальные дефекты подтверждаются DOM-замерами/a11y-снапшотами.
Следующая задача:
  1) повторный вход пользователя (SSO) → продолжить: back/forward, чат WS,
     my-files вкладки, zoom 80–150%, длинные списки;
  2) дождаться агента E (безопасность), интегрировать;
  3) прогон vitest (client.test.js в фоне), обновить TEST_RESULTS.md;
  4) COVERAGE_MATRIX: проставить статусы.
```

## Журнал циклов

### Цикл 1 — Архитектура и карта (DONE)
- Маршруты: 36 из App.jsx; стек React 18/Vite 7/MUI 5/rrd 7; тесты vitest(2 проекта)+Playwright.
- Production-сервер идентифицирован (PM2: backend/chat/scan/bot/voice…). Dev :5173 не поднят.

### Цикл 2 — Статический анализ (агенты) (A/C/D DONE, E IN_PROGRESS)
- A (UI/UX): 28 находок → evidence/agent-A-uiux-report.md
- C (perf): ~15 находок + сильные положительные результаты → agent-C-perf-report.md
- D (state/cache/async): 7 находок + проверенные защиты → agent-D-state-report.md

### Цикл 3 — Браузерное тестирование (DONE для 36/36 маршрутов, состояния — частично)
- Все маршруты открыты, API/консоль/переполнения проверены на каждой странице.
- Ключевые находки: FE-0004 (shared-folders анонимно), FE-0007 (410 вложения),
  FE-0011 (scan-center overflow), FE-0014 (drawer a11y), FE-0009 (безымянные combobox),
  FE-0010 («Open»), дубль-запросы (FE-0005/0012/0045).

### Цикл 4 — Функциональные сценарии (PARTIAL)
- PASS: redirect-ы, дебаунс поиска, вкладки задач (без гонок), drawer open/close/Esc/focus.
- FAIL/BLOCKED: мутации (создание/редактирование/удаление) — запрещены на production.

### Цикл 5 — Производительность (PARTIAL)
- Замеры по страницам собраны (см. PERFORMANCE.md). Главные: computers search 3.2 c,
  docflow/absences 2×3.4–3.8 c, scan/events 3.7 c, voice 3×1.2–1.3 c, admin 30 вызовов.
- Память/долгие сессии — не проверено (требует отдельного прогона).
