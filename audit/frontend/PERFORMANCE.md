# Производительность — замеры и находки

Дата: 2026-11-22. Метод: живая проверка production (read-only) — Performance API,
network capture, статический анализ (агент C: evidence/agent-C-perf-summary.md).
Окружение: Chrome, viewport 1920×1080, тёплый кэш, production-сервер.

## Сводка по страницам (загрузка, тёплый кэш)

| Страница | API | Самые тяжёлые запросы | Примечание |
|---|---|---|---|
| /dashboard | 15 | docflow/inbox-summary 294 мс; hub/dashboard 178 мс | 2× идентичных poll (FE-0005) |
| /tasks | 13 | hub/tasks 214 мс; departments 155 мс | rapid-switch 7 кликов → 10 запросов (FE-0045) |
| /tickets | 12 | tickets/requests 41 мс | чисто |
| /feed | 21 | announcements ×5 77–143 мс | +8 вложений → 410 (FE-0007) |
| /database | 31 | warehouse-1c/employee-compare 367 мс; equipment/all-grouped ×2 (по 1000) 244+363 мс; current-acts 291 мс | самый тяжёлый набор |
| /networks | 11 | networks/branches 97 мс | чисто |
| /computers | 11 | **inventory/computers/search?scope=all 3250 мс** (1001 ПК) | FE-0008 |
| /scan-center | 14 | **scan/events 3757 мс** | прокси → scan_server :8011 |
| /mail | 19 | **mail/bootstrap 1447 мс** + bootstrap mailbox=legacy-38 457 мс + messages 337 мс | дубль bootstrap? — проверить |
| /my-files | 17 | my-files/libraries 202 мс | ок |
| /statistics | 11 | works/cleaning/statistics 181 мс | FE-0042 |
| /address-book | 15 | **docflow/absences 3841 мс + ?employee_code 3359 мс**; photos 755 мс | FE-0013 |
| /company-structure | 12 | poll 174 мс | чисто |
| /warehouse-1c | 12 | poll 93 мс | чисто |
| /it/objects | 11 | poll 100 мс | чисто |
| /construction | 11 | construction/objects 383 мс | снимок 1С устарел (FE-0020) |
| /docflow | 13 | **docflow/tasks ×2 (222+195 мс)** | FE-0012 |
| /passwords | 13 | passwords 182 мс | ок |
| /vcs | 11 | vcs/info 113 мс | чисто |
| /mfu | 11 | mfu/devices 596 мс | ок |
| /monitoring | 11 | monitoring/overview 483 мс | polling 10 с — осознанно |
| /voice | 16 | **voice/jobs 1296 мс; meetings 1263 мс; meetings?limit=1 1237 мс** | FE-0018 |
| /settings | 10 | avatars 100 мс | чисто |
| /admin | 30 | **auth/sessions 1090 мс**; auth/users 285 мс | FE-0019 |
| /help | 12 | auth/me 745 мс; settings/me 700 мс; kb/articles 529 мс | медленные, но редкая страница |
| /it/requests | 12 | it-requests 362 мс; it-requests/{ref} 116 мс | ок |

## Стартовый бандл (агент C, по dist)

- Startup ≈ **223 КБ gzip**; vendor-react/vendor-router — стабильные чанки.
- 38/38 маршрутов lazy; тяжёлые библиотеки dynamic import; guard `check-startup-bundle.mjs`.
- Найдено: qrcode в чанке Login/Passwords (FE-0040); framer-motion 40 КБ gz (/chat,/mail);
  recharts 89 КБ gz на /monitoring до выбора устройства.

## Рендеринг (агент C)

- High: мобильная вкладка «Оборудование» — до 10 000 карточек без виртуализации (FE-0023);
  розетки — аналогично.
- InteractiveMapCanvas: ре-рендер карты на каждый pointermove (FE-0031).
- Networks.jsx: ~80 useState; keydown-листенер на каждый рендер (FE-0029/0030).
- Warehouse1C: списки 200–1000 строк без виртуализации (FE-0033).
- MyFiles: bulk download без очереди (FE-0032).
- Чат: окно рендера ≤240 сообщений — ок. Database: своя виртуализация — ок.

## Запросы

- Дубли на загрузке/действиях: poll ×2 (FE-0005), docflow/tasks ×2 (FE-0012),
  users/controllers ×2 при открытии диалога задачи (FE-0054), tasks sort_by=due_at ×3
  при rapid-switch (FE-0045), mail bootstrap ×2 (проверить).
- Нет кэша вкладок: Statistics (FE-0042), Tasks (FE-0045).
- Debounce: address-book — PASS (1 запрос на 10 символов).

## Не замерено

Холодный кэш, throttling, heap/утечки при многочасовой сессии, Lighthouse LCP/TBT,
реальные объёмы портов/розеток на филиалах.

- Цикл 9: mail bootstrap ×2 подтверждён → FE-0098 (scope pending→resolved).
- Цикл 9: scanSSE-pulse → лишний getAgentsActivity на событие → FE-0092.
- Цикл 9: MyFiles bulk delete/move — N последовательных запросов без прогресса → FE-0126.

