# Производительность — замеры и находки

Дата: 2026-11-22. Метод: живая проверка production (read-only) — Performance API
(`performance.getEntriesByType('resource'|'navigation')`), network capture плагина,
статический анализ (агент C: `evidence/agent-C-perf-report.md`).
Окружение: Chrome, viewport 1920×1080, тёплый кэш ассетов, production-сервер
(backend :8001 через IIS, scan :8011, voice :8013).

## Сводка по страницам (загрузка, тёплый кэш)

| Страница | API-вызовов | Самые тяжёлые запросы | Примечание |
|---|---|---|---|
| /dashboard | 15 | docflow/inbox-summary 294 мс; hub/dashboard 178 мс | 2× идентичных poll (FE-0005) |
| /tasks | 13 | hub/tasks 214 мс; departments 155 мс | rapid-switch 7 кликов → 10 запросов (FE-0045) |
| /tickets | 12 | tickets/requests 41 мс | чисто |
| /feed | 21 | announcements ×5 77–143 мс | +8 запросов вложений → 410 (FE-0007) |
| /database | 31 | warehouse-1c/employee-compare 367 мс; equipment/all-grouped ×2 (стр. по 1000) 244+363 мс; current-acts 291 мс | самый тяжёлый набор запросов из всех страниц |
| /networks | 11 | networks/branches 97 мс | чисто |
| /computers | 11 | **inventory/computers/search?scope=all 3250 мс** (1001 ПК) | FE-0008 |
| /scan-center | 14 | **scan/events 3757 мс** | прокси на scan_server :8011 |
| /mail | 19 | **mail/bootstrap 1447 мс** + второй bootstrap (mailbox legacy-38) 457 мс + messages 337 мс | проверить дубль bootstrap |
| /my-files | 17 | my-files/libraries 202 мс | ок |
| /statistics | 11 | works/cleaning/statistics 181 мс | FE-0042 (нет кэша вкладок) |
| /address-book | 15 | **docflow/absences 3841 мс + ?employee_code=… 3359 мс**; photos 755 мс | FE-0013 |
| /company-structure | 12 | poll 174 мс | чисто |
| /warehouse-1c | 12 | poll 93 мс | чисто (загрузка справочников лениво) |
| /it/objects | 11 | poll 100 мс | чисто |
| /construction | 11 | construction/objects 383 мс | снимок 1С устарел на 2 дня (FE-0020) |
| /docflow | 13 | **docflow/tasks?scope=inbox ×2 (222+195 мс)** | FE-0012 |
| /passwords | 13 | passwords 182 мс | ок |
| /vcs | 11 | vcs/info 113 мс | чисто |
| /mfu | 11 | mfu/devices 596 мс | ок |
| /monitoring | 11 | monitoring/overview 483 мс | polling 10 с — осознанно |
| /voice | 16 | **voice/jobs 1296 мс; meetings 1263 мс; meetings?limit=1 1237 мс** | FE-0018 |
| /settings | 10 | avatars 100 мс | чисто |
| /admin | 30 | **auth/sessions 1090 мс**; auth/users 285 мс | FE-0019 |
| /help | 12 | auth/me 745 мс; settings/me 700 мс; kb/articles 529 мс | медленные, но редкая страница |

## Стартовый бандл (агент C, по dist)

- Startup ≈ **223 КБ gzip**; vendor-react/vendor-router отдельные стабильные чанки.
- 38/38 маршрутов lazy; xlsx/pdfjs/excalidraw/xyflow/elkjs/livekit/lottie/html5-qrcode/emoji-picker — dynamic import. Guard-скрипт `scripts/check-startup-bundle.mjs`.
- Найдено: `qrcode` статически в чанке Login/Passwords (FE-0040); framer-motion 40 КБ gz в /chat,/mail; recharts 89 КБ gz грузится на /monitoring до выбора устройства.

## Рендеринг (агент C)

- **High:** мобильная вкладка «Оборудование» /networks рендерит до 10 000 портов карточками без виртуализации (desktop виртуализируется) — FE-0023; розетки — FE-2024 серия.
- `InteractiveMapCanvas`: `setDraggedPoint` на каждый pointermove → полный ре-рендер карты (FE-0031).
- `Networks.jsx`: ~80 useState, keydown-листенер переустанавливается каждый рендер (FE-0029/0030).
- `Warehouse1C`: списки 200–1000 строк без виртуализации (FE-0033).
- `MyFiles`: bulk download без очереди (FE-0032).
- Чат: окно рендера ≤240 сообщений — ок. Database: своя виртуализация — ок.

## Запросы

- Дубли на загрузке: poll ×2 (FE-0005), docflow/tasks ×2 (FE-0012), tasks sort_by=due_at ×3 при rapid-switch (FE-0045), mail bootstrap ×2 (проверить), admin 30 вызовов (FE-0019).
- Отсутствие кэша вкладок: Statistics (FE-0042), Tasks (FE-0045).
- Debounce поиска: address-book — PASS (1 запрос на 10 символов).

## Что не замерено

- Холодный кэш/first visit, медленная сеть (throttling), heap/утечки при многочасовой сессии,
  LCP/TBT через Lighthouse, реальные объёмы портов/розеток на production-филиалах,
  влияние framer-motion/recharts на медленных сетях.
